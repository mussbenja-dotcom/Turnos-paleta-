const TOKEN = process.env.WA_TOKEN;
const PHONE_ID = process.env.WA_PHONE_ID;
const API_VERSION = process.env.WA_API_VERSION || 'v21.0';

const URL = `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}/messages`;

/**
 * Conversión temporal SOLO para la prueba con Meta.
 *
 * WhatsApp recibe el mensaje entrante como:
 * 5493382461766
 *
 * Pero Meta tiene autorizado como destinatario de prueba:
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
 * Formatea una fecha/hora para mostrar solamente la hora.
 */
function fmtHora(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
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
          {
            type: 'reply',
            reply: {
              id: 'deporte_paleta',
              title: 'Paleta',
            },
          },
          {
            type: 'reply',
            reply: {
              id: 'deporte_tenis',
              title: 'Tenis',
            },
          },
        ],
      },
    },
  });
}

/**
 * Envía una lista interactiva con los turnos disponibles.
 *
 * WhatsApp permite máximo 10 filas por lista.
 */
async function enviarListaTurnos(
  to,
  turnos,
  titulo = 'Turnos disponibles'
) {
  const rows = turnos.slice(0, 10).map((t) => ({
    id: `turno_${t.id}`,

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

module.exports = {
  enviarMenuDeportes,
  enviarListaTurnos,
  enviarTexto,
};
