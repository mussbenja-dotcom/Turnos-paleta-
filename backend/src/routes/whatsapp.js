const router = require('express').Router();
const pool = require('../config/db');

const {
  enviarMenuDeportes,
  enviarListaDias,
  enviarListaTurnos,
  enviarTexto,
  enviarBotonesPago,
  enviarBotonesFranja,
} = require('../services/whatsappApi');

const { reservarTurno, cancelarReserva, registrarPago } = require('../services/reservaService');
const {
  disponiblesHoy,
  disponiblesPorFecha,
  diasConDisponibilidad,
} = require('../services/turnosService');
const { obtenerConfig } = require('../services/configService');

// Formatea un número como precio argentino: 24000 -> "$24.000"
function fmtPrecio(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR');
}

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
// Helpers
// ---------------------------------------------------------------------
function fmtHora(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

// Datos de un turno para armar el mensaje de confirmación.
async function datosTurno(turnoId) {
  const { rows } = await pool.query(
    `SELECT t.inicio, t.fin, c.nombre AS cancha, c.tipo
     FROM turnos t JOIN canchas c ON c.id = t.cancha_id
     WHERE t.id = $1`,
    [turnoId]
  );
  return rows[0];
}

// Lista los turnos reservados a futuro de un cliente.
async function reservasFuturasDeCliente(clienteId) {
  const { rows } = await pool.query(
    `SELECT r.id AS reserva_id, t.inicio, t.fin,
            c.nombre AS cancha, c.tipo
     FROM reservas r
     JOIN turnos t ON t.id = r.turno_id
     JOIN canchas c ON c.id = t.cancha_id
     WHERE r.cliente_id = $1 AND t.inicio > now()
     ORDER BY t.inicio`,
    [clienteId]
  );
  return rows;
}

// Confirma la reserva pendiente del cliente y devuelve el objeto reserva (o null).
async function confirmarReservaPendiente(cliente) {
  const reserva = await reservarTurno({
    turnoId: cliente.turno_pendiente_id,
    clienteId: cliente.id,
    nombreReserva: cliente.nombre_pendiente,
  });
  return reserva;
}

// ---------------------------------------------------------------------
// Recepción de mensajes
// ---------------------------------------------------------------------
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Respondemos rápido a Meta

  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return; // puede ser una actualización de estado

    const from = msg.from;
    console.log('📱 Número recibido desde WhatsApp:', from);
    console.log('🟢 VERSION BOT: cancelar+pago v2');

    const nombrePerfil = value?.contacts?.[0]?.profile?.name || null;

    // Crear cliente si no existe y traer su estado actual.
    const cli = await pool.query(
      `INSERT INTO clientes (telefono, nombre)
       VALUES ($1, $2)
       ON CONFLICT (telefono)
       DO UPDATE SET nombre = COALESCE(clientes.nombre, EXCLUDED.nombre)
       RETURNING id, nombre, turno_pendiente_id, nombre_pendiente, deporte_pendiente`,
      [from, nombrePerfil]
    );

    const cliente = cli.rows[0];
    const clienteId = cliente.id;

    const reply = msg.interactive?.list_reply || msg.interactive?.button_reply;
    const textoLibre = msg.type === 'text' ? (msg.text?.body?.trim() || '') : '';
    const textoLower = textoLibre.toLowerCase();

    // =================================================================
    // 0a. COMANDO: REINICIAR / EMPEZAR DE NUEVO
    //     Limpia cualquier estado a medias y arranca limpio.
    // =================================================================
    if (
      msg.type === 'text' &&
      ['reiniciar', 'empezar', 'menu', 'menú', 'inicio', 'volver', 'cancelar reserva'].includes(textoLower)
    ) {
      await pool.query(
        `UPDATE clientes SET turno_pendiente_id = NULL, nombre_pendiente = NULL, deporte_pendiente = NULL WHERE id = $1`,
        [clienteId]
      );

      const dias = await diasConDisponibilidad({ tipo: 'padel', dias: 7 });
      if (!dias.length) {
        await enviarTexto(from, 'Por ahora no hay turnos de pádel disponibles 😕 Escribime más tarde 🙌');
        return;
      }
      await pool.query(`UPDATE clientes SET deporte_pendiente = 'padel' WHERE id = $1`, [clienteId]);
      await enviarTexto(from, 'Empecemos de nuevo 🔄 Reservá tu cancha de pádel 👇');
      await enviarListaDias(from, dias, 'padel');
      return;
    }

    // =================================================================
    // 0b. COMANDO: AYUDA
    // =================================================================
    if (msg.type === 'text' && (textoLower === 'ayuda' || textoLower === 'help' || textoLower === 'info')) {
      await enviarTexto(
        from,
        'ℹ️ *Cómo usar el bot*\n\n' +
        '• Escribí *hola* para reservar una cancha de pádel.\n' +
        '• Escribí *cancelar* para anular un turno tuyo.\n' +
        '• Escribí *reiniciar* si algo se traba y querés empezar de nuevo.\n\n' +
        '¡Cualquier duda escribinos! 🎾'
      );
      return;
    }

    // =================================================================
    // 0. PALABRA CLAVE: CANCELAR
    // =================================================================
    if (msg.type === 'text' && (textoLower === 'cancelar' || textoLower.includes('cancelar turno'))) {
      const reservas = await reservasFuturasDeCliente(clienteId);

      if (!reservas.length) {
        await enviarTexto(from, 'No tenés turnos reservados a futuro para cancelar.');
        return;
      }

      const filas = reservas.slice(0, 10).map((r) => ({
        id: `cancelar_${r.reserva_id}`,
        inicio: r.inicio,
        fin: r.fin,
        cancha_nombre: r.cancha,
        tipo: r.tipo,
      }));

      await enviarListaTurnos(from, filas, 'Tus turnos');
      await enviarTexto(from, 'Elegí de la lista el turno que querés cancelar 👆');
      return;
    }

    // =================================================================
    // 1. CONFIRMÓ UNA CANCELACIÓN
    // =================================================================
    if (reply?.id?.startsWith('cancelar_')) {
      const reservaId = reply.id.split('_')[1];
      const ok = await cancelarReserva(reservaId);

      if (ok) {
        await enviarTexto(from, '✅ Tu turno fue cancelado. ¡Gracias por avisar!');
      } else {
        await enviarTexto(from, 'No encontré esa reserva. Quizás ya estaba cancelada.');
      }
      return;
    }

    // =================================================================
    // 2. HAY UN TURNO PENDIENTE Y ESCRIBE SU NOMBRE
    //    (todavía no eligió medio de pago)
    // =================================================================
    if (msg.type === 'text' && cliente.turno_pendiente_id && !cliente.nombre_pendiente) {
      const nombreIngresado = textoLibre;

      if (!nombreIngresado || nombreIngresado.length < 2) {
        await enviarTexto(from, 'Por favor, escribime tu nombre y apellido para confirmar la reserva.');
        return;
      }

      // Guardamos el nombre y preguntamos el medio de pago.
      await pool.query(
        `UPDATE clientes SET nombre_pendiente = $1 WHERE id = $2`,
        [nombreIngresado, clienteId]
      );

      await enviarBotonesPago(from);
      return;
    }

    // =================================================================
    // 3. ELIGIÓ MEDIO DE PAGO → SE CONFIRMA LA RESERVA
    // =================================================================
    if (reply?.id?.startsWith('pago_')) {
      const medio = reply.id.split('_')[1]; // efectivo | transferencia

      if (!cliente.turno_pendiente_id || !cliente.nombre_pendiente) {
        await enviarTexto(from, 'No tengo una reserva en curso. Escribime "hola" para empezar de nuevo.');
        return;
      }

      const turnoId = cliente.turno_pendiente_id;
      const nombre = cliente.nombre_pendiente;

      const reserva = await confirmarReservaPendiente(cliente);

      // Limpiamos el estado pendiente pase lo que pase.
      await pool.query(
        `UPDATE clientes SET turno_pendiente_id = NULL, nombre_pendiente = NULL WHERE id = $1`,
        [clienteId]
      );

      if (!reserva) {
        await enviarTexto(from, '⚠️ Ese turno se acaba de ocupar. Elegí otro horario.');
        const turnos = await disponiblesHoy({});
        if (turnos.length) await enviarListaTurnos(from, turnos);
        else await enviarTexto(from, 'No quedan turnos disponibles hoy 😕');
        return;
      }

      // Registramos el medio de pago elegido (queda pendiente de pago).
      const medioBd = medio === 'transferencia' ? 'transferencia' : 'efectivo';
      await registrarPago(reserva.id, { medioPago: medioBd, monto: null }).catch(() => {});

      const turno = await datosTurno(turnoId);
      const inicio = fmtHora(turno.inicio);
      const fin = fmtHora(turno.fin);

      // Precio y alias configurables desde el panel del admin.
      const config = await obtenerConfig();

      let confirmacion =
        `✅ ¡Turno confirmado!\n\n` +
        `👤 ${nombre}\n` +
        `📍 ${turno.cancha}\n` +
        `🎾 ${turno.tipo}\n` +
        `🕐 ${inicio} - ${fin}\n`;

      // Mostramos el valor del turno solo si hay un precio cargado (> 0).
      if (config.precio > 0) {
        confirmacion += `💲 Valor: *${fmtPrecio(config.precio)}*\n`;
      }

      if (medio === 'transferencia') {
        confirmacion +=
          `\n💳 Para abonar por transferencia:\n` +
          `Alias: *${config.alias}*\n\n` +
          `Enviá el comprobante por acá 🙌`;
      } else {
        confirmacion += `\n💵 Abonás en efectivo al llegar.`;
      }

      confirmacion += `\n\n¡Te esperamos!`;

      await enviarTexto(from, confirmacion);
      return;
    }

    // =================================================================
    // 4. ELIGIÓ UN DEPORTE → mostramos los días con disponibilidad
    // =================================================================
    if (reply?.id?.startsWith('deporte_')) {
      const tipo = reply.id.split('_')[1]; // padel

      const dias = await diasConDisponibilidad({ tipo, dias: 7 });

      if (!dias.length) {
        await enviarTexto(from, `No hay turnos de ${tipo} disponibles en los próximos días 😕`);
        return;
      }

      // Guardamos qué deporte eligió, para el paso siguiente.
      await pool.query(
        `UPDATE clientes SET deporte_pendiente = $1 WHERE id = $2`,
        [tipo, clienteId]
      );

      await enviarListaDias(from, dias, tipo);
      return;
    }

    // =================================================================
    // 4b. ELIGIÓ UN DÍA → mostramos los turnos de ese día
    // =================================================================
    if (reply?.id?.startsWith('dia_')) {
      const fecha = reply.id.slice(4); // 'YYYY-MM-DD'
      // Preguntamos mañana o tarde/noche. La fecha viaja en el id de los botones.
      await enviarBotonesFranja(from, fecha);
      return;
    }

    // =================================================================
    // 4c. ELIGIÓ FRANJA (mañana / tarde-noche) → mostramos esos turnos
    // =================================================================
    if (reply?.id?.startsWith('franja_')) {
      // formato: franja_manana_YYYY-MM-DD  |  franja_tarde_YYYY-MM-DD
      const resto = reply.id.slice('franja_'.length);
      const idx = resto.indexOf('_');
      const franja = resto.slice(0, idx);        // 'manana' | 'tarde'
      const fecha = resto.slice(idx + 1);        // 'YYYY-MM-DD'
      const tipo = cliente.deporte_pendiente || 'padel';

      const turnos = await disponiblesPorFecha({ tipo, fecha, franja });

      const nombreFranja = {
        manana: 'la mañana',
        tarde: 'la tarde',
        noche: 'la noche',
      }[franja] || 'ese horario';

      if (turnos.length) {
        const titulo = {
          manana: 'Turnos de la mañana',
          tarde: 'Turnos de la tarde',
          noche: 'Turnos de la noche',
        }[franja] || 'Turnos disponibles';
        await enviarListaTurnos(from, turnos, titulo);
      } else {
        await enviarTexto(
          from,
          `No quedan turnos disponibles a ${nombreFranja} para ese día 😕\nProbá con otra franja o elegí otro día escribiendo *hola*.`
        );
      }
      return;
    }

    // =================================================================
    // 5. ELIGIÓ UN HORARIO
    // =================================================================
    if (reply?.id?.startsWith('turno_')) {
      const turnoId = reply.id.split('_')[1];

      await pool.query(
        `UPDATE clientes SET turno_pendiente_id = $1, nombre_pendiente = NULL WHERE id = $2`,
        [turnoId, clienteId]
      );

      await enviarTexto(
        from,
        `Perfecto 👍\n\n¿A nombre de quién hacemos la reserva?\n\nEscribime tu nombre y apellido.`
      );
      return;
    }

    // =================================================================
    // 6. CUALQUIER OTRO MENSAJE → SALUDO + DÍAS DE PÁDEL DIRECTO
    // =================================================================
    {
      const dias = await diasConDisponibilidad({ tipo: 'padel', dias: 7 });

      if (!dias.length) {
        await enviarTexto(
          from,
          '¡Hola! 🎾 Por ahora no hay turnos de pádel disponibles en los próximos días. Escribime más tarde 🙌'
        );
        return;
      }

      // Dejamos marcado el deporte para el paso siguiente.
      await pool.query(
        `UPDATE clientes SET deporte_pendiente = 'padel' WHERE id = $1`,
        [clienteId]
      );

      await enviarTexto(from, '¡Hola! 🎾 Bienvenido al Club. Reservá tu cancha de pádel 👇');
      await enviarListaDias(from, dias, 'padel');
    }

  } catch (e) {
    console.error('Error en webhook:', e);
  }
});

module.exports = router;
