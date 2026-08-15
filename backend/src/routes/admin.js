const router = require('express').Router();
const pool = require('../config/db');

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

        c.id AS cancha_id,
        c.nombre AS cancha_nombre,
        c.tipo AS deporte,

        r.id AS reserva_id,
        r.pagado,
        r.medio_pago,
        r.monto,

        cl.id AS cliente_id,
        cl.nombre AS cliente_nombre,
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

router.get('/', (_req, res) => {
  res.type('html').send(`
<!DOCTYPE html>

<html lang="es">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
/>

<title>Panel del Club</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family:
    Arial,
    Helvetica,
    sans-serif;

  background: #f4f5f7;
  color: #1f2937;
}

header {
  background: #111827;
  color: white;
  padding: 22px;
}

header h1 {
  margin: 0;
  font-size: 24px;
}

header p {
  margin:
    6px
    0
    0;

  opacity: .75;
}

.container {
  max-width: 1500px;
  margin: auto;
  padding: 22px;
}

.controls {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;

  margin-bottom: 20px;
}

input,
button {
  font-size: 15px;
}

input[type="date"] {
  padding: 10px;
  border:
    1px
    solid
    #d1d5db;

  border-radius: 8px;
}

button {
  padding:
    10px
    16px;

  border: 0;
  border-radius: 8px;

  cursor: pointer;

  background: #111827;
  color: white;
}

button:hover {
  opacity: .9;
}

.summary {
  display: grid;

  grid-template-columns:
    repeat(
      3,
      minmax(150px, 1fr)
    );

  gap: 12px;

  margin-bottom: 20px;
}

.summary-card {
  background: white;
  border-radius: 12px;
  padding: 18px;

  box-shadow:
    0
    2px
    6px
    rgba(0,0,0,.06);
}

.summary-card strong {
  display: block;

  font-size: 28px;

  margin-top: 6px;
}

.panel {
  background: white;

  border-radius: 12px;

  overflow: auto;

  box-shadow:
    0
    2px
    8px
    rgba(0,0,0,.07);
}

table {
  width: 100%;

  border-collapse:
    collapse;

  min-width: 800px;
}

th,
td {
  padding: 12px;

  border-bottom:
    1px
    solid
    #e5e7eb;

  vertical-align: top;
}

th {
  background: #f9fafb;

  position: sticky;

  top: 0;

  z-index: 2;
}

.hora {
  white-space: nowrap;
  font-weight: bold;
}

.turno {
  min-width: 170px;

  border-radius: 8px;

  padding: 10px;

  font-size: 14px;

  line-height: 1.4;
}

.libre {
  background: #dcfce7;
  color: #166534;
}

.reservado {
  background: #fee2e2;
  color: #991b1b;
}

.bloqueado {
  background: #fef3c7;
  color: #92400e;
}

.otro {
  background: #e5e7eb;
  color: #374151;
}

.estado {
  font-weight: bold;

  margin-bottom: 5px;
}

.cliente {
  margin-top: 5px;
}

.telefono {
  font-size: 12px;

  opacity: .8;
}

.pago {
  margin-top: 5px;

  font-size: 12px;
}

.loading {
  padding: 40px;

  text-align: center;
}

.vacio {
  padding: 50px;

  text-align: center;

  color: #6b7280;
}

.actualizacion {
  color: #6b7280;

  font-size: 13px;

  margin-left: auto;
}

@media (max-width: 700px) {

  .summary {
    grid-template-columns: 1fr;
  }

  .container {
    padding: 12px;
  }

  header {
    padding: 16px;
  }

}

</style>

</head>

<body>

<header>

  <h1>🎾 Panel de turnos</h1>

  <p>
    Disponibilidad y reservas del club
  </p>

</header>

<div class="container">

  <div class="controls">

    <button onclick="cambiarDia(-1)">
      ← Día anterior
    </button>

    <input
      type="date"
      id="fecha"
    />

    <button onclick="cambiarDia(1)">
      Día siguiente →
    </button>

    <button onclick="irHoy()">
      Hoy
    </button>

    <button onclick="cargarAgenda()">
      Actualizar
    </button>

    <span
      class="actualizacion"
      id="actualizacion"
    ></span>

  </div>

  <div class="summary">

    <div class="summary-card">

      Turnos libres

      <strong id="cantidadLibres">
        0
      </strong>

    </div>

    <div class="summary-card">

      Reservados

      <strong id="cantidadReservados">
        0
      </strong>

    </div>

    <div class="summary-card">

      Bloqueados

      <strong id="cantidadBloqueados">
        0
      </strong>

    </div>

  </div>

  <div
    class="panel"
    id="panel"
  >

    <div class="loading">
      Cargando agenda...
    </div>

  </div>

</div>

<script>

const TZ =
  'America/Argentina/Buenos_Aires';

const inputFecha =
  document.getElementById('fecha');

function fechaArgentina() {

  return new Date()
    .toLocaleDateString(
      'en-CA',
      {
        timeZone: TZ
      }
    );

}

inputFecha.value =
  fechaArgentina();

inputFecha.addEventListener(
  'change',
  cargarAgenda
);

function escapar(valor) {

  if (
    valor === null ||
    valor === undefined
  ) {
    return '';
  }

  return String(valor)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

}

function hora(iso) {

  return new Date(iso)
    .toLocaleTimeString(
      'es-AR',
      {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: TZ
      }
    );

}

function claveHorario(turno) {

  return (
    hora(turno.inicio) +
    '|' +
    hora(turno.fin)
  );

}

function cambiarDia(dias) {

  const partes =
    inputFecha.value
      .split('-')
      .map(Number);

  const fecha =
    new Date(
      partes[0],
      partes[1] - 1,
      partes[2]
    );

  fecha.setDate(
    fecha.getDate() + dias
  );

  const yyyy =
    fecha.getFullYear();

  const mm =
    String(
      fecha.getMonth() + 1
    )
      .padStart(2, '0');

  const dd =
    String(
      fecha.getDate()
    )
      .padStart(2, '0');

  inputFecha.value =
    yyyy + '-' + mm + '-' + dd;

  cargarAgenda();

}

function irHoy() {

  inputFecha.value =
    fechaArgentina();

  cargarAgenda();

}

function estadoTurno(t) {

  if (
    t.estado === 'bloqueado'
  ) {
    return 'bloqueado';
  }

  if (
    t.reserva_id
  ) {
    return 'reservado';
  }

  if (
    t.estado === 'disponible'
  ) {
    return 'libre';
  }

  return 'otro';

}

function contenidoTurno(t) {

  const estado =
    estadoTurno(t);

  if (
    estado === 'libre'
  ) {

    return \`
      <div class="turno libre">

        <div class="estado">
          🟢 LIBRE
        </div>

        Disponible

      </div>
    \`;

  }

  if (
    estado === 'bloqueado'
  ) {

    return \`
      <div class="turno bloqueado">

        <div class="estado">
          🟡 BLOQUEADO
        </div>

        No disponible

      </div>
    \`;

  }

  if (
    estado === 'reservado'
  ) {

    const nombre =
      escapar(
        t.cliente_nombre ||
        'Sin nombre'
      );

    const telefono =
      escapar(
        t.cliente_telefono ||
        ''
      );

    const pago =
      t.pagado
        ? '✅ Pagado'
        : '⏳ Pago pendiente';

    return \`
      <div class="turno reservado">

        <div class="estado">
          🔴 RESERVADO
        </div>

        <div class="cliente">
          👤 \${nombre}
        </div>

        <div class="telefono">
          📱 \${telefono}
        </div>

        <div class="pago">
          \${pago}
        </div>

      </div>
    \`;

  }

  return \`
    <div class="turno otro">

      <div class="estado">
        \${escapar(t.estado)}
      </div>

    </div>
  \`;

}

async function cargarAgenda() {

  const panel =
    document.getElementById('panel');

  panel.innerHTML =
    '<div class="loading">Cargando agenda...</div>';

  try {

    const fecha =
      inputFecha.value;

    const respuesta =
      await fetch(
        '/admin/api/agenda?fecha=' +
        encodeURIComponent(fecha)
      );

    if (!respuesta.ok) {
      throw new Error(
        'HTTP ' + respuesta.status
      );
    }

    const data =
      await respuesta.json();

    const turnos =
      data.turnos || [];

    if (!turnos.length) {

      panel.innerHTML =
        '<div class="vacio">No hay turnos generados para esta fecha.</div>';

      actualizarResumen([]);

      return;
    }

    renderizarTabla(turnos);

    actualizarResumen(turnos);

    document.getElementById(
      'actualizacion'
    ).textContent =
      'Actualizado ' +
      new Date()
        .toLocaleTimeString(
          'es-AR',
          {
            hour: '2-digit',
            minute: '2-digit'
          }
        );

  } catch (e) {

    console.error(e);

    panel.innerHTML =
      '<div class="vacio">No se pudo cargar la agenda.</div>';

  }

}

function actualizarResumen(turnos) {

  let libres = 0;
  let reservados = 0;
  let bloqueados = 0;

  turnos.forEach((t) => {

    const estado =
      estadoTurno(t);

    if (estado === 'libre') {
      libres++;
    }

    if (estado === 'reservado') {
      reservados++;
    }

    if (estado === 'bloqueado') {
      bloqueados++;
    }

  });

  document.getElementById(
    'cantidadLibres'
  ).textContent =
    libres;

  document.getElementById(
    'cantidadReservados'
  ).textContent =
    reservados;

  document.getElementById(
    'cantidadBloqueados'
  ).textContent =
    bloqueados;

}

function renderizarTabla(turnos) {

  const canchasMap =
    new Map();

  const horariosMap =
    new Map();

  turnos.forEach((t) => {

    if (
      !canchasMap.has(
        String(t.cancha_id)
      )
    ) {
      canchasMap.set(
        String(t.cancha_id),
        {
          id: String(t.cancha_id),
          nombre: t.cancha_nombre,
          deporte: t.deporte
        }
      );
    }

    const clave =
      claveHorario(t);

    if (
      !horariosMap.has(clave)
    ) {
      horariosMap.set(
        clave,
        {
          inicio: t.inicio,
          fin: t.fin,
          turnos: new Map()
        }
      );
    }

    horariosMap
      .get(clave)
      .turnos
      .set(
        String(t.cancha_id),
        t
      );

  });

  const canchas =
    Array.from(
      canchasMap.values()
    );

  const horarios =
    Array.from(
      horariosMap.values()
    )
      .sort(
        (a, b) =>
          new Date(a.inicio) -
          new Date(b.inicio)
      );

  let html =
    '<table>';

  html +=
    '<thead><tr>';

  html +=
    '<th>Horario</th>';

  canchas.forEach((c) => {

    html +=
      '<th>' +
      escapar(c.nombre) +
      '<br><small>' +
      escapar(c.deporte) +
      '</small></th>';

  });

  html +=
    '</tr></thead>';

  html +=
    '<tbody>';

  horarios.forEach((h) => {

    html +=
      '<tr>';

    html +=
      '<td class="hora">' +
      hora(h.inicio) +
      ' - ' +
      hora(h.fin) +
      '</td>';

    canchas.forEach((c) => {

      const t =
        h.turnos.get(c.id);

      if (!t) {

        html +=
          '<td>—</td>';

      } else {

        html +=
          '<td>' +
          contenidoTurno(t) +
          '</td>';

      }

    });

    html +=
      '</tr>';

  });

  html +=
    '</tbody></table>';

  document.getElementById(
    'panel'
  ).innerHTML =
    html;

}

// Actualización automática cada 15 segundos
setInterval(
  cargarAgenda,
  15000
);

cargarAgenda();

</script>

</body>

</html>
  `);
});

module.exports = router;
