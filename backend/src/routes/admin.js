const router = require('express').Router();
const pool = require('../config/db');
const { generarProximosDias } = require('../services/generadorTurnos');
const { reservarManual, reservarRecurrente, cancelarReserva, registrarPago } = require('../services/reservaService');
const { obtenerConfig, guardarConfig } = require('../services/configService');

// ================================================================
// PROTECCIÓN DEL PANEL
// ================================================================

function requireAdmin(req, res, next) {
  const ADMIN_USER = process.env.ADMIN_USER || 'club';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!ADMIN_PASSWORD) {
    return res
      .status(503)
      .send('Falta configurar ADMIN_PASSWORD en Railway.');
  }

  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader(
      'WWW-Authenticate',
      'Basic realm="Panel del Club"'
    );

    return res.status(401).send('Autenticación requerida');
  }

  try {
    const decoded = Buffer
      .from(auth.split(' ')[1], 'base64')
      .toString('utf8');

    const separator = decoded.indexOf(':');

    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    if (
      user !== ADMIN_USER ||
      password !== ADMIN_PASSWORD
    ) {
      res.setHeader(
        'WWW-Authenticate',
        'Basic realm="Panel del Club"'
      );

      return res.status(401).send('Usuario o contraseña incorrectos');
    }

    next();
  } catch (e) {
    return res.status(401).send('Autenticación inválida');
  }
}

router.use(requireAdmin);

// ================================================================
// API - AGENDA DEL CLUB
// ================================================================

router.get('/api/agenda', async (req, res) => {
  try {
    const fecha =
      req.query.fecha ||
      new Date().toLocaleDateString('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
      });

    const { rows } = await pool.query(
      `
      SELECT
        t.id,
        t.inicio,
        t.fin,
        t.estado,
        t.motivo_bloqueo,

        c.id AS cancha_id,
        c.nombre AS cancha_nombre,
        c.tipo AS deporte,

        r.id AS reserva_id,
        r.pagado,
        r.medio_pago,
        r.es_fijo,
        r.monto,

        cl.id AS cliente_id,
        COALESCE(r.nombre_reserva, cl.nombre) AS cliente_nombre,
        cl.telefono AS cliente_telefono

      FROM turnos t

      JOIN canchas c
        ON c.id = t.cancha_id

      LEFT JOIN reservas r
        ON r.turno_id = t.id

      LEFT JOIN clientes cl
        ON cl.id = r.cliente_id

      WHERE
        (
          t.inicio
          AT TIME ZONE 'America/Argentina/Buenos_Aires'
        )::date = $1::date
        AND c.tipo = 'padel'

      ORDER BY
        t.inicio,
        c.nombre
      `,
      [fecha]
    );

    res.json({
      fecha,
      turnos: rows,
    });

  } catch (e) {
    console.error('Error agenda admin:', e);

    res.status(500).json({
      error: 'No se pudo cargar la agenda',
      detalle: e.message,
    });
  }
});

// ================================================================
// PANEL WEB
// ================================================================

router.post('/api/reservar', async (req, res) => {
  try {
    const { turnoId, nombre, recurrente } = req.body || {};

    if (!turnoId || !nombre || String(nombre).trim().length < 2) {
      return res.status(400).json({ error: 'Falta turno o nombre.' });
    }

    if (recurrente) {
      const r = await reservarRecurrente({
        turnoId,
        nombre: String(nombre).trim(),
        semanas: 4,
      });
      return res.json({ ok: true, ...r });
    }

    const reserva = await reservarManual({
      turnoId,
      nombre: String(nombre).trim(),
    });

    if (!reserva) {
      return res.status(409).json({ error: 'Ese turno ya no está disponible.' });
    }

    res.json({ ok: true, reservados: 1, total: 1 });
  } catch (e) {
    console.error('Error reservar manual:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/cancelar', async (req, res) => {
  try {
    const { reservaId } = req.body || {};
    if (!reservaId) {
      return res.status(400).json({ error: 'Falta la reserva.' });
    }
    const ok = await cancelarReserva(reservaId);
    if (!ok) {
      return res.status(404).json({ error: 'No se encontró la reserva.' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Error cancelar reserva:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/pagar', async (req, res) => {
  try {
    const { reservaId, monto, medioPago, desmarcar } = req.body || {};
    if (!reservaId) {
      return res.status(400).json({ error: 'Falta la reserva.' });
    }

    if (desmarcar) {
      await pool.query(
        `UPDATE reservas SET pagado = false WHERE id = $1`,
        [reservaId]
      );
      return res.json({ ok: true });
    }

    const montoNum = monto != null && monto !== '' ? Number(monto) : null;
    if (montoNum != null && (isNaN(montoNum) || montoNum < 0)) {
      return res.status(400).json({ error: 'Monto inválido.' });
    }

    const r = await registrarPago(reservaId, {
      medioPago: medioPago || 'efectivo',
      monto: montoNum,
    });

    if (!r) {
      return res.status(404).json({ error: 'No se encontró la reserva.' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Error registrar pago:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/bloquear', async (req, res) => {
  try {
    const { turnoId, motivo } = req.body || {};
    if (!turnoId) {
      return res.status(400).json({ error: 'Falta el turno.' });
    }
    const upd = await pool.query(
      `UPDATE turnos
       SET estado = 'bloqueado', motivo_bloqueo = $2
       WHERE id = $1 AND estado = 'disponible'
       RETURNING id`,
      [turnoId, motivo || null]
    );
    if (upd.rowCount === 0) {
      return res.status(409).json({ error: 'El turno no está disponible para bloquear.' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Error bloquear:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/desbloquear', async (req, res) => {
  try {
    const { turnoId } = req.body || {};
    if (!turnoId) {
      return res.status(400).json({ error: 'Falta el turno.' });
    }
    const upd = await pool.query(
      `UPDATE turnos
       SET estado = 'disponible', motivo_bloqueo = NULL
       WHERE id = $1 AND estado = 'bloqueado'
       RETURNING id`,
      [turnoId]
    );
    if (upd.rowCount === 0) {
      return res.status(409).json({ error: 'El turno no estaba bloqueado.' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Error desbloquear:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/ingresos', async (req, res) => {
  try {
    // mes en formato 'YYYY-MM'; por defecto el mes actual (hora Argentina)
    const mes = req.query.mes ||
      new Date().toLocaleDateString('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
      }).slice(0, 7);

    // Sumamos las reservas PAGADAS cuyo turno cae en ese mes.
    const { rows } = await pool.query(
      `SELECT
          COALESCE(r.medio_pago, 'sin_dato') AS medio,
          COUNT(*)::int AS cantidad,
          COALESCE(SUM(r.monto), 0) AS total
       FROM reservas r
       JOIN turnos t ON t.id = r.turno_id
       WHERE r.pagado = true
         AND to_char(
               (t.inicio AT TIME ZONE 'America/Argentina/Buenos_Aires'),
               'YYYY-MM'
             ) = $1
       GROUP BY 1`,
      [mes]
    );

    let total = 0;
    let cantidad = 0;
    const porMedio = { efectivo: 0, transferencia: 0, tarjeta: 0, sin_dato: 0 };

    rows.forEach((r) => {
      const t = Number(r.total) || 0;
      total += t;
      cantidad += r.cantidad;
      if (porMedio[r.medio] === undefined) porMedio[r.medio] = 0;
      porMedio[r.medio] += t;
    });

    res.json({ mes, total, cantidad, porMedio });
  } catch (e) {
    console.error('Error ingresos:', e);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// CONFIGURACIÓN DEL CLUB (precio del turno + alias de transferencia)
// =====================================================================
router.get('/api/config', async (_req, res) => {
  try {
    const config = await obtenerConfig();
    res.json(config);
  } catch (e) {
    console.error('Error obtener config:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/config', async (req, res) => {
  try {
    const { precio, alias } = req.body || {};
    const config = await guardarConfig({ precio, alias });
    res.json({ ok: true, ...config });
  } catch (e) {
    console.error('Error guardar config:', e);
    res.status(400).json({ error: e.message });
  }
});

// =====================================================================
// BUSCAR RESERVAS por nombre o teléfono (futuras)
// =====================================================================
router.get('/api/buscar', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ resultados: [] });
    }
    const like = '%' + q + '%';
    const { rows } = await pool.query(
      `
      SELECT
        r.id AS reserva_id,
        COALESCE(r.nombre_reserva, cl.nombre) AS cliente_nombre,
        cl.telefono AS cliente_telefono,
        c.nombre AS cancha_nombre,
        t.inicio,
        t.fin,
        r.pagado,
        r.medio_pago,
        r.monto,
        r.es_fijo
      FROM reservas r
      JOIN turnos  t  ON t.id = r.turno_id
      JOIN canchas c  ON c.id = t.cancha_id
      JOIN clientes cl ON cl.id = r.cliente_id
      WHERE t.estado = 'reservado'
        AND t.inicio > now()
        AND (
          COALESCE(r.nombre_reserva, cl.nombre) ILIKE $1
          OR cl.telefono ILIKE $1
        )
      ORDER BY t.inicio
      LIMIT 50
      `,
      [like]
    );
    res.json({ resultados: rows });
  } catch (e) {
    console.error('Error buscar:', e);
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// TURNOS FIJOS: listar series y cancelarlas
// =====================================================================
const TZ_AR = 'America/Argentina/Buenos_Aires';

// Lista las reservas fijas FUTURAS, agrupadas por "serie"
// (mismo cliente + misma cancha + mismo día de semana + misma hora).
router.get('/api/fijos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        COALESCE(r.nombre_reserva, cl.nombre) AS cliente_nombre,
        cl.telefono AS cliente_telefono,
        c.id   AS cancha_id,
        c.nombre AS cancha_nombre,
        EXTRACT(DOW  FROM (t.inicio AT TIME ZONE '${TZ_AR}'))::int  AS dow,
        EXTRACT(HOUR FROM (t.inicio AT TIME ZONE '${TZ_AR}'))::int  AS hora,
        EXTRACT(MINUTE FROM (t.inicio AT TIME ZONE '${TZ_AR}'))::int AS minuto,
        COUNT(*)      AS cantidad,
        MIN(t.inicio) AS proximo,
        MAX(t.inicio) AS ultimo
      FROM reservas r
      JOIN turnos  t  ON t.id = r.turno_id
      JOIN canchas c  ON c.id = t.cancha_id
      JOIN clientes cl ON cl.id = r.cliente_id
      WHERE r.es_fijo = true
        AND t.estado = 'reservado'
        AND t.inicio > now()
      GROUP BY cliente_nombre, cl.telefono, c.id, c.nombre, dow, hora, minuto
      ORDER BY dow, hora, cliente_nombre
      `
    );
    res.json({ fijos: rows });
  } catch (e) {
    console.error('Error listar fijos:', e);
    res.status(500).json({ error: e.message });
  }
});

// Cancela TODA la serie fija futura que coincide con
// cliente + cancha + día de semana + hora + minuto.
router.post('/api/fijos/cancelar', async (req, res) => {
  try {
    const { clienteNombre, canchaId, dow, hora, minuto } = req.body || {};
    if (canchaId == null || dow == null || hora == null) {
      return res.status(400).json({ error: 'Faltan datos de la serie.' });
    }

    // Buscamos todas las reservas futuras de esa serie
    const { rows } = await pool.query(
      `
      SELECT r.id AS reserva_id
      FROM reservas r
      JOIN turnos  t  ON t.id = r.turno_id
      JOIN clientes cl ON cl.id = r.cliente_id
      WHERE r.es_fijo = true
        AND t.estado = 'reservado'
        AND t.inicio > now()
        AND t.cancha_id = $1
        AND EXTRACT(DOW    FROM (t.inicio AT TIME ZONE '${TZ_AR}'))::int = $2
        AND EXTRACT(HOUR   FROM (t.inicio AT TIME ZONE '${TZ_AR}'))::int = $3
        AND EXTRACT(MINUTE FROM (t.inicio AT TIME ZONE '${TZ_AR}'))::int = $4
        AND COALESCE(r.nombre_reserva, cl.nombre) = $5
      `,
      [canchaId, dow, hora, minuto || 0, clienteNombre || '']
    );

    let canceladas = 0;
    for (const row of rows) {
      const ok = await cancelarReserva(row.reserva_id);
      if (ok) canceladas++;
    }

    res.json({ ok: true, canceladas });
  } catch (e) {
    console.error('Error cancelar serie fija:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/generar', async (req, res) => {
  try {
    const dias = Number(req.body?.dias) || 7;
    const generados = await generarProximosDias(dias);
    res.json({ generados });
  } catch (e) {
    console.error('Error generar turnos:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/', (_req, res) => {
  res.type('html').send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Panel del Club</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --primary: #2563eb;
    --primary-hover: #1d4ed8;
    --sidebar-bg: #111827;
    --bg-color: #f3f4f6;
    --text-main: #1f2937;
    --text-muted: #6b7280;
    --border-color: #e5e7eb;
    
    /* Colores de turnos estilo calendario */
    --c-libre-bg: #dcfce7;
    --c-libre-txt: #166534;
    --c-reservado-bg: #3b82f6; /* Azul vibrante como en la imagen */
    --c-reservado-txt: #ffffff;
    --c-bloqueado-bg: #f3f4f6;
    --c-bloqueado-txt: #9ca3af;
  }

  * { box-sizing: border-box; font-family: 'Inter', sans-serif; }
  
  body {
    margin: 0;
    background: var(--bg-color);
    color: var(--text-main);
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  /* LAYOUT - SIDEBAR */
  .sidebar {
    width: 260px;
    background: var(--sidebar-bg);
    color: white;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .sidebar-header {
    padding: 24px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }

  .sidebar-header h1 {
    margin: 0;
    font-size: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .sidebar-nav {
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .nav-item {
    background: transparent;
    color: #d1d5db;
    border: none;
    padding: 12px 16px;
    border-radius: 8px;
    text-align: left;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .nav-item:hover { background: rgba(255,255,255,0.05); color: white; }
  .nav-item.active { background: var(--primary); color: white; }
  .nav-item.action { background: #16a34a; color: white; margin-top: 10px; justify-content: center;}
  .nav-item.action:hover { background: #15803d; }

  /* LAYOUT - MAIN CONTENT */
  .main-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .top-header {
    background: white;
    padding: 16px 32px;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
  }

  .controls { display: flex; gap: 10px; align-items: center; }

  input[type="date"] {
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: 14px;
    color: var(--text-main);
    outline: none;
  }

  .btn {
    padding: 8px 16px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    cursor: pointer;
    background: white;
    color: var(--text-main);
    font-size: 14px;
    font-weight: 500;
    transition: 0.2s;
  }

  .btn:hover { background: var(--bg-color); }
  .btn-primary { background: var(--primary); color: white; border-color: var(--primary); }
  .btn-primary:hover { background: var(--primary-hover); }

  .content-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 32px;
  }

  /* SUMMARY CARDS */
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }

  .summary-card {
    background: white;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    border: 1px solid var(--border-color);
  }

  .summary-card span { font-size: 14px; color: var(--text-muted); font-weight: 500; }
  .summary-card strong { display: block; font-size: 32px; margin-top: 8px; font-weight: 700; }

  .ingresos-box {
    background: white;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 24px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    border: 1px solid var(--border-color);
  }

  .seccion-extra {
    background: white;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 24px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    border: 1px solid var(--border-color);
  }
  .fila-buscar, .fila-fijo {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    margin-bottom: 8px;
    background: #fafafa;
  }
  .fila-buscar .btn-eliminar, .fila-fijo .btn-eliminar {
    margin-top: 0;
    width: auto;
    white-space: nowrap;
  }
  .ingresos-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
  }
  .ingresos-header h2 { margin: 0; font-size: 18px; }
  .ingresos-header input[type="month"] {
    padding: 8px 10px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    font-size: 14px;
  }
  .ingresos-cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }
  .ingreso-card {
    background: #f9fafb;
    border-radius: 10px;
    padding: 16px;
    border: 1px solid var(--border-color);
  }
  .ingreso-card span { font-size: 13px; color: var(--text-muted); font-weight: 500; }
  .ingreso-card strong { display: block; font-size: 24px; margin-top: 6px; font-weight: 700; }
  .ingreso-card.total { background: #ecfdf5; border-color: #a7f3d0; }
  .ingreso-card.total strong { color: #15803d; }

  @media (max-width: 700px) {
    .ingresos-cards { grid-template-columns: 1fr 1fr; }
  }

  /* CALENDAR/TABLE PANEL */
  .panel {
    background: white;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    border: 1px solid var(--border-color);
    overflow: auto;
  }

  table { width: 100%; border-collapse: collapse; min-width: 800px; }
  
  th {
    background: white;
    padding: 16px;
    text-align: left;
    font-size: 14px;
    color: var(--text-muted);
    border-bottom: 2px solid var(--border-color);
    position: sticky;
    top: 0;
    z-index: 2;
  }

  td {
    padding: 12px;
    border-bottom: 1px solid var(--border-color);
    vertical-align: top;
  }

  .hora {
    font-weight: 600;
    color: var(--text-main);
    white-space: nowrap;
    width: 120px;
  }

  /* TURNOS STYLES (CALENDAR LIKE) */
  .turno {
    border-radius: 8px;
    padding: 12px;
    font-size: 13px;
    line-height: 1.5;
    min-width: 180px;
    height: 100%;
    transition: transform 0.1s;
  }

  .libre { background: var(--c-libre-bg); color: var(--c-libre-txt); }
  
  .reservado {
    background: var(--c-reservado-bg);
    color: var(--c-reservado-txt);
    box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
  }

  .bloqueado { background: var(--c-bloqueado-bg); color: var(--c-bloqueado-txt); border: 1px dashed #d1d5db; }
  .otro { background: #e5e7eb; color: #374151; }

  .estado { font-weight: 700; margin-bottom: 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;}
  
  .cliente { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
  .telefono, .pago { opacity: 0.9; font-size: 12px; }

  .btn-reservar {
    margin-top: 10px;
    width: 100%;
    padding: 8px;
    font-size: 13px;
    font-weight: 600;
    background: rgba(22, 101, 52, 0.1);
    color: var(--c-libre-txt);
    border: 1px solid currentColor;
    border-radius: 6px;
    cursor: pointer;
    transition: 0.2s;
  }

  .btn-reservar:hover { background: var(--c-libre-txt); color: white; }

  .btn-bloquear {
    margin-top: 8px;
    width: 100%;
    padding: 6px;
    font-size: 12px;
    font-weight: 600;
    background: rgba(146, 64, 14, 0.08);
    color: #92400e;
    border: 1px solid currentColor;
    border-radius: 6px;
    cursor: pointer;
    transition: 0.2s;
  }
  .btn-bloquear:hover { background: #92400e; color: white; }

  .btn-desbloquear {
    margin-top: 10px;
    width: 100%;
    padding: 6px;
    font-size: 12px;
    font-weight: 600;
    background: rgba(22, 101, 52, 0.10);
    color: #15803d;
    border: 1px solid currentColor;
    border-radius: 6px;
    cursor: pointer;
    transition: 0.2s;
  }
  .btn-desbloquear:hover { background: #15803d; color: white; }

  .turno.bloqueado .motivo {
    font-size: 13px;
    margin-top: 4px;
    font-style: italic;
  }

  .btn-eliminar {
    margin-top: 8px;
    width: 100%;
    padding: 6px;
    font-size: 12px;
    font-weight: 600;
    background: rgba(153, 27, 27, 0.08);
    color: #991b1b;
    border: 1px solid currentColor;
    border-radius: 6px;
    cursor: pointer;
    transition: 0.2s;
  }

  .btn-eliminar:hover { background: #991b1b; color: white; }

  .btn-pagar {
    margin-top: 8px;
    width: 100%;
    padding: 6px;
    font-size: 12px;
    font-weight: 600;
    background: rgba(21, 128, 61, 0.10);
    color: #15803d;
    border: 1px solid currentColor;
    border-radius: 6px;
    cursor: pointer;
    transition: 0.2s;
  }
  .btn-pagar:hover { background: #15803d; color: white; }

  .btn-despagar {
    margin-top: 8px;
    width: 100%;
    padding: 6px;
    font-size: 12px;
    font-weight: 600;
    background: rgba(120, 113, 108, 0.10);
    color: #57534e;
    border: 1px solid currentColor;
    border-radius: 6px;
    cursor: pointer;
    transition: 0.2s;
  }
  .btn-despagar:hover { background: #57534e; color: white; }

  .modal .medios {
    display: flex;
    gap: 10px;
    margin-bottom: 16px;
  }
  .modal .medios label {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
  }

  .fijo-badge {
    display: inline-block;
    margin-bottom: 6px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: bold;
    background: rgba(255,255,255,0.2);
    border: 1px solid rgba(255,255,255,0.4);
    border-radius: 999px;
  }

  /* MODAL */
  .modal-fondo {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px); z-index: 50; align-items: center; justify-content: center;
  }
  .modal-fondo.abierto { display: flex; }
  
  .modal {
    background: white; border-radius: 16px; padding: 24px;
    width: 90%; max-width: 400px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
  }

  .modal h3 { margin: 0 0 20px; font-size: 18px; color: var(--text-main); }
  
  .modal input[type="text"] {
    width: 100%; padding: 12px; border: 1px solid var(--border-color);
    border-radius: 8px; font-size: 14px; margin-bottom: 16px; outline: none;
  }
  .modal input[type="text"]:focus { border-color: var(--primary); }

  .modal .check { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; font-size: 14px; color: var(--text-muted); cursor: pointer;}
  
  .modal .acciones { display: flex; gap: 12px; justify-content: flex-end; }
  .modal .acciones button { flex: 1; padding: 10px; border-radius: 8px; font-weight: 500; cursor: pointer; border: none; font-size: 14px;}
  .modal .cancelar { background: #f3f4f6; color: var(--text-main); }
  .modal .cancelar:hover { background: #e5e7eb; }
  .modal .confirmar { background: var(--primary); color: white; }
  .modal .confirmar:hover { background: var(--primary-hover); }

  .loading, .vacio { padding: 48px; text-align: center; color: var(--text-muted); font-size: 15px;}
  .actualizacion { color: var(--text-muted); font-size: 13px; margin-left: auto; }

  @media (max-width: 900px) {
    body { flex-direction: column; overflow: auto; height: auto;}
    .sidebar { width: 100%; flex-direction: row; justify-content: space-between; align-items: center; padding: 0 20px;}
    .sidebar-header { border-bottom: none; padding: 16px 0;}
    .sidebar-nav { flex-direction: row; padding: 16px 0; gap: 8px;}
    .nav-item { padding: 8px 12px; font-size: 13px;}
    .top-header { flex-direction: column; align-items: stretch; }
    .controls { flex-wrap: wrap; }
    .actualizacion { margin-left: 0; }
    .content-scroll { padding: 16px; }
  }
</style>
</head>
<body>

<!-- BARRA LATERAL -->
<aside class="sidebar">
  <div class="sidebar-header">
    <h1>🎾 Panel Club</h1>
  </div>
  <nav class="sidebar-nav">
    <button class="nav-item active">
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
      Agenda Diaria
    </button>
    <button class="nav-item action" onclick="instruccionReserva()">
      ➕ Reservar Turno
    </button>
    <button class="nav-item" onclick="abrirBuscador()">
      🔍 Buscar reserva
    </button>
    <button class="nav-item" onclick="abrirFijos()">
      🔁 Turnos fijos
    </button>
    <button class="nav-item" onclick="abrirConfig()">
      ⚙️ Configuración
    </button>
  </nav>
</aside>

<!-- CONTENIDO PRINCIPAL -->
<main class="main-wrapper">
  
  <header class="top-header">
    <div class="controls">
      <button class="btn" onclick="cambiarDia(-1)">← Ant</button>
      <input type="date" id="fecha" />
      <button class="btn" onclick="cambiarDia(1)">Sig →</button>
      <button class="btn btn-primary" onclick="irHoy()">Hoy</button>
    </div>
    
    <div class="controls">
      <button class="btn" onclick="cargarAgenda()">↻ Actualizar</button>
      <button class="btn" onclick="generarTurnos()">⚙️ Generar turnos (30 días)</button>
      <span class="actualizacion" id="actualizacion"></span>
    </div>
  </header>

  <div class="content-scroll">
    <div class="summary">
      <div class="summary-card">
        <span>Turnos libres</span>
        <strong id="cantidadLibres" style="color: #16a34a;">0</strong>
      </div>
      <div class="summary-card">
        <span>Reservados</span>
        <strong id="cantidadReservados" style="color: var(--primary);">0</strong>
      </div>
      <div class="summary-card">
        <span>Bloqueados</span>
        <strong id="cantidadBloqueados" style="color: var(--text-muted);">0</strong>
      </div>
    </div>

    <div class="ingresos-box">
      <div class="ingresos-header">
        <h2>💰 Ingresos del mes</h2>
        <input type="month" id="mesIngresos" onchange="cargarIngresos()" />
      </div>
      <div class="ingresos-cards">
        <div class="ingreso-card total">
          <span>Total del mes</span>
          <strong id="ingTotal">$0</strong>
        </div>
        <div class="ingreso-card">
          <span>💵 Efectivo</span>
          <strong id="ingEfectivo">$0</strong>
        </div>
        <div class="ingreso-card">
          <span>🏦 Transferencia</span>
          <strong id="ingTransfer">$0</strong>
        </div>
        <div class="ingreso-card">
          <span>Turnos pagados</span>
          <strong id="ingCantidad">0</strong>
        </div>
      </div>
    </div>

    <!-- BUSCADOR DE RESERVAS -->
    <div class="seccion-extra" id="seccionBuscar" style="display:none;">
      <div class="ingresos-header">
        <h2>🔍 Buscar reserva</h2>
        <button class="btn" onclick="cerrarExtras()">✕ Cerrar</button>
      </div>
      <input
        type="text"
        id="inputBuscar"
        placeholder="Nombre o teléfono del cliente..."
        oninput="buscarReservas()"
        autocomplete="off"
        style="width:100%; padding:12px; border-radius:8px; border:1px solid var(--border); margin-bottom:14px; font-size:15px;"
      />
      <div id="resultadosBuscar"></div>
    </div>

    <!-- TURNOS FIJOS -->
    <div class="seccion-extra" id="seccionFijos" style="display:none;">
      <div class="ingresos-header">
        <h2>🔁 Turnos fijos</h2>
        <button class="btn" onclick="cerrarExtras()">✕ Cerrar</button>
      </div>
      <div id="listaFijos"><div class="loading">Cargando...</div></div>
    </div>

    <!-- CONFIGURACIÓN -->
    <div class="seccion-extra" id="seccionConfig" style="display:none;">
      <div class="ingresos-header">
        <h2>⚙️ Configuración</h2>
        <button class="btn" onclick="cerrarExtras()">✕ Cerrar</button>
      </div>

      <div style="max-width:420px;">
        <label style="display:block; margin-bottom:6px; font-weight:600;">
          Precio del turno
        </label>
        <input
          type="text"
          inputmode="numeric"
          id="configPrecio"
          placeholder="Ej. 24000"
          style="width:100%; padding:12px; border-radius:8px; border:1px solid var(--border); margin-bottom:6px; font-size:15px;"
        />
        <p style="font-size:13px; color:var(--text-muted); margin:0 0 18px;">
          Este es el valor que el bot le muestra al cliente al reservar. Poné 0 si no querés mostrar precio.
        </p>

        <label style="display:block; margin-bottom:6px; font-weight:600;">
          Alias para transferencias
        </label>
        <input
          type="text"
          id="configAlias"
          placeholder="Ej. club.padel.mp"
          style="width:100%; padding:12px; border-radius:8px; border:1px solid var(--border); margin-bottom:6px; font-size:15px;"
        />
        <p style="font-size:13px; color:var(--text-muted); margin:0 0 18px;">
          El bot le pasa este alias al cliente que elige pagar por transferencia.
        </p>

        <button class="btn btn-primary" onclick="guardarConfig()">💾 Guardar cambios</button>
        <span id="configMsg" style="margin-left:12px; font-size:14px;"></span>
      </div>
    </div>

    <div class="panel" id="panel">
      <div class="loading">Cargando agenda...</div>
    </div>
  </div>

</main>

<!-- MODAL RESERVA -->
<div class="modal-fondo" id="modalReserva">
  <div class="modal">
    <h3>Reservar turno</h3>
    <input type="text" id="modalNombre" placeholder="Nombre del cliente" autocomplete="off" />
    <label class="check">
      <input type="checkbox" id="modalRecurrente" />
      Repetir las próximas 4 semanas (turno fijo)
    </label>
    <div class="acciones">
      <button class="cancelar" onclick="cerrarReserva()">Cancelar</button>
      <button class="confirmar" onclick="confirmarReserva()">Confirmar Reserva</button>
    </div>
  </div>
</div>

<div class="modal-fondo" id="modalPago">
  <div class="modal">
    <h3>Registrar pago</h3>

    <input
      type="text"
      inputmode="numeric"
      id="pagoMonto"
      placeholder="¿Cuánto pagó? (ej. 8000)"
    />

    <div class="medios">
      <label>
        <input type="radio" name="pagoMedio" value="efectivo" checked />
        Efectivo
      </label>
      <label>
        <input type="radio" name="pagoMedio" value="transferencia" />
        Transferencia
      </label>
    </div>

    <div class="acciones">
      <button class="cancelar" onclick="cerrarPago()">Cancelar</button>
      <button onclick="confirmarPago()">Guardar</button>
    </div>
  </div>
</div>

<script>
const TZ = 'America/Argentina/Buenos_Aires';
const inputFecha = document.getElementById('fecha');

function fechaArgentina() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

inputFecha.value = fechaArgentina();
inputFecha.addEventListener('change', cargarAgenda);

function escapar(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
}

function claveHorario(turno) {
  return hora(turno.inicio) + '|' + hora(turno.fin);
}

function cambiarDia(dias) {
  const partes = inputFecha.value.split('-').map(Number);
  const fecha = new Date(partes[0], partes[1] - 1, partes[2]);
  fecha.setDate(fecha.getDate() + dias);
  
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  
  inputFecha.value = yyyy + '-' + mm + '-' + dd;
  cargarAgenda();
}

function irHoy() {
  inputFecha.value = fechaArgentina();
  cargarAgenda();
}

async function generarTurnos() {
  if (!confirm('¿Generar los turnos de los próximos 30 días?')) return;
  try {
    const respuesta = await fetch('/admin/api/generar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dias: 30 })
    });
    const data = await respuesta.json();
    if (!respuesta.ok) throw new Error(data.error || 'Error');
    alert('Se generaron ' + data.generados + ' turnos ✓');
    cargarAgenda();
  } catch (e) {
    alert('No se pudieron generar los turnos: ' + e.message);
  }
}

function instruccionReserva() {
    alert('Para reservar, buscá un turno LIBRE en la grilla y hacé clic en su botón "+ Reservar".');
}

let turnoSeleccionado = null;

function abrirReserva(turnoId) {
  turnoSeleccionado = turnoId;
  document.getElementById('modalNombre').value = '';
  document.getElementById('modalRecurrente').checked = false;
  document.getElementById('modalReserva').classList.add('abierto');
  document.getElementById('modalNombre').focus();
}

function cerrarReserva() {
  document.getElementById('modalReserva').classList.remove('abierto');
  turnoSeleccionado = null;
}

async function eliminarReserva(reservaId) {
  if (!reservaId) return;
  if (!confirm('¿Eliminar esta reserva? El turno volverá a estar disponible.')) {
    return;
  }
  try {
    const respuesta = await fetch('/admin/api/cancelar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservaId: reservaId })
    });
    const data = await respuesta.json();
    if (!respuesta.ok) throw new Error(data.error || 'Error');
    cargarAgenda();
  } catch (e) {
    alert('No se pudo eliminar: ' + e.message);
  }
}

let reservaPago = null;

function abrirPago(reservaId) {
  reservaPago = reservaId;
  document.getElementById('pagoMonto').value = '';
  const efectivo = document.querySelector('input[name="pagoMedio"][value="efectivo"]');
  if (efectivo) efectivo.checked = true;
  document.getElementById('modalPago').classList.add('abierto');
  document.getElementById('pagoMonto').focus();
}

function cerrarPago() {
  document.getElementById('modalPago').classList.remove('abierto');
  reservaPago = null;
}

async function confirmarPago() {
  if (!reservaPago) return;

  const monto = document.getElementById('pagoMonto').value.trim();
  const medioEl = document.querySelector('input[name="pagoMedio"]:checked');
  const medioPago = medioEl ? medioEl.value : 'efectivo';

  try {
    const respuesta = await fetch('/admin/api/pagar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservaId: reservaPago, monto: monto, medioPago: medioPago })
    });
    const data = await respuesta.json();
    if (!respuesta.ok) throw new Error(data.error || 'Error');
    cerrarPago();
    cargarAgenda();
    cargarIngresos();
  } catch (e) {
    alert('No se pudo registrar el pago: ' + e.message);
  }
}

async function desmarcarPago(reservaId) {
  if (!reservaId) return;
  if (!confirm('¿Quitar el pago de esta reserva?')) return;
  try {
    const respuesta = await fetch('/admin/api/pagar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservaId: reservaId, desmarcar: true })
    });
    const data = await respuesta.json();
    if (!respuesta.ok) throw new Error(data.error || 'Error');
    cargarAgenda();
    cargarIngresos();
  } catch (e) {
    alert('No se pudo quitar el pago: ' + e.message);
  }
}

async function bloquearTurno(turnoId) {
  if (!turnoId) return;
  const motivo = prompt('Motivo del bloqueo (ej. lluvia, mantenimiento). Podés dejarlo vacío:');
  if (motivo === null) return; // canceló el prompt
  try {
    const respuesta = await fetch('/admin/api/bloquear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnoId: turnoId, motivo: motivo.trim() })
    });
    const data = await respuesta.json();
    if (!respuesta.ok) throw new Error(data.error || 'Error');
    cargarAgenda();
  } catch (e) {
    alert('No se pudo bloquear: ' + e.message);
  }
}

async function desbloquearTurno(turnoId) {
  if (!turnoId) return;
  if (!confirm('¿Desbloquear este turno? Volverá a estar disponible.')) return;
  try {
    const respuesta = await fetch('/admin/api/desbloquear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnoId: turnoId })
    });
    const data = await respuesta.json();
    if (!respuesta.ok) throw new Error(data.error || 'Error');
    cargarAgenda();
  } catch (e) {
    alert('No se pudo desbloquear: ' + e.message);
  }
}

async function confirmarReserva() {
  const nombre = document.getElementById('modalNombre').value.trim();
  const recurrente = document.getElementById('modalRecurrente').checked;

  if (nombre.length < 2) {
    alert('Escribí el nombre del cliente.');
    return;
  }
  if (!turnoSeleccionado) return;

  try {
    const respuesta = await fetch('/admin/api/reservar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnoId: turnoSeleccionado, nombre: nombre, recurrente: recurrente })
    });

    const data = await respuesta.json();
    if (!respuesta.ok) throw new Error(data.error || 'Error');

    if (recurrente) {
      alert('Turno fijo cargado: ' + data.reservados + ' de ' + data.total + ' semanas reservadas ✓');
    } else {
      alert('Turno reservado ✓');
    }

    cerrarReserva();
    cargarAgenda();
  } catch (e) {
    alert('No se pudo reservar: ' + e.message);
  }
}

function estadoTurno(t) {
  if (t.estado === 'bloqueado') return 'bloqueado';
  if (t.reserva_id) return 'reservado';
  if (t.estado === 'disponible') return 'libre';
  return 'otro';
}

function contenidoTurno(t) {
  const estado = estadoTurno(t);

  if (estado === 'libre') {
    return \`
      <div class="turno libre">
        <div class="estado">Libre</div>
        <button class="btn-reservar" onclick="abrirReserva('\${t.id}')">
          + Reservar
        </button>
        <button class="btn-bloquear" onclick="bloquearTurno('\${t.id}')">
          Bloquear
        </button>
      </div>
    \`;
  }

  if (estado === 'bloqueado') {
    const motivo = t.motivo_bloqueo ? escapar(t.motivo_bloqueo) : 'No disponible';
    return \`
      <div class="turno bloqueado">
        <div class="estado">🟡 Bloqueado</div>
        <div class="motivo">\${motivo}</div>
        <button class="btn-desbloquear" onclick="desbloquearTurno('\${t.id}')">
          Desbloquear
        </button>
      </div>
    \`;
  }

  if (estado === 'reservado') {
    const nombre = escapar(t.cliente_nombre || 'Sin nombre');
    const telefono = escapar(t.cliente_telefono || '');
    const medio = t.medio_pago ? ' • ' + escapar(t.medio_pago) : '';
    const montoTxt = (t.monto != null && t.monto !== '') ? ' $' + Number(t.monto).toLocaleString('es-AR') : '';
    const pago = t.pagado ? ('✓ Pagado' + montoTxt + medio) : ('⏳ Pendiente' + medio);
    const etiquetaFijo = t.es_fijo ? '<div class="fijo-badge">🔁 FIJO</div>' : '';

    return \`
      <div class="turno reservado">
        \${etiquetaFijo}
        <div class="cliente">\${nombre}</div>
        \${telefono ? \`<div class="telefono">📱 \${telefono}</div>\` : ''}
        <div class="pago">\${pago}</div>
        \${t.pagado
          ? \`<button class="btn-despagar" onclick="desmarcarPago('\${t.reserva_id}')">Quitar pago</button>\`
          : \`<button class="btn-pagar" onclick="abrirPago('\${t.reserva_id}')">Marcar pagado</button>\`
        }
        <button class="btn-eliminar" onclick="eliminarReserva('\${t.reserva_id}')">
          Eliminar
        </button>
      </div>
    \`;
  }

  return \`<div class="turno otro"><div class="estado">\${escapar(t.estado)}</div></div>\`;
}

async function cargarAgenda() {
  const panel = document.getElementById('panel');
  panel.innerHTML = '<div class="loading">Cargando agenda...</div>';

  try {
    const fecha = inputFecha.value;
    const respuesta = await fetch('/admin/api/agenda?fecha=' + encodeURIComponent(fecha));
    
    if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
    const data = await respuesta.json();
    const turnos = data.turnos || [];

    if (!turnos.length) {
      panel.innerHTML = '<div class="vacio">No hay turnos generados para esta fecha.</div>';
      actualizarResumen([]);
      return;
    }

    renderizarTabla(turnos);
    actualizarResumen(turnos);

    document.getElementById('actualizacion').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  } catch (e) {
    console.error(e);
    panel.innerHTML = '<div class="vacio">No se pudo cargar la agenda.</div>';
  }
}

function actualizarResumen(turnos) {
  let libres = 0; let reservados = 0; let bloqueados = 0;

  turnos.forEach((t) => {
    const estado = estadoTurno(t);
    if (estado === 'libre') libres++;
    if (estado === 'reservado') reservados++;
    if (estado === 'bloqueado') bloqueados++;
  });

  document.getElementById('cantidadLibres').textContent = libres;
  document.getElementById('cantidadReservados').textContent = reservados;
  document.getElementById('cantidadBloqueados').textContent = bloqueados;
}

function renderizarTabla(turnos) {
  const canchasMap = new Map();
  const horariosMap = new Map();

  turnos.forEach((t) => {
    if (!canchasMap.has(String(t.cancha_id))) {
      canchasMap.set(String(t.cancha_id), {
        id: String(t.cancha_id),
        nombre: t.cancha_nombre,
        deporte: t.deporte
      });
    }

    const clave = claveHorario(t);
    if (!horariosMap.has(clave)) {
      horariosMap.set(clave, { inicio: t.inicio, fin: t.fin, turnos: new Map() });
    }
    horariosMap.get(clave).turnos.set(String(t.cancha_id), t);
  });

  const canchas = Array.from(canchasMap.values());
  const horarios = Array.from(horariosMap.values()).sort((a, b) => new Date(a.inicio) - new Date(b.inicio));

  let html = '<table><thead><tr><th>Horario</th>';
  canchas.forEach((c) => {
    html += '<th>' + escapar(c.nombre) + '<br><small style="font-weight:normal">' + escapar(c.deporte) + '</small></th>';
  });
  html += '</tr></thead><tbody>';

  horarios.forEach((h) => {
    html += '<tr><td class="hora">' + hora(h.inicio) + ' - ' + hora(h.fin) + '</td>';
    canchas.forEach((c) => {
      const t = h.turnos.get(c.id);
      if (!t) {
        html += '<td></td>';
      } else {
        html += '<td>' + contenidoTurno(t) + '</td>';
      }
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  document.getElementById('panel').innerHTML = html;
}

async function cargarIngresos() {
  const inputMes = document.getElementById('mesIngresos');
  const mes = inputMes.value; // 'YYYY-MM'

  try {
    const url = '/admin/api/ingresos' + (mes ? ('?mes=' + encodeURIComponent(mes)) : '');
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
    const data = await respuesta.json();

    const fmt = (n) => '$' + Number(n || 0).toLocaleString('es-AR');

    document.getElementById('ingTotal').textContent = fmt(data.total);
    document.getElementById('ingEfectivo').textContent = fmt(data.porMedio.efectivo);
    document.getElementById('ingTransfer').textContent = fmt(data.porMedio.transferencia);
    document.getElementById('ingCantidad').textContent = data.cantidad;

    // Si el input de mes está vacío, lo seteamos al mes que devolvió el server.
    if (!inputMes.value && data.mes) inputMes.value = data.mes;
  } catch (e) {
    console.error('Error cargando ingresos:', e);
  }
}

// =====================================================================
// BUSCADOR + TURNOS FIJOS (secciones extra)
// =====================================================================
function cerrarExtras() {
  document.getElementById('seccionBuscar').style.display = 'none';
  document.getElementById('seccionFijos').style.display = 'none';
  document.getElementById('seccionConfig').style.display = 'none';
}

function abrirBuscador() {
  cerrarExtras();
  document.getElementById('seccionBuscar').style.display = 'block';
  const inp = document.getElementById('inputBuscar');
  inp.value = '';
  document.getElementById('resultadosBuscar').innerHTML = '';
  inp.focus();
}

function abrirFijos() {
  cerrarExtras();
  document.getElementById('seccionFijos').style.display = 'block';
  cargarFijos();
}

async function abrirConfig() {
  cerrarExtras();
  document.getElementById('seccionConfig').style.display = 'block';
  document.getElementById('configMsg').textContent = '';
  try {
    const r = await fetch('/admin/api/config');
    const data = await r.json();
    document.getElementById('configPrecio').value = data.precio || 0;
    document.getElementById('configAlias').value = data.alias || '';
  } catch (e) {
    document.getElementById('configMsg').textContent = 'No se pudo cargar la configuración.';
    document.getElementById('configMsg').style.color = '#dc2626';
  }
}

async function guardarConfig() {
  const precio = document.getElementById('configPrecio').value.trim();
  const alias = document.getElementById('configAlias').value.trim();
  const msg = document.getElementById('configMsg');
  msg.textContent = 'Guardando...';
  msg.style.color = 'var(--text-muted)';
  try {
    const r = await fetch('/admin/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ precio, alias })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error');
    msg.textContent = '✓ Guardado';
    msg.style.color = '#16a34a';
    setTimeout(() => { msg.textContent = ''; }, 2500);
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
    msg.style.color = '#dc2626';
  }
}

let buscarTimer = null;
function buscarReservas() {
  clearTimeout(buscarTimer);
  const q = document.getElementById('inputBuscar').value.trim();
  const cont = document.getElementById('resultadosBuscar');
  if (q.length < 2) {
    cont.innerHTML = '<p style="color:var(--text-muted);">Escribí al menos 2 letras...</p>';
    return;
  }
  buscarTimer = setTimeout(async () => {
    try {
      const r = await fetch('/admin/api/buscar?q=' + encodeURIComponent(q));
      const data = await r.json();
      const res = data.resultados || [];
      if (!res.length) {
        cont.innerHTML = '<p style="color:var(--text-muted);">Sin resultados.</p>';
        return;
      }
      cont.innerHTML = res.map((x) => {
        const ini = new Date(x.inicio);
        const fecha = ini.toLocaleDateString('es-AR', { weekday:'short', day:'2-digit', month:'2-digit', timeZone:'America/Argentina/Buenos_Aires' });
        const hora = ini.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', timeZone:'America/Argentina/Buenos_Aires' });
        const tel = x.cliente_telefono && !String(x.cliente_telefono).startsWith('manual_') ? (' • 📱 ' + escapar(x.cliente_telefono)) : '';
        const pago = x.pagado ? '✓ Pagado' : '⏳ Sin pagar';
        const fijo = x.es_fijo ? ' 🔁' : '';
        return \`
          <div class="fila-buscar">
            <div>
              <strong>\${escapar(x.cliente_nombre || 'Sin nombre')}\${fijo}</strong>\${tel}
              <div style="font-size:13px; color:var(--text-muted);">
                \${fecha} \${hora} • \${escapar(x.cancha_nombre)} • \${pago}
              </div>
            </div>
            <button class="btn-eliminar" onclick="eliminarReserva('\${x.reserva_id}'); setTimeout(buscarReservas, 400);">Eliminar</button>
          </div>
        \`;
      }).join('');
    } catch (e) {
      cont.innerHTML = '<p style="color:#dc2626;">Error al buscar.</p>';
    }
  }, 300);
}

const DIAS_SEMANA = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

async function cargarFijos() {
  const cont = document.getElementById('listaFijos');
  cont.innerHTML = '<div class="loading">Cargando...</div>';
  try {
    const r = await fetch('/admin/api/fijos');
    const data = await r.json();
    const fijos = data.fijos || [];
    if (!fijos.length) {
      cont.innerHTML = '<p style="color:var(--text-muted);">No hay turnos fijos activos.</p>';
      return;
    }
    cont.innerHTML = fijos.map((f) => {
      const hh = String(f.hora).padStart(2, '0');
      const mm = String(f.minuto).padStart(2, '0');
      const tel = f.cliente_telefono && !String(f.cliente_telefono).startsWith('manual_') ? (' • 📱 ' + escapar(f.cliente_telefono)) : '';
      return \`
        <div class="fila-fijo">
          <div>
            <strong>\${escapar(f.cliente_nombre || 'Sin nombre')}</strong>\${tel}
            <div style="font-size:13px; color:var(--text-muted);">
              🔁 \${DIAS_SEMANA[f.dow]} \${hh}:\${mm} • \${escapar(f.cancha_nombre)} • \${f.cantidad} turno\${f.cantidad === 1 ? '' : 's'} futuro\${f.cantidad === 1 ? '' : 's'}
            </div>
          </div>
          <button class="btn-eliminar"
            onclick="cancelarSerieFija('\${encodeURIComponent(f.cliente_nombre || '')}', \${f.cancha_id}, \${f.dow}, \${f.hora}, \${f.minuto})">
            Cancelar serie
          </button>
        </div>
      \`;
    }).join('');
  } catch (e) {
    cont.innerHTML = '<p style="color:#dc2626;">Error al cargar turnos fijos.</p>';
  }
}

async function cancelarSerieFija(nombreEnc, canchaId, dow, hora, minuto) {
  const nombre = decodeURIComponent(nombreEnc);
  if (!confirm('¿Cancelar TODOS los turnos futuros de la serie fija de ' + nombre + '?\\n\\nEsto libera todos esos horarios.')) return;
  try {
    const r = await fetch('/admin/api/fijos/cancelar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clienteNombre: nombre, canchaId, dow, hora, minuto })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error');
    alert('Serie cancelada: ' + data.canceladas + ' turno(s) liberado(s).');
    cargarFijos();
    cargarAgenda();
  } catch (e) {
    alert('No se pudo cancelar la serie: ' + e.message);
  }
}

// Inicializamos el selector de mes con el mes actual.
document.getElementById('mesIngresos').value =
  fechaArgentina().slice(0, 7);

// Actualización automática cada 15 segundos
setInterval(cargarAgenda, 15000);
cargarAgenda();
cargarIngresos();
</script>
</body>
</html>
  `);
});

module.exports = router;