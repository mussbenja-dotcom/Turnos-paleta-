const { Pool } = require('pg');

// En la nube (Railway, Render, etc.) la conexión suele requerir SSL.
// Localmente no. Se controla con la variable DB_SSL.
const useSSL = process.env.DB_SSL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL', err);
});

module.exports = pool;
