require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { iniciarCronJobs } = require('./jobs/cron');

const app = express();
app.use(cors());
app.use(express.json());

// Rutas
app.use('/api/clubes', require('./routes/clubes'));
app.use('/api/canchas', require('./routes/canchas'));
app.use('/api/turnos', require('./routes/turnos'));
app.use('/whatsapp', require('./routes/whatsapp'));

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API corriendo en http://localhost:${PORT}`);
  if (process.env.ENABLE_CRON !== 'false') iniciarCronJobs();
});
