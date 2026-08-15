const router = require('express').Router();
const pool = require('../config/db');
const { enviarMenuDeportes, enviarListaTurnos, enviarTexto } = require('../services/whatsappApi');
const { reservarTurno } = require('../services/reservaService');
const { disponiblesHoy } = require('../services/turnosService');

// ---------------------------------------------------------------------
// Verificación del webhook (GET). Meta lo llama una vez al configurar.
// ---------------------------------------------------------------------
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('Webhook verificado ✓');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ---------------------------------------------------------------------
// Recepción de mensajes (POST)
// ---------------------------------------------------------------------
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responder rápido SIEMPRE para que Meta no reintente

  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return; // puede ser un status update (entregado/leído), lo ignoramos

    const from = msg.from; // wa_id del cliente
    const nombrePerfil = value?.contacts?.[0]?.profile?.name || null;

    // Aseguro que el cliente exista
    const cli = await pool.query(
      `INSERT INTO clientes (telefono, nombre) VALUES ($1, $2)
       ON CONFLICT (telefono) DO UPDATE SET nombre = COALESCE(clientes.nombre, EXCLUDED.nombre)
       RETURNING id`,
      [from, nombrePerfil]
    );
    const clienteId = cli.rows[0].id;

    const reply = msg.interactive?.list_reply || msg.interactive?.button_reply;

    // A) Eligió un deporte → mostrar turnos de ese deporte
    if (reply?.id?.startsWith('deporte_')) {
      const tipo = reply.id.split('_')[1];
      const turnos = await disponiblesHoy({ tipo });
      if (turnos.length) {
        await enviarListaTurnos(from, turnos, `Turnos de ${tipo}`);
      } else {
        await enviarTexto(from, `No hay turnos de ${tipo} disponibles hoy 😕`);
      }
      return;
    }

    // B) Clic en un turno → reservar (con manejo de concurrencia)
    if (reply?.id?.startsWith('turno_')) {
      const turnoId = reply.id.split('_')[1];
      const r = await reservarTurno({ turnoId, clienteId });

      if (r) {
        const { rows } = await pool.query(
          `SELECT t.inicio, c.nombre AS cancha FROM turnos t
           JOIN canchas c ON c.id=t.cancha_id WHERE t.id=$1`,
          [turnoId]
        );
        const hora = new Date(rows[0].inicio).toLocaleString('es-AR', {
          timeZone: 'America/Argentina/Buenos_Aires',
        });
        await enviarTexto(from, `✅ ¡Turno confirmado!\n📍 ${rows[0].cancha}\n🕐 ${hora}\n\nTe esperamos 🎾`);
      } else {
        // Turno ya tomado → ofrecer otros
        await enviarTexto(from, '⚠️ Ese turno se acaba de ocupar. Te muestro otros:');
        const turnos = await disponiblesHoy({});
        if (turnos.length) await enviarListaTurnos(from, turnos);
        else await enviarTexto(from, 'No quedan turnos disponibles hoy 😕');
      }
      return;
    }

    // C) Texto libre → menú de deportes
    await enviarMenuDeportes(from);
  } catch (e) {
    console.error('Error en webhook:', e);
  }
});

module.exports = router;
