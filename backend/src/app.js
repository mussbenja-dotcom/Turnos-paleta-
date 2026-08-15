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
app.use('/admin', require('./routes/admin'));

// Política de privacidad
app.get('/privacy', (_req, res) => {
  res.type('html').send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Política de Privacidad - Turnos Paleta</title>
    </head>
    <body>
      <h1>Política de Privacidad</h1>

      <p>Turnos Paleta utiliza los datos proporcionados por los usuarios
      exclusivamente para gestionar turnos, comunicaciones y funcionalidades
      relacionadas con el servicio.</p>

      <p>Los datos pueden incluir nombre, número de teléfono y datos necesarios
      para la gestión de reservas y comunicaciones mediante WhatsApp.</p>

      <p>La información no será vendida ni utilizada para fines ajenos al servicio.</p>

      <p>Los usuarios podrán solicitar información, modificación o eliminación
      de sus datos personales.</p>

      <p>Última actualización: 15 de agosto de 2026.</p>
    </body>
    </html>
  `);
});

// Condiciones del servicio
app.get('/terms', (_req, res) => {
  res.type('html').send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Condiciones del Servicio - Turnos Paleta</title>
    </head>
    <body>
      <h1>Condiciones del Servicio</h1>

      <p>Turnos Paleta es una herramienta destinada a facilitar la gestión
      de turnos y comunicaciones relacionadas con reservas.</p>

      <p>El usuario se compromete a proporcionar información correcta y utilizar
      el servicio de manera lícita.</p>

      <p>La disponibilidad de los turnos dependerá de la información registrada
      por cada establecimiento.</p>

      <p>El servicio podrá ser modificado o actualizado cuando resulte necesario.</p>

      <p>Última actualización: 15 de agosto de 2026.</p>
    </body>
    </html>
  `);
});

// Eliminación de datos
app.get('/data-deletion', (_req, res) => {
  res.type('html').send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Eliminación de Datos - Turnos Paleta</title>
    </head>
    <body>
      <h1>Solicitud de eliminación de datos</h1>

      <p>Los usuarios pueden solicitar la eliminación de sus datos personales
      almacenados por Turnos Paleta.</p>

      <p>Para solicitar la eliminación, deberán comunicarse con el responsable
      de la aplicación indicando su nombre y número de teléfono utilizado
      en el servicio.</p>

      <p>Una vez recibida y verificada la solicitud, se procederá a eliminar
      los datos correspondientes cuando legal y técnicamente corresponda.</p>
    </body>
    </html>
  `);
});

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API corriendo en http://localhost:${PORT}`);
  if (process.env.ENABLE_CRON !== 'false') iniciarCronJobs();
});
