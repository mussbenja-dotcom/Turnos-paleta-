const pool = require('../config/db');

/**
 * Reserva atómica de un turno.
 *
 * Concurrencia resuelta a nivel de BASE DE DATOS con dos barreras:
 *   1) UPDATE condicional: sólo cambia el estado si el turno sigue 'disponible'.
 *      Se verifica rowCount: si es 0, otro usuario lo tomó primero.
 *   2) CONSTRAINT UNIQUE(turno_id) en reservas: última red de seguridad; si por
 *      alguna carrera se intenta doble insert, el segundo falla con código 23505.
 *
 * Todo ocurre dentro de una única transacción (BEGIN/COMMIT/ROLLBACK).
 *
 * @returns {Object|null} la reserva creada, o null si el turno ya no estaba disponible.
 */
async function reservarTurno({ turnoId, clienteId, tipo = 'estandar', descripcion = null, monto = null, nombreReserva = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Intento tomar el turno SOLO si sigue disponible.
    const upd = await client.query(
      `UPDATE turnos SET estado = 'reservado', expira_en = NULL
       WHERE id = $1 AND estado = 'disponible'`,
      [turnoId]
    );

    // 2) Si no afectó ninguna fila, otro lo tomó primero (o no está disponible).
    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    // 3) Creo la reserva. El UNIQUE(turno_id) es la última barrera.
    const res = await client.query(
      `INSERT INTO reservas (turno_id, cliente_id, tipo, descripcion, monto, nombre_reserva)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [turnoId, clienteId, tipo, descripcion, monto, nombreReserva]
    );

    await client.query('COMMIT');
    return res.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return null; // violación UNIQUE = carrera perdida
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Cancela una reserva y libera el turno (vuelve a 'disponible').
 */
async function cancelarReserva(reservaId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT turno_id FROM reservas WHERE id=$1', [reservaId]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(`UPDATE turnos SET estado='disponible' WHERE id=$1`, [rows[0].turno_id]);
    await client.query('DELETE FROM reservas WHERE id=$1', [reservaId]);
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Registra el pago de una reserva.
 */
async function registrarPago(reservaId, { medioPago, monto }) {
  const { rows } = await pool.query(
    `UPDATE reservas SET pagado=true, medio_pago=$2, monto=COALESCE($3, monto)
     WHERE id=$1 RETURNING *`,
    [reservaId, medioPago, monto]
  );
  return rows[0] || null;
}

/**
 * Reserva manual desde el panel admin.
 * Busca o crea un cliente por nombre (teléfono opcional) y reserva el turno.
 * Marca es_fijo=true si es parte de un turno recurrente.
 */
async function reservarManual({ turnoId, nombre, telefono = null, esFijo = false }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Tomamos el turno solo si sigue disponible.
    const upd = await client.query(
      `UPDATE turnos SET estado = 'reservado', expira_en = NULL
       WHERE id = $1 AND estado = 'disponible'`,
      [turnoId]
    );

    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      return null; // ya estaba ocupado
    }

    // Buscamos o creamos un cliente. Si no hay teléfono, usamos un placeholder único.
    const tel = telefono || ('manual_' + Date.now() + '_' + Math.floor(Math.random() * 1000));

    const cli = await client.query(
      `INSERT INTO clientes (telefono, nombre)
       VALUES ($1, $2)
       ON CONFLICT (telefono) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id`,
      [tel, nombre]
    );
    const clienteId = cli.rows[0].id;

    const res = await client.query(
      `INSERT INTO reservas (turno_id, cliente_id, tipo, nombre_reserva, es_fijo)
       VALUES ($1, $2, 'estandar', $3, $4) RETURNING *`,
      [turnoId, clienteId, nombre, esFijo]
    );

    await client.query('COMMIT');
    return res.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return null;
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Reserva recurrente: reserva el turno base y los mismos día/hora/cancha
 * durante las próximas (semanas-1) semanas. Devuelve cuántos se reservaron.
 */
async function reservarRecurrente({ turnoId, nombre, telefono = null, semanas = 4 }) {
  // Datos del turno base
  const { rows } = await pool.query(
    `SELECT cancha_id, inicio, fin FROM turnos WHERE id = $1`,
    [turnoId]
  );
  if (!rows[0]) return { reservados: 0, total: 0 };

  const base = rows[0];
  let reservados = 0;
  const total = semanas;

  for (let i = 0; i < semanas; i++) {
    let turnoObjetivo;

    if (i === 0) {
      turnoObjetivo = turnoId;
    } else {
      // Buscamos el turno que cae exactamente 7*i días después, misma cancha.
      const q = await pool.query(
        `SELECT id FROM turnos
         WHERE cancha_id = $1
           AND inicio = ($2::timestamptz + ($3 || ' days')::interval)
           AND estado = 'disponible'`,
        [base.cancha_id, base.inicio, String(7 * i)]
      );
      turnoObjetivo = q.rows[0]?.id;
    }

    if (!turnoObjetivo) continue; // ese turno no existe o no está libre

    const r = await reservarManual({
      turnoId: turnoObjetivo,
      nombre,
      telefono,
      esFijo: true,
    });
    if (r) reservados++;
  }

  return { reservados, total };
}

module.exports = { reservarTurno, cancelarReserva, registrarPago, reservarManual, reservarRecurrente };
