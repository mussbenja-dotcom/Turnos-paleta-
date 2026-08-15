const TOKEN = process.env.WA_TOKEN;
const PHONE_ID = process.env.WA_PHONE_ID;
const API_VERSION = process.env.WA_API_VERSION || 'v21.0';
const URL = `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}/messages`;

async function enviar(payload) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  const data = await r.json();
  if (!r.ok) console.error('Error WhatsApp API:', JSON.stringify(data));
  return data;
}

function fmtHora(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/**
 * Envía una lista interactiva con los deportes disponibles.
 */
async function enviarMenuDeportes(to) {
  return enviar({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: '¡Hola! 🎾 ¿Qué querés reservar hoy?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'deporte_padel', title: 'Pádel' } },
          { type: 'reply', reply: { id: 'deporte_paleta', title: 'Paleta' } },
          { type: 'reply', reply: { id: 'deporte_tenis', title: 'Tenis' } },
        ],
      },
    },
  });
}

/**
 * Envía una lista interactiva con los turnos disponibles.
 * WhatsApp permite máximo 10 filas por lista.
 */
async function enviarListaTurnos(to, turnos, titulo = 'Turnos disponibles') {
  const rows = turnos.slice(0, 10).map((t) => ({
    id: `turno_${t.id}`, // este id vuelve en el webhook al hacer clic
    title: `${fmtHora(t.inicio)} - ${fmtHora(t.fin)}`,
    description: `${t.cancha_nombre || 'Cancha'} · ${t.tipo || ''}`.trim(),
  }));

  return enviar({
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: titulo },
      body: { text: 'Elegí un horario para reservar 👇' },
      footer: { text: 'Club Pádel' },
      action: {
        button: 'Ver horarios',
        sections: [{ title: 'Disponibles hoy', rows }],
      },
    },
  });
}

async function enviarTexto(to, text) {
  return enviar({ to, type: 'text', text: { body: text } });
}

module.exports = { enviarMenuDeportes, enviarListaTurnos, enviarTexto };
