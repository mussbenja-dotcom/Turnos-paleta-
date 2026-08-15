const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

/**
 * Ejecuta schema.sql (y opcionalmente seed.sql) contra la base configurada
 * en DATABASE_URL. Pensado para correr una sola vez al desplegar en la nube.
 *
 *   node src/db/init.js          → solo schema
 *   node src/db/init.js --seed   → schema + datos de ejemplo
 */
async function init() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✓ Schema aplicado');

    if (process.argv.includes('--seed')) {
      const seed = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
      await pool.query(seed);
      console.log('✓ Datos de ejemplo cargados');
    }

    console.log('Base de datos lista.');
    process.exit(0);
  } catch (e) {
    console.error('Error inicializando la base:', e.message);
    process.exit(1);
  }
}

init();
