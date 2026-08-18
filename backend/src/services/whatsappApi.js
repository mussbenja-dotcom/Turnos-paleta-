const TOKEN = process.env.WA_TOKEN;
const PHONE_ID = process.env.WA_PHONE_ID;
const API_VERSION = process.env.WA_API_VERSION || 'v21.0';

const URL = `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}/messages`;

/**
 * Conversión temporal SOLO para la prueba con Meta.
 *
 * El webhook recibe:
 * 5493382461766
 *
 * Pero el destinatario autorizado de prueba figura como:
 * 54338215461766
 */
function normalizarDestinatario(to) {
  if (to === '5493382461766') {
    return '54338215461766';
  }

  return to;
}

/**
 * Envía una petición a la API de WhatsApp.
 */
async function enviar(payload) {
  const destino = normalizarDestinatario(payload.to);

  console.log('📤 Enviando WhatsApp a:', destino);

  const r = await fetch(URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      ...payload,
      to: destino,
    }),
  });

  const data = await r.json();

  if (!r.ok) {
    console.error('Error WhatsApp API:', JSON.stringify(data));
  } else {
    console.log('✅ WhatsApp enviado:', JSON.stringify(data));
  }

  return data;
}

/**
 * Formatea la hora en formato 24 h corto.
 * Ejemplo: 09:00
 */
function fmtHora(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/**
 * Envía un menú interactivo con los deportes disponibles.
 */
async function enviarMenuDeportes(to) {
  return enviar({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: '¡Hola! 🎾 ¿Qué querés reservar hoy?',
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'deporte_padel',
              title: 'Pádel',
            },
          },
        ],
      },
    },
  });
}

/**
 * Envía una lista interactiva con los turnos disponibles.
 * WhatsApp permite máximo 10 filas por lista.
 */
async function enviarListaTurnos(
  to,
  turnos,
  titulo = 'Turnos disponibles'
) {
  const rows = turnos.slice(0, 10).map((t) => ({
    // Si la fila ya trae un id propio (ej. 'cancelar_5'), lo respetamos.
    id: t.id && String(t.id).includes('_') ? String(t.id) : `turno_${t.id}`,

    // Máximo permitido por WhatsApp: 24 caracteres.
    // Ejemplo: "09:00 - 10:30"
    title: `${fmtHora(t.inicio)} - ${fmtHora(t.fin)}`,

    description: `${t.cancha_nombre || 'Cancha'} · ${
      t.tipo || ''
    }`.trim(),
  }));

  return enviar({
    to,
    type: 'interactive',
    interactive: {
      type: 'list',

      header: {
        type: 'text',
        text: titulo,
      },

      body: {
        text: 'Elegí un horario para reservar 👇',
      },

      footer: {
        text: 'Club Pádel',
      },

      action: {
        button: 'Ver horarios',

        sections: [
          {
            title: 'Disponibles hoy',
            rows,
          },
        ],
      },
    },
  });
}

/**
 * Envía un mensaje de texto simple.
 */
async function enviarTexto(to, text) {
  return enviar({
    to,
    type: 'text',
    text: {
      body: text,
    },
  });
}

/**
 * Envía los botones para elegir medio de pago.
 */
async function enviarBotonesPago(to) {
  return enviar({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: '¿Cómo vas a abonar? 💰',
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'pago_efectivo', title: 'Efectivo' } },
          { type: 'reply', reply: { id: 'pago_transferencia', title: 'Transferencia' } },
        ],
      },
    },
  });
}

/**
 * Envía una lista interactiva con los próximos días que tienen turnos.
 * dias: array de { fecha: 'YYYY-MM-DD', cantidad }
 */
async function enviarListaDias(to, dias, tipo = 'padel') {
  const hoyStr = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });

  const nombresDia = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const mananaStr = manana.toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });

  const rows = dias.slice(0, 10).map((d) => {
    const partes = d.fecha.split('-').map(Number);
    const fechaObj = new Date(partes[0], partes[1] - 1, partes[2]);
    const dow = nombresDia[fechaObj.getDay()];
    const dd = partes[2];
    const mes = meses[partes[1] - 1];

    let etiqueta;
    if (d.fecha === hoyStr) etiqueta = 'Hoy';
    else if (d.fecha === mananaStr) etiqueta = 'Mañana';
    else etiqueta = `${dow} ${dd}/${mes}`;

    return {
      id: `dia_${d.fecha}`,
      title: etiqueta,
      description: `${d.cantidad} turno${d.cantidad === 1 ? '' : 's'} disponible${d.cantidad === 1 ? '' : 's'}`,
    };
  });

  return enviar({
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Elegí un día' },
      body: { text: '¿Para qué día querés reservar? 📅' },
      footer: { text: 'Club Pádel' },
      action: {
        button: 'Ver días',
        sections: [{ title: 'Próximos días', rows }],
      },
    },
  });
}

/**
 * Pregunta si quiere turnos de la mañana o de la tarde/noche.
 * La fecha viaja dentro del id para no perder el contexto:
 *   franja_manana_YYYY-MM-DD  /  franja_tarde_YYYY-MM-DD
 */
async function enviarBotonesFranja(to, fecha) {
  return enviar({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: '¿Qué horario preferís? ⏰',
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `franja_manana_${fecha}`, title: '🌅 Mañana' } },
          { type: 'reply', reply: { id: `franja_tarde_${fecha}`, title: '🌆 Tarde/Noche' } },
        ],
      },
    },
  });
}

module.exports = {
  enviarMenuDeportes,
  enviarListaDias,
  enviarListaTurnos,
  enviarTexto,
  enviarBotonesPago,
  enviarBotonesFranja,
};
