const router = require('express').Router();
const pool = require('../config/db');
const { generarTurnosDelDia, generarProximosDias } = require('../services/generadorTurnos');
const { disponiblesHoy, disponiblesPorCanchaFecha } = require('../services/turnosService');
const { reservarTurno, cancelarReserva, registrarPago } = require('../services/reservaService');

// Generar turnos de una cancha para una fecha
router.post('/generar', async (req, res) => {
  const { canchaId, fecha } = req.body;
  try {
    const t = await generarTurnosDelDia(canchaId, fecha);
    res.json({ generados: t.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Generar turnos de todas las canchas para los próximos N días
router.post('/generar-proximos', async (req, res) => {
  const { dias } = req.body;
  const total = await generarProximosDias(dias || 7);
  res.json({ generados: total });
});

// Listar disponibles por cancha y fecha (panel admin)
router.get('/disponibles', async (req, res) => {
  const { canchaId, fecha } = req.query;
  const rows = await disponiblesPorCanchaFecha(canchaId, fecha);
  res.json(rows);
});

// Listar disponibles de hoy (opcional filtro por tipo)
router.get('/hoy', async (req, res) => {
  const rows = await disponiblesHoy({ tipo: req.query.tipo });
  res.json(rows);
});

// Reservar con manejo de concurrencia
router.post('/:id/reservar', async (req, res) => {
  const { clienteId, tipo, descripcion, monto } = req.body;
  const r = await reservarTurno({ turnoId: req.params.id, clienteId, tipo, descripcion, monto });
  if (!r) return res.status(409).json({ error: 'turno_no_disponible' });
  res.status(201).json(r);
});

// Cancelar reserva
router.post('/reservas/:id/cancelar', async (req, res) => {
  const ok = await cancelarReserva(req.params.id);
  if (!ok) return res.status(404).json({ error: 'reserva_inexistente' });
  res.json({ ok: true });
});

// Registrar pago
router.post('/reservas/:id/pago', async (req, res) => {
  const { medioPago, monto } = req.body;
  const r = await registrarPago(req.params.id, { medioPago, monto });
  if (!r) return res.status(404).json({ error: 'reserva_inexistente' });
  res.json(r);
});

// Bloquear rango para evento (cumpleaños/torneo)
router.post('/bloquear-evento', async (req, res) => {
  const { canchaId, inicio, fin, descripcion } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE turnos SET estado='bloqueado'
       WHERE cancha_id=$1 AND estado='disponible' AND inicio >= $2 AND inicio < $3
       RETURNING id`,
      [canchaId, inicio, fin]
    );
    await client.query('COMMIT');
    res.json({ bloqueados: upd.rowCount, descripcion });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Ver reservas (panel admin)
router.get('/reservas', async (req, res) => {
  const { fecha } = req.query;
  const { rows } = await pool.query(
    `SELECT r.id, r.tipo, r.descripcion, r.pagado, r.medio_pago, r.monto,
            t.inicio, t.fin, c.nombre AS cancha, c.tipo AS deporte,
            cl.nombre AS cliente_nombre, cl.telefono
     FROM reservas r
     JOIN turnos t ON t.id = r.turno_id
     JOIN canchas c ON c.id = t.cancha_id
     JOIN clientes cl ON cl.id = r.cliente_id
     ${fecha ? 'WHERE t.inicio::date = $1::date' : ''}
     ORDER BY t.inicio`,
    fecha ? [fecha] : []
  );
  res.json(rows);
});

module.exports = router;
