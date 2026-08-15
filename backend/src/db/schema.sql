-- =====================================================================
-- Esquema de base de datos - Sistema de gestión de turnos
-- PostgreSQL
-- =====================================================================

DROP TABLE IF EXISTS reservas CASCADE;
DROP TABLE IF EXISTS turnos CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS canchas CASCADE;
DROP TABLE IF EXISTS clubes CASCADE;

-- ---------------------------------------------------------------------
-- CLUBES
-- ---------------------------------------------------------------------
CREATE TABLE clubes (
    id              SERIAL PRIMARY KEY,
    nombre          TEXT NOT NULL,
    direccion       TEXT,
    telefono        TEXT,
    creado_en       TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- CANCHAS
-- ---------------------------------------------------------------------
CREATE TABLE canchas (
    id              SERIAL PRIMARY KEY,
    club_id         INTEGER NOT NULL REFERENCES clubes(id) ON DELETE CASCADE,
    nombre          TEXT NOT NULL,
    tipo            TEXT NOT NULL CHECK (tipo IN ('padel','paleta','tenis')),
    hora_apertura   TIME NOT NULL,
    hora_cierre     TIME NOT NULL,
    duracion_min    INTEGER NOT NULL DEFAULT 90 CHECK (duracion_min > 0),
    precio          NUMERIC(10,2) DEFAULT 0,
    activa          BOOLEAN DEFAULT true
);

-- ---------------------------------------------------------------------
-- CLIENTES (usuarios de WhatsApp)
-- ---------------------------------------------------------------------
CREATE TABLE clientes (
    id              SERIAL PRIMARY KEY,
    nombre          TEXT,
    telefono        TEXT NOT NULL UNIQUE,   -- número de WhatsApp (wa_id)
    creado_en       TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- TURNOS
-- ---------------------------------------------------------------------
CREATE TABLE turnos (
    id              SERIAL PRIMARY KEY,
    cancha_id       INTEGER NOT NULL REFERENCES canchas(id) ON DELETE CASCADE,
    inicio          TIMESTAMPTZ NOT NULL,
    fin             TIMESTAMPTZ NOT NULL,
    estado          TEXT NOT NULL DEFAULT 'disponible'
                    CHECK (estado IN ('disponible','pendiente','reservado','cancelado','completado','bloqueado')),
    expira_en       TIMESTAMPTZ,            -- para estado 'pendiente' (TTL de reserva)
    -- Evita generar dos turnos iguales en la misma cancha/horario:
    CONSTRAINT turno_unico UNIQUE (cancha_id, inicio)
);

-- Índice parcial para acelerar la búsqueda de disponibles:
CREATE INDEX idx_turnos_disponibles ON turnos (cancha_id, inicio) WHERE estado = 'disponible';
CREATE INDEX idx_turnos_fecha ON turnos (inicio);

-- ---------------------------------------------------------------------
-- RESERVAS
-- ---------------------------------------------------------------------
CREATE TABLE reservas (
    id              SERIAL PRIMARY KEY,
    turno_id        INTEGER NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
    cliente_id      INTEGER NOT NULL REFERENCES clientes(id),
    tipo            TEXT NOT NULL DEFAULT 'estandar'
                    CHECK (tipo IN ('estandar','evento')),
    descripcion     TEXT,                   -- ej: "Cumpleaños de Juan"
    pagado          BOOLEAN DEFAULT false,
    medio_pago      TEXT CHECK (medio_pago IN ('efectivo','transferencia','tarjeta')),
    monto           NUMERIC(10,2),
    creada_en       TIMESTAMPTZ DEFAULT now(),
    -- Un turno sólo puede tener UNA reserva (última barrera de concurrencia):
    CONSTRAINT reserva_turno_unica UNIQUE (turno_id)
);
