const router = require('express').Router();
const pool = require('../config/db');

// Listar canchas (opcional: por club)
router.get('/', async (req, res) => {
  const { clubId } = req.query;
  const q = clubId
    ? await pool.query('SELECT * FROM canchas WHERE club_id=$1 ORDER BY id', [clubId])
    : await pool.query('SELECT * FROM canchas ORDER BY id');
  res.json(q.rows);
});

// Crear cancha
router.post('/', async (req, res) => {
  const { club_id, nombre, tipo, hora_apertura, hora_cierre, duracion_min, precio } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO canchas (club_id, nombre, tipo, hora_apertura, hora_cierre, duracion_min, precio)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [club_id, nombre, tipo, hora_apertura, hora_cierre, duracion_min || 90, precio || 0]
  );
  res.status(201).json(rows[0]);
});

// Editar cancha
router.put('/:id', async (req, res) => {
  const { nombre, tipo, hora_apertura, hora_cierre, duracion_min, precio, activa } = req.body;
  const { rows } = await pool.query(
    `UPDATE canchas SET nombre=$2, tipo=$3, hora_apertura=$4, hora_cierre=$5,
       duracion_min=$6, precio=$7, activa=$8 WHERE id=$1 RETURNING *`,
    [req.params.id, nombre, tipo, hora_apertura, hora_cierre, duracion_min, precio, activa]
  );
  res.json(rows[0]);
});

// Eliminar cancha
router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM canchas WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
