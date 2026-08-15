const cron = require('node-cron');
const pool = require('../config/db');
const { generarProximosDias } = require('../services/generadorTurnos');

function iniciarCronJobs() {
  // 1) Todas las noches a las 03:00 → generar turnos de los próximos 7 días.
  cron.schedule('0 3 * * *', async () => {
    try {
      const total = await generarProximosDias(7);
      console.log(`[cron] Generados ${total} turnos para los próximos 7 días`);
    } catch (e) {
      console.error('[cron] Error generando turnos:', e);
    }
  });

  // 2) Cada 2 minutos → liberar turnos 'pendiente' cuyo TTL venció.
  //    (Útil si más adelante agregás un flujo de reserva con confirmación en 2 pasos.)
  cron.schedule('*/2 * * * *', async () => {
    try {
      const r = await pool.query(
        `UPDATE turnos SET estado='disponible', expira_en=NULL
         WHERE estado='pendiente' AND expira_en < now()`
      );
      if (r.rowCount > 0) console.log(`[cron] Liberados ${r.rowCount} turnos pendientes vencidos`);
    } catch (e) {
      console.error('[cron] Error liberando pendientes:', e);
    }
  });

  // 3) Cada noche a las 02:00 → marcar como 'completado' los turnos reservados ya pasados.
  cron.schedule('0 2 * * *', async () => {
    try {
      const r = await pool.query(
        `UPDATE turnos SET estado='completado'
         WHERE estado='reservado' AND fin < now()`
      );
      if (r.rowCount > 0) console.log(`[cron] Marcados ${r.rowCount} turnos como completados`);
    } catch (e) {
      console.error('[cron] Error marcando completados:', e);
    }
  });

  console.log('Cron jobs iniciados ✓');
}

module.exports = { iniciarCronJobs };
