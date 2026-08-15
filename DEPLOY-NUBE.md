# ☁️ Guía de despliegue en la nube (Railway)

Esta guía te lleva de "el código en tu compu" a "el sistema funcionando 24/7 en internet", sin depender de ninguna computadora encendida.

Usamos **Railway** porque es lo más simple para este stack: crea la base PostgreSQL sola, hostea el backend, y te da una URL HTTPS pública (necesaria para el webhook de WhatsApp). Reemplaza totalmente a ngrok.

> 💡 Costo aproximado: Railway da un crédito gratis mensual para empezar. Para uso real de un club, ronda los **USD 5/mes**.

---

## Resumen de los pasos

1. Subir el proyecto a GitHub.
2. Crear el proyecto en Railway y la base PostgreSQL.
3. Desplegar el backend + variables de entorno.
4. Inicializar la base (crear las tablas).
5. Desplegar el panel admin.
6. Apuntar el webhook de Meta a la URL de Railway.

---

## Paso 1 — Subir el proyecto a GitHub

Railway despliega desde un repositorio de GitHub. Si nunca usaste git:

1. Creá una cuenta en **github.com** (gratis).
2. Instalá **git** en tu compu (git-scm.com).
3. Creá un repositorio nuevo y vacío en GitHub (botón *New* → nombre `padel-turnos` → *Create*).
4. En tu compu, dentro de la carpeta del proyecto:

```bash
cd padel-turnos
git init
git add .
git commit -m "Primera versión"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/padel-turnos.git
git push -u origin main
```

> El archivo `.gitignore` ya está incluido: NO se suben `node_modules` ni el `.env` (tus credenciales quedan privadas). ✓

---

## Paso 2 — Crear el proyecto y la base en Railway

1. Entrá a **railway.app** e iniciá sesión con tu cuenta de GitHub.
2. **New Project** → **Deploy from GitHub repo** → elegí tu repo `padel-turnos`.
3. Railway detecta el proyecto. Por ahora puede fallar el deploy porque falta la base y las variables — es normal, lo arreglamos en los próximos pasos.
4. Dentro del proyecto, hacé click en **+ New** → **Database** → **Add PostgreSQL**.
5. Railway crea la base y genera automáticamente una variable `DATABASE_URL`.

---

## Paso 3 — Configurar el backend

Railway probablemente tomó la raíz del repo, pero nuestro backend está en la subcarpeta `backend/`. Hay que indicárselo:

1. Click en el servicio del backend → pestaña **Settings**.
2. En **Root Directory**, poné: `backend`
3. En **Start Command** (si no lo detecta): `npm start`

Ahora las **variables de entorno**. Andá a la pestaña **Variables** del servicio backend y agregá:

| Variable | Valor |
|----------|-------|
| `DATABASE_URL` | Click en *Add Reference* → elegí la de PostgreSQL (se conecta sola) |
| `DB_SSL` | `true` |
| `ENABLE_CRON` | `true` |
| `TZ_OFFSET` | `-03:00` |
| `WA_TOKEN` | (tu token de Meta) |
| `WA_PHONE_ID` | (tu Phone number ID de Meta) |
| `WA_API_VERSION` | `v21.0` |
| `WA_VERIFY_TOKEN` | (inventá una clave secreta, ej: `club2026xyz`) |

> ⚠️ `DB_SSL=true` es obligatorio en la nube. Sin eso la conexión a la base falla.

Guardá. Railway va a redeployar solo.

---

## Paso 4 — Inicializar la base (crear las tablas)

La base está vacía; hay que crear las tablas una sola vez.

1. En el servicio del backend, buscá la pestaña de **consola / terminal** (Railway la ofrece como "Deploy Logs" y también un shell). Si tenés la Railway CLI instalada, corré desde tu compu:

```bash
railway run npm run db:init:seed
```

Esto crea las tablas **y** carga un club + canchas de ejemplo. Si no querés los datos de ejemplo, usá `npm run db:init` (solo tablas).

> Alternativa sin CLI: podés conectarte a la base con cualquier cliente Postgres (como **TablePlus** o **DBeaver**) usando los datos de conexión que Railway muestra en el servicio de PostgreSQL, y correr ahí el contenido de `backend/src/db/schema.sql`.

---

## Paso 5 — Obtener la URL pública del backend

1. En el servicio del backend → **Settings** → **Networking** → **Generate Domain**.
2. Railway te da una URL tipo: `https://padel-turnos-production.up.railway.app`
3. Probala en el navegador agregando `/health` al final:
   `https://...railway.app/health` → debe responder `{"ok":true}` ✓

**Esta URL es la que reemplaza a ngrok.** Guardala.

---

## Paso 6 — Desplegar el panel admin

El panel es un sitio estático (React). Dos opciones:

**Opción A — Railway (mismo proyecto):**
1. **+ New** → **GitHub Repo** → el mismo repo.
2. En **Settings** de ese servicio: **Root Directory** = `admin-panel`.
3. **Build Command** = `npm run build`, **Start Command** = `npm run preview -- --host 0.0.0.0 --port $PORT`.
4. En **Variables**, agregá `VITE_API_URL` con la URL pública del backend (la del Paso 5).
5. Generá un dominio para este servicio también.

**Opción B — Vercel / Netlify (gratis, ideal para sitios estáticos):**
1. Importá el repo, seteá el directorio raíz en `admin-panel`.
2. Variable `VITE_API_URL` = URL del backend.
3. Deploy. Te queda el panel en una URL propia.

---

## Paso 7 — Conectar el webhook de Meta

Ahora que el backend tiene URL pública fija, andá a la config de Meta (ver README principal, sección WhatsApp) y en **Webhooks**:

- **Callback URL**: `https://TU-BACKEND.up.railway.app/whatsapp/webhook`
- **Verify token**: el mismo que pusiste en `WA_VERIFY_TOKEN`.
- Suscribí el campo **messages**.

Como la URL de Railway es fija (a diferencia de ngrok), **no tenés que reconfigurar el webhook nunca más.** ✓

---

## ✅ Listo

Tu sistema queda corriendo solo, 24/7, sin tu compu. Cada vez que hagas `git push`, Railway redeploya automáticamente la nueva versión.

### Checklist final
- [ ] `/health` responde OK
- [ ] Las tablas están creadas (entrá al panel y cargá una cancha)
- [ ] Generaste turnos con el botón del panel
- [ ] El webhook de Meta figura como "verificado"
- [ ] Le escribís al número y el bot responde

---

## Notas de mantenimiento

- **Logs**: Railway muestra los logs en vivo de cada servicio. Ahí ves los mensajes del bot y errores.
- **Token de WhatsApp**: el token temporal de Meta dura 24h. Para producción generá el **token permanente** (System User) como explica el README principal, y actualizá `WA_TOKEN` en las Variables de Railway.
- **Backups**: Railway permite backups de la base Postgres desde el panel del servicio de la base.
