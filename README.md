# 🎾 Sistema de gestión de turnos + Bot de WhatsApp

Sistema completo para clubes de pádel, paleta y tenis: gestión de canchas, generación automática de turnos, reservas vía bot de WhatsApp (API oficial de Meta) y panel de administración web.

---

## 📁 Estructura del proyecto

```
padel-turnos/
├── backend/                    # API Node.js + Express + PostgreSQL
│   ├── src/
│   │   ├── config/db.js        # Conexión a PostgreSQL
│   │   ├── db/
│   │   │   ├── schema.sql       # Tablas
│   │   │   └── seed.sql         # Datos de ejemplo
│   │   ├── routes/
│   │   │   ├── clubes.js
│   │   │   ├── canchas.js
│   │   │   ├── turnos.js        # Crear, listar, reservar (concurrencia)
│   │   │   └── whatsapp.js      # Webhook de WhatsApp
│   │   ├── services/
│   │   │   ├── reservaService.js    # ⭐ Concurrencia a nivel BD
│   │   │   ├── generadorTurnos.js
│   │   │   ├── turnosService.js
│   │   │   └── whatsappApi.js
│   │   ├── jobs/cron.js         # Generación automática de turnos
│   │   └── app.js
│   └── .env.example
└── admin-panel/                # Panel web React (Vite)
    └── src/pages/{Canchas,Reservas,Eventos}.jsx
```

---

## 🚀 Puesta en marcha

### 1. Base de datos

Instalá PostgreSQL y creá la base:

```bash
createdb padel
cd backend
cp .env.example .env        # editá DATABASE_URL y las credenciales de WhatsApp
psql $DATABASE_URL -f src/db/schema.sql
psql $DATABASE_URL -f src/db/seed.sql
```

### 2. Backend

```bash
cd backend
npm install
npm start          # http://localhost:3000
```

> Cloud: para subirlo a la nube y no depender de tu compu, mira la guia completa en DEPLOY-NUBE.md (despliegue en Railway, paso a paso).

### 3. Panel admin

```bash
cd admin-panel
npm install
npm run dev        # http://localhost:5173
```

El panel te permite: crear/editar canchas, generar turnos para los próximos 7 días con un botón, ver reservas del día, cobrar (efectivo/transferencia/tarjeta), cancelar y bloquear canchas para eventos.

---

## 🔒 Manejo de concurrencia (lo crítico)

La reserva se resuelve **a nivel de base de datos**, no de aplicación. Está en `services/reservaService.js`:

```sql
UPDATE turnos SET estado = 'reservado'
WHERE id = $1 AND estado = 'disponible'
```

- Todo corre dentro de una **transacción** (`BEGIN`/`COMMIT`).
- Se verifica `rowCount`: si es **0**, otro usuario ganó la carrera → se responde "turno no disponible".
- Barrera final: `CONSTRAINT UNIQUE(turno_id)` en la tabla `reservas`. Si por alguna carrera extrema se intentara doble insert, el segundo falla con código `23505` y se trata como reserva perdida.

**Probado**: una simulación de 50 clics simultáneos sobre el mismo turno confirma **una sola reserva**; los otros 49 reciben el rechazo. Postgres serializa los `UPDATE` sobre la misma fila con un row-lock, garantizando el comportamiento.

---

## 📱 Configurar WhatsApp Cloud API en Meta (paso a paso)

### Paso 1 — Crear la app
1. Entrá a **developers.facebook.com** → *Mis Apps* → **Crear app**.
2. Elegí tipo **Business** (Negocios).
3. Poné un nombre y creala.

### Paso 2 — Agregar el producto WhatsApp
1. Dentro de la app → *Agregar producto* → **WhatsApp** → *Configurar*.
2. Meta te asocia una **cuenta de WhatsApp Business (WABA)** y te da un **número de prueba** gratuito.

### Paso 3 — Copiar credenciales
En la pantalla *WhatsApp → Configuración de la API* copiá:
- **Temporary access token** → va en `WA_TOKEN` del `.env` (dura 24 h).
- **Phone number ID** → va en `WA_PHONE_ID`.

> ⚠️ Para producción, generá un **token permanente**: *Business Settings → Usuarios → Usuarios del sistema* → creá un system user, asignale la app con permiso `whatsapp_business_messaging`, y generá un token sin vencimiento.

### Paso 4 — Exponer el webhook con HTTPS
El webhook necesita una URL pública HTTPS. Para desarrollo usá **ngrok**:

```bash
ngrok http 3000
```

Te da una URL tipo `https://abcd-123.ngrok-free.app`. Tu webhook será:
```
https://abcd-123.ngrok-free.app/whatsapp/webhook
```

### Paso 5 — Configurar el webhook en Meta
1. En *WhatsApp → Configuración → Webhooks* → **Editar**.
2. **Callback URL**: pegá tu URL del webhook (`.../whatsapp/webhook`).
3. **Verify token**: poné exactamente el mismo valor que pusiste en `WA_VERIFY_TOKEN` del `.env`.
4. Meta hace un GET de verificación → tu backend responde el `challenge` → aparece **verificado ✓**.

### Paso 6 — Suscribir el evento de mensajes
En la misma sección de Webhooks, en **Campos de webhook**, tildá **messages**.
> Sin esto NO te llegan los clics de los botones/listas.

### Paso 7 — Probar
1. En *Configuración de la API*, agregá tu número personal como número de prueba.
2. Escribí "hola" al número de WhatsApp de la app.
3. El bot responde con el menú de deportes → elegís uno → te muestra la lista de turnos → tocás uno → **reserva confirmada**.

### Paso 8 — Producción (número real)
1. En *Configuración de la API* → **Agregar número de teléfono**.
2. El número **no puede estar registrado** en la app normal de WhatsApp / WhatsApp Business.
3. Se verifica por SMS o llamada.
4. Para iniciar vos una conversación fuera de la ventana de 24 h necesitás **plantillas (templates)** aprobadas por Meta. Dentro de la ventana de 24 h (cuando el cliente te escribió primero) podés mandar mensajes interactivos libres, como hace este bot.

---

## 🔄 Flujo del bot

```
Cliente escribe "hola"
   → Bot muestra botones: [Pádel] [Paleta] [Tenis]
Cliente toca "Pádel"
   → Bot muestra lista interactiva con turnos disponibles de hoy
Cliente toca "18:00 - 19:30"
   → reservarTurno() con UPDATE condicional
      ├─ Éxito → "✅ ¡Turno confirmado! ..."
      └─ Ya ocupado → "⚠️ Se acaba de ocupar" + muestra otros turnos
```

---

## ⚙️ Cron jobs (automáticos)

En `jobs/cron.js` (se inician con el backend):
- **03:00 diario** → genera turnos de los próximos 7 días para todas las canchas activas.
- **Cada 2 min** → libera turnos `pendiente` con TTL vencido.
- **02:00 diario** → marca como `completado` los turnos reservados ya pasados.

---

## 💰 Cobros

Cada reserva registra `pagado` (bool), `medio_pago` (efectivo/transferencia/tarjeta) y `monto`. Desde el panel, botón **Cobrar** en cada reserva.

**Mejora sugerida**: integrar **Mercado Pago** para generar un link de pago al confirmar el turno y marcar `pagado=true` vía su webhook. Reduce el ausentismo (no-show).

---

## 🗄️ Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/turnos/generar-proximos` | Genera turnos N días |
| GET | `/api/turnos/hoy?tipo=padel` | Turnos disponibles hoy |
| POST | `/api/turnos/:id/reservar` | Reservar (concurrencia) |
| POST | `/api/turnos/bloquear-evento` | Bloquear cancha para evento |
| POST | `/api/turnos/reservas/:id/pago` | Registrar pago |
| GET/POST | `/whatsapp/webhook` | Webhook de Meta |

---

## 🔐 Recomendación de seguridad para producción

Validá la **firma del webhook** (`X-Hub-Signature-256`) usando el *App Secret* de Meta, para asegurar que los POST vienen realmente de Meta. Se agrega como middleware antes de procesar el body.
