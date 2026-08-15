const pool = require('../config/db');

const TZ = process.env.TZ_OFFSET || '-03:00'; // Argentina

/**
 * Genera los turnos disponibles de una cancha para una fecha (YYYY-MM-DD).
 * Idempotente: usa ON CONFLICT para no duplicar si se corre dos veces.
 */
async function generarTurnosDelDia(canchaId, fecha) {
  const { rows } = await pool.query('SELECT * FROM canchas WHERE id=$1', [canchaId]);
  const c = rows[0];
  if (!c) throw new Error('Cancha inexistente');
  if (!c.activa) return [];

  const [ha, ma] = c.hora_apertura.split(':').map(Number);
  const [hc, mc] = c.hora_cierre.split(':').map(Number);

  let cursor = new Date(`${fecha}T00:00:00${TZ}`);
  cursor.setHours(ha, ma, 0, 0);
  const cierre = new Date(`${fecha}T00:00:00${TZ}`);
  cierre.setHours(hc, mc, 0, 0);

  const generados = [];
  while (cursor < cierre) {
    const fin = new Date(cursor.getTime() + c.duracion_min * 60000);
    if (fin > cierre) break;

    const r = await pool.query(
      `INSERT INTO turnos (cancha_id, inicio, fin)
       VALUES ($1,$2,$3)
       ON CONFLICT (cancha_id, inicio) DO NOTHING
       RETURNING *`,
      [canchaId, cursor.toISOString(), fin.toISOString()]
    );
    if (r.rows[0]) generados.push(r.rows[0]);
    cursor = fin;
  }
  return generados;
}

/**
 * Genera turnos para TODAS las canchas activas, para los próximos N días.
 * Lo usa el cron nocturno.
 */
async function generarProximosDias(dias = 7) {
  const { rows: canchas } = await pool.query('SELECT id FROM canchas WHERE activa = true');
  let total = 0;
  for (let d = 0; d < dias; d++) {
    const f = new Date();
    f.setDate(f.getDate() + d);
    const fecha = f.toISOString().slice(0, 10);
    for (const cancha of canchas) {
      const g = await generarTurnosDelDia(cancha.id, fecha);
      total += g.length;
    }
  }
  return total;
}

module.exports = { generarTurnosDelDia, generarProximosDias };
