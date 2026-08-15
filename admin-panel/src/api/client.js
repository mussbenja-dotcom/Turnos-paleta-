const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function req(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!r.ok) throw new Error((await r.json()).error || 'Error');
  return r.status === 204 ? null : r.json();
}

export const api = {
  // Clubes
  listClubes: () => req('/api/clubes'),
  crearClub: (data) => req('/api/clubes', { method: 'POST', body: JSON.stringify(data) }),

  // Canchas
  listCanchas: (clubId) => req(`/api/canchas${clubId ? `?clubId=${clubId}` : ''}`),
  crearCancha: (data) => req('/api/canchas', { method: 'POST', body: JSON.stringify(data) }),
  editarCancha: (id, data) => req(`/api/canchas/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  borrarCancha: (id) => req(`/api/canchas/${id}`, { method: 'DELETE' }),

  // Turnos
  generarProximos: (dias) => req('/api/turnos/generar-proximos', { method: 'POST', body: JSON.stringify({ dias }) }),
  disponibles: (canchaId, fecha) => req(`/api/turnos/disponibles?canchaId=${canchaId}&fecha=${fecha}`),
  bloquearEvento: (data) => req('/api/turnos/bloquear-evento', { method: 'POST', body: JSON.stringify(data) }),
  reservas: (fecha) => req(`/api/turnos/reservas${fecha ? `?fecha=${fecha}` : ''}`),
  cancelarReserva: (id) => req(`/api/turnos/reservas/${id}/cancelar`, { method: 'POST' }),
  registrarPago: (id, data) => req(`/api/turnos/reservas/${id}/pago`, { method: 'POST', body: JSON.stringify(data) }),
};
