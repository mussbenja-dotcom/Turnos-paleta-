const router = require('express').Router();
const pool = require('../config/db');

const {
  enviarMenuDeportes,
  enviarListaTurnos,
  enviarTexto,
} = require('../services/whatsappApi');

const { reservarTurno } = require('../services/reservaService');
const { disponiblesHoy } = require('../services/turnosService');

// ---------------------------------------------------------------------
// Verificación del webhook
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
// Recepción de mensajes
// ---------------------------------------------------------------------
router.post('/webhook', async (req, res) => {
  // Respondemos rápido a Meta
  res.sendStatus(200);

  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];

    // Puede ser una actualización de estado y no un mensaje
    if (!msg) return;

    const from = msg.from;

    console.log('📱 Número recibido desde WhatsApp:', from);

    const nombrePerfil =
      value?.contacts?.[0]?.profile?.name || null;

    // -----------------------------------------------------------------
    // Crear cliente si no existe y obtener su estado actual
    // -----------------------------------------------------------------
    const cli = await pool.query(
      `
      INSERT INTO clientes (telefono, nombre)
      VALUES ($1, $2)

      ON CONFLICT (telefono)
      DO UPDATE SET
        nombre = COALESCE(clientes.nombre, EXCLUDED.nombre)

      RETURNING id, nombre, turno_pendiente_id
      `,
      [from, nombrePerfil]
    );

    const cliente = cli.rows[0];
    const clienteId = cliente.id;

    const reply =
      msg.interactive?.list_reply ||
      msg.interactive?.button_reply;

    // =================================================================
    // 1. HAY UN TURNO PENDIENTE Y EL CLIENTE ESCRIBE SU NOMBRE
    // =================================================================
    if (
      msg.type === 'text' &&
      cliente.turno_pendiente_id
    ) {
      const nombreIngresado = msg.text?.body?.trim();

      if (!nombreIngresado || nombreIngresado.length < 2) {
        await enviarTexto(
          from,
          'Por favor, escribime tu nombre y apellido para confirmar la reserva.'
        );
        return;
      }

      const turnoId = cliente.turno_pendiente_id;

      // Guardamos el nombre ingresado
      await pool.query(
        `
        UPDATE clientes
        SET nombre = $1
        WHERE id = $2
        `,
        [nombreIngresado, clienteId]
      );

      // Intentamos reservar
      const reserva = await reservarTurno({
        turnoId,
        clienteId,
      });

      // Limpiamos el turno pendiente
      await pool.query(
        `
        UPDATE clientes
        SET turno_pendiente_id = NULL
        WHERE id = $1
        `,
        [clienteId]
      );

      if (reserva) {
        const { rows } = await pool.query(
          `
          SELECT
            t.inicio,
            t.fin,
            c.nombre AS cancha,
            c.tipo
          FROM turnos t
          JOIN canchas c ON c.id = t.cancha_id
          WHERE t.id = $1
          `,
          [turnoId]
        );

        const turno = rows[0];

        const inicio = new Date(turno.inicio).toLocaleTimeString(
          'es-AR',
          {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'America/Argentina/Buenos_Aires',
          }
        );

        const fin = new Date(turno.fin).toLocaleTimeString(
          'es-AR',
          {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'America/Argentina/Buenos_Aires',
          }
        );

        await enviarTexto(
          from,
          `✅ ¡Turno confirmado!

👤 ${nombreIngresado}
📍 ${turno.cancha}
🎾 ${turno.tipo}
🕐 ${inicio} - ${fin}

¡Te esperamos!`
        );

        return;
      }

      // Si mientras escribía el nombre alguien tomó el turno
      await enviarTexto(
        from,
        '⚠️ Ese turno se acaba de ocupar. Elegí otro horario.'
      );

      const turnos = await disponiblesHoy({});

      if (turnos.length) {
        await enviarListaTurnos(from, turnos);
      } else {
        await enviarTexto(
          from,
          'No quedan turnos disponibles hoy 😕'
        );
      }

      return;
    }

    // =================================================================
    // 2. ELIGIÓ UN DEPORTE
    // =================================================================
    if (reply?.id?.startsWith('deporte_')) {
      const tipo = reply.id.split('_')[1];

      const turnos = await disponiblesHoy({ tipo });

      if (turnos.length) {
        await enviarListaTurnos(
          from,
          turnos,
          `Turnos de ${tipo}`
        );
      } else {
        await enviarTexto(
          from,
          `No hay turnos de ${tipo} disponibles hoy 😕`
        );
      }

      return;
    }

    // =================================================================
    // 3. ELIGIÓ UN HORARIO
    // =================================================================
    if (reply?.id?.startsWith('turno_')) {
      const turnoId = reply.id.split('_')[1];

      // Guardamos temporalmente el turno.
      // TODAVÍA NO LO RESERVAMOS.
      await pool.query(
        `
        UPDATE clientes
        SET turno_pendiente_id = $1
        WHERE id = $2
        `,
        [turnoId, clienteId]
      );

      await enviarTexto(
        from,
        `Perfecto 👍

¿A nombre de quién hacemos la reserva?

Escribime tu nombre y apellido.`
      );

      return;
    }

    // =================================================================
    // 4. CUALQUIER OTRO MENSAJE → MENÚ PRINCIPAL
    // =================================================================
    await enviarMenuDeportes(from);

  } catch (e) {
    console.error('Error en webhook:', e);
  }
});

module.exports = router;
