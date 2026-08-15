const router = require('express').Router();
const pool = require('../config/db');

// Listar clubes
router.get('/', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM clubes ORDER BY id');
  res.json(rows);
});

// Crear club
router.post('/', async (req, res) => {
  const { nombre, direccion, telefono } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO clubes (nombre, direccion, telefono) VALUES ($1,$2,$3) RETURNING *`,
    [nombre, direccion, telefono]
  );
  res.status(201).json(rows[0]);
});

// Editar club
router.put('/:id', async (req, res) => {
  const { nombre, direccion, telefono } = req.body;
  const { rows } = await pool.query(
    `UPDATE clubes SET nombre=$2, direccion=$3, telefono=$4 WHERE id=$1 RETURNING *`,
    [req.params.id, nombre, direccion, telefono]
  );
  res.json(rows[0]);
});

module.exports = router;
