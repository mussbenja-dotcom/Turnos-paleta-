const pool = require('../config/db');

// Valores por defecto si la tabla todavía no tiene fila.
const DEFAULTS = {
  precio: 0,
  alias: process.env.ALIAS_PAGO || 'club.padel.mp',
};

/**
 * Devuelve la configuración del club (precio del turno y alias de transferencia).
 * Si no existe la fila, devuelve los valores por defecto.
 */
async function obtenerConfig() {
  try {
    const { rows } = await pool.query(
      `SELECT precio, alias FROM configuracion WHERE id = 1`
    );
    if (!rows.length) return { ...DEFAULTS };
    return {
      precio: Number(rows[0].precio) || 0,
      alias: rows[0].alias || DEFAULTS.alias,
    };
  } catch (e) {
    console.error('Error obteniendo configuración:', e.message);
    return { ...DEFAULTS };
  }
}

/**
 * Guarda precio y/o alias. Solo actualiza los campos que se pasen.
 */
async function guardarConfig({ precio, alias }) {
  const precioNum =
    precio != null && precio !== '' ? Number(precio) : null;

  if (precioNum != null && (isNaN(precioNum) || precioNum < 0)) {
    throw new Error('Precio inválido');
  }

  const aliasLimpio =
    alias != null ? String(alias).trim() : null;

  await pool.query(
    `INSERT INTO configuracion (id, precio, alias)
     VALUES (1, COALESCE($1, 0), COALESCE($2, $3))
     ON CONFLICT (id) DO UPDATE SET
       precio = COALESCE($1, configuracion.precio),
       alias  = COALESCE($2, configuracion.alias)`,
    [precioNum, aliasLimpio, DEFAULTS.alias]
  );

  return obtenerConfig();
}

module.exports = { obtenerConfig, guardarConfig };
