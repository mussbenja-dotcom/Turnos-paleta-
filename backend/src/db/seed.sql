-- =====================================================================
-- Datos de ejemplo
-- =====================================================================

INSERT INTO clubes (nombre, direccion, telefono) VALUES
('Club Pádel Rufino', 'Pte. Perón 136, Rufino', '+5493382000000');

INSERT INTO canchas (club_id, nombre, tipo, hora_apertura, hora_cierre, duracion_min, precio) VALUES
(1, 'Cancha 1', 'padel',  '09:00', '23:00', 90, 8000),
(1, 'Cancha 2', 'padel',  '09:00', '23:00', 90, 8000),
(1, 'Cancha 3', 'paleta', '10:00', '22:00', 60, 6000),
(1, 'Cancha 4', 'tenis',  '08:00', '22:00', 60, 7000);
