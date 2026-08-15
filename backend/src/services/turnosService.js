const pool = require('../config/db');

/**
 * Devuelve turnos disponibles para hoy, opcionalmente filtrados por tipo de deporte.
 * Incluye nombre y tipo de cancha para mostrar en la lista de WhatsApp.
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

module.exports = { disponiblesHoy, disponiblesPorCanchaFecha };
