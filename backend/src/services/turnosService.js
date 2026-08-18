const pool = require('../config/db');

const TZ = 'America/Argentina/Buenos_Aires';

/**
 * Devuelve turnos disponibles para hoy, opcionalmente filtrados por tipo de deporte.
 * (Se mantiene por compatibilidad.)
 */
async function disponiblesHoy({ tipo = null, limit = 10 } = {}) {
  const params = [];
  let where = `t.estado='disponible' AND t.inicio::date = CURRENT_DATE AND t.inicio > now()`;
  if (tipo) {
    params.push(tipo);
    where += ` AND c.tipo = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT t.id, t.inicio, t.fin, c.nombre AS cancha_nombre, c.tipo
     FROM turnos t
     JOIN canchas c ON c.id = t.cancha_id
     WHERE ${where}
     ORDER BY t.inicio
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

/**
 * Turnos disponibles de un tipo de deporte para UNA fecha concreta (YYYY-MM-DD),
 * en zona horaria de Argentina. Solo turnos que todavía no pasaron.
 */
async function disponiblesPorFecha({ tipo, fecha, limit = 10, franja = null }) {
  // franja: 'manana' => 07:00 a 11:59 | 'tarde' => 12:00 en adelante | null => todo el día
  let filtroFranja = '';
  if (franja === 'manana') {
    filtroFranja = ` AND EXTRACT(HOUR FROM (t.inicio AT TIME ZONE '${TZ}')) < 12`;
  } else if (franja === 'tarde') {
    filtroFranja = ` AND EXTRACT(HOUR FROM (t.inicio AT TIME ZONE '${TZ}')) >= 12`;
  }
  const { rows } = await pool.query(
    `SELECT t.id, t.inicio, t.fin, c.nombre AS cancha_nombre, c.tipo
     FROM turnos t
     JOIN canchas c ON c.id = t.cancha_id
     WHERE t.estado = 'disponible'
       AND c.tipo = $1
       AND (t.inicio AT TIME ZONE '${TZ}')::date = $2::date
       AND t.inicio > now()
       ${filtroFranja}
     ORDER BY t.inicio
     LIMIT $3`,
    [tipo, fecha, limit]
  );
  return rows;
}

/**
 * Devuelve los próximos N días (a partir de hoy) que tienen al menos un turno
 * disponible del tipo indicado. Cada item: { fecha: 'YYYY-MM-DD', cantidad }.
 * Sirve para armar el menú "elegí un día".
 */
async function diasConDisponibilidad({ tipo, dias = 7 }) {
  const { rows } = await pool.query(
    `SELECT
        (t.inicio AT TIME ZONE '${TZ}')::date AS fecha,
        COUNT(*) AS cantidad
     FROM turnos t
     JOIN canchas c ON c.id = t.cancha_id
     WHERE t.estado = 'disponible'
       AND c.tipo = $1
       AND t.inicio > now()
       AND (t.inicio AT TIME ZONE '${TZ}')::date
           < (now() AT TIME ZONE '${TZ}')::date + ($2::int)
     GROUP BY 1
     ORDER BY 1`,
    [tipo, dias]
  );
  return rows.map((r) => ({
    // r.fecha viene como Date; lo pasamos a 'YYYY-MM-DD'
    fecha: new Date(r.fecha).toISOString().slice(0, 10),
    cantidad: Number(r.cantidad),
  }));
}

/**
 * Turnos disponibles por cancha y fecha (para el panel admin).
 */
async function disponiblesPorCanchaFecha(canchaId, fecha) {
  const { rows } = await pool.query(
    `SELECT id, inicio, fin, estado FROM turnos
     WHERE cancha_id=$1 AND inicio::date = $2::date
     ORDER BY inicio`,
    [canchaId, fecha]
  );
  return rows;
}

module.exports = {
  disponiblesHoy,
  disponiblesPorFecha,
  diasConDisponibilidad,
  disponiblesPorCanchaFecha,
};
