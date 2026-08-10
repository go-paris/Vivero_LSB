-- Vivero Lemú — esquema independiente reproducible
-- Ejecutar únicamente dentro de una base vivero_lemu_* ya seleccionada.
-- No contiene CREATE DATABASE, USE, usuarios MySQL, secretos ni datos operativos.

CREATE TABLE IF NOT EXISTS vivero_metadata (
  id TINYINT PRIMARY KEY,
  sistema VARCHAR(50) NOT NULL,
  schema_version INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_vivero_metadata_id CHECK (id = 1)
);

INSERT INTO vivero_metadata (id, sistema, schema_version)
VALUES (1, 'VIVERO_LEMU', 4)
ON DUPLICATE KEY UPDATE sistema = VALUES(sistema), schema_version = VALUES(schema_version);

CREATE TABLE IF NOT EXISTS vivero_usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  rol ENUM('director_general','administrador_tecnico','usuario') NOT NULL DEFAULT 'usuario',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  debe_cambiar_clave TINYINT(1) NOT NULL DEFAULT 1,
  bio TEXT NULL,
  foto_url VARCHAR(500) NULL,
  intentos_fallidos INT NOT NULL DEFAULT 0,
  bloqueado_hasta DATETIME NULL,
  ultimo_acceso DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_vivero_usuarios_rol_activo (rol, activo)
);

CREATE TABLE IF NOT EXISTS vivero_sessions (
  session_id VARCHAR(128) NOT NULL PRIMARY KEY,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT NULL,
  INDEX idx_vivero_sessions_expires (expires)
);

CREATE TABLE IF NOT EXISTS vivero_auditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_usuario_id INT NULL,
  accion VARCHAR(80) NOT NULL,
  entidad VARCHAR(80) NOT NULL,
  entidad_id VARCHAR(80) NULL,
  motivo VARCHAR(500) NULL,
  valores_anteriores JSON NULL,
  valores_nuevos JSON NULL,
  ip_hash CHAR(64) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_auditoria_actor FOREIGN KEY (actor_usuario_id) REFERENCES vivero_usuarios(id) ON DELETE SET NULL,
  INDEX idx_vivero_auditoria_entidad (entidad, entidad_id),
  INDEX idx_vivero_auditoria_fecha (creado_en)
);

CREATE TABLE IF NOT EXISTS vivero_asistencia (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  tipo ENUM('entrada','salida') NOT NULL,
  nombre_usuario VARCHAR(120) NOT NULL,
  timestamp_registro DATETIME NOT NULL,
  latitud DECIMAL(10,8) NOT NULL,
  longitud DECIMAL(11,8) NOT NULL,
  precision_m INT NOT NULL,
  distancia_vivero_m INT NOT NULL,
  fecha_local DATE NOT NULL,
  sede_codigo VARCHAR(50) NOT NULL,
  geocerca_version VARCHAR(50) NOT NULL,
  anulado_en DATETIME NULL,
  anulado_por INT NULL,
  motivo_anulacion VARCHAR(500) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_asistencia_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  CONSTRAINT fk_asistencia_anulado_por FOREIGN KEY (anulado_por) REFERENCES vivero_usuarios(id) ON DELETE SET NULL,
  INDEX idx_asistencia_usuario_fecha (usuario_id, fecha_local, timestamp_registro),
  INDEX idx_asistencia_fecha (fecha_local)
);

CREATE TABLE IF NOT EXISTS vivero_novedades (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  nombre_usuario VARCHAR(120) NOT NULL,
  tipo ENUM('novedad','instruccion','reporte') NOT NULL DEFAULT 'novedad',
  contenido TEXT NOT NULL,
  fecha_local DATE NOT NULL DEFAULT (CURDATE()),
  fecha_limite DATE NULL,
  estado ENUM('pendiente','concluida_operario','finalizada') NOT NULL DEFAULT 'pendiente',
  marcada_por INT NULL,
  marcada_en DATETIME NULL,
  finalizada_por INT NULL,
  finalizada_en DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_novedad_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  CONSTRAINT fk_novedad_marcada FOREIGN KEY (marcada_por) REFERENCES vivero_usuarios(id) ON DELETE SET NULL,
  CONSTRAINT fk_novedad_finalizada FOREIGN KEY (finalizada_por) REFERENCES vivero_usuarios(id) ON DELETE SET NULL,
  INDEX idx_novedad_fecha (fecha_local),
  INDEX idx_novedad_tipo_estado (tipo, estado)
);

CREATE TABLE IF NOT EXISTS vivero_subactividades (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  instruccion_id BIGINT NOT NULL,
  titulo VARCHAR(150) NOT NULL,
  orden INT NOT NULL DEFAULT 0,
  completada TINYINT(1) NOT NULL DEFAULT 0,
  completada_por INT NULL,
  completada_en DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_subactividad_instruccion FOREIGN KEY (instruccion_id) REFERENCES vivero_novedades(id) ON DELETE CASCADE,
  CONSTRAINT fk_subactividad_usuario FOREIGN KEY (completada_por) REFERENCES vivero_usuarios(id) ON DELETE SET NULL,
  INDEX idx_subactividad_instruccion (instruccion_id, orden)
);

CREATE TABLE IF NOT EXISTS vivero_archivos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  novedad_id BIGINT NULL,
  usuario_id INT NOT NULL,
  nombre_orig VARCHAR(255) NOT NULL,
  nombre_disco VARCHAR(255) NOT NULL UNIQUE,
  tipo_mime VARCHAR(100) NULL,
  tamanio_kb INT NULL,
  fecha_local DATE NOT NULL DEFAULT (CURDATE()),
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_archivo_novedad FOREIGN KEY (novedad_id) REFERENCES vivero_novedades(id) ON DELETE SET NULL,
  CONSTRAINT fk_archivo_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  INDEX idx_archivo_fecha (fecha_local)
);

CREATE TABLE IF NOT EXISTS vivero_bibliografia (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  titulo VARCHAR(300) NOT NULL,
  autor VARCHAR(250) NULL,
  url VARCHAR(1000) NULL,
  tags VARCHAR(500) NULL,
  descripcion TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bibliografia_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id)
);

CREATE TABLE IF NOT EXISTS vivero_tareas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  titulo VARCHAR(250) NOT NULL,
  categoria VARCHAR(80) NOT NULL DEFAULT 'otro',
  prioridad ENUM('baja','media','alta') NOT NULL DEFAULT 'media',
  observaciones TEXT NULL,
  completada TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tarea_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  INDEX idx_tarea_usuario_fecha (usuario_id, created_at, completada)
);

CREATE TABLE IF NOT EXISTS vivero_semillas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(120) NOT NULL UNIQUE,
  especie VARCHAR(180) NOT NULL,
  nombre_comun VARCHAR(180) NULL,
  procedencia VARCHAR(300) NOT NULL,
  proveedor_recolector VARCHAR(250) NULL,
  fecha_recoleccion DATE NULL,
  fecha_ingreso DATE NOT NULL,
  peso_humedo_kg DECIMAL(12,3) NULL,
  peso_seco_kg DECIMAL(12,3) NULL,
  humedad_pct DECIMAL(5,2) NULL,
  cantidad_inicial DECIMAL(14,3) NOT NULL,
  cantidad_disponible DECIMAL(14,3) NOT NULL,
  unidad ENUM('semillas','gramos','kilogramos') NOT NULL DEFAULT 'semillas',
  tratamiento_pregerminativo VARCHAR(500) NULL,
  almacenamiento VARCHAR(300) NULL,
  estado ENUM('disponible','en_tratamiento','agotada','descartada') NOT NULL DEFAULT 'disponible',
  observaciones TEXT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_semilla_usuario FOREIGN KEY (created_by) REFERENCES vivero_usuarios(id),
  INDEX idx_semilla_especie_estado (especie, estado)
);

CREATE TABLE IF NOT EXISTS vivero_lotes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  especie VARCHAR(180) NOT NULL,
  nombre_comun VARCHAR(180) NULL,
  lote VARCHAR(120) NOT NULL UNIQUE,
  cantidad INT NULL,
  fecha_siembra DATE NULL,
  sustrato VARCHAR(250) NULL,
  sector VARCHAR(150) NULL,
  notas TEXT NULL,
  created_by INT NOT NULL,
  procedencia_semilla VARCHAR(300) NULL,
  lote_semilla VARCHAR(150) NULL,
  cantidad_semilla INT NULL,
  semilla_id BIGINT NULL,
  cantidad_actual INT NULL,
  etapa_actual ENUM('siembra','germinacion','repique','crecimiento','rustificacion','despacho') NOT NULL DEFAULT 'siembra',
  fecha_etapa_actual DATE NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_lote_usuario FOREIGN KEY (created_by) REFERENCES vivero_usuarios(id),
  CONSTRAINT fk_lote_semilla FOREIGN KEY (semilla_id) REFERENCES vivero_semillas(id),
  INDEX idx_lote_especie_activo (especie, activo)
);

CREATE TABLE IF NOT EXISTS vivero_lote_etapas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lote_id BIGINT NOT NULL,
  etapa ENUM('siembra','germinacion','repique','crecimiento','rustificacion','despacho') NOT NULL,
  fecha DATE NOT NULL,
  cantidad_ok INT NULL,
  cantidad_perdida INT NOT NULL DEFAULT 0,
  causa_perdida VARCHAR(500) NULL,
  observaciones TEXT NULL,
  usuario_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_etapa_lote FOREIGN KEY (lote_id) REFERENCES vivero_lotes(id),
  CONSTRAINT fk_etapa_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  INDEX idx_etapa_lote_fecha (lote_id, fecha)
);

CREATE TABLE IF NOT EXISTS vivero_lote_muestreos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lote_id BIGINT NOT NULL,
  fecha DATE NOT NULL,
  n_muestras INT NOT NULL DEFAULT 10,
  altura_prom_cm DECIMAL(10,2) NULL,
  altura_min_cm DECIMAL(10,2) NULL,
  altura_max_cm DECIMAL(10,2) NULL,
  diametro_prom_mm DECIMAL(10,2) NULL,
  vigor VARCHAR(80) NULL,
  observaciones TEXT NULL,
  usuario_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_muestreo_lote FOREIGN KEY (lote_id) REFERENCES vivero_lotes(id),
  CONSTRAINT fk_muestreo_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  INDEX idx_muestreo_lote_fecha (lote_id, fecha)
);

CREATE TABLE IF NOT EXISTS vivero_riegos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lote_id BIGINT NOT NULL,
  fecha DATE NOT NULL,
  volumen_litros DECIMAL(12,2) NULL,
  sistema VARCHAR(100) NULL,
  duracion_min INT NULL,
  observaciones TEXT NULL,
  usuario_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_riego_lote FOREIGN KEY (lote_id) REFERENCES vivero_lotes(id),
  CONSTRAINT fk_riego_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  INDEX idx_riego_lote_fecha (lote_id, fecha)
);

CREATE TABLE IF NOT EXISTS vivero_fertilizaciones (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lote_id BIGINT NOT NULL,
  fecha DATE NOT NULL,
  producto VARCHAR(250) NOT NULL,
  tipo_aplicacion VARCHAR(120) NULL,
  dosis VARCHAR(120) NULL,
  formula_npk VARCHAR(80) NULL,
  observaciones TEXT NULL,
  usuario_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fertilizacion_lote FOREIGN KEY (lote_id) REFERENCES vivero_lotes(id),
  CONSTRAINT fk_fertilizacion_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  INDEX idx_fertilizacion_lote_fecha (lote_id, fecha)
);

CREATE TABLE IF NOT EXISTS vivero_sanidad (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lote_id BIGINT NOT NULL,
  fecha DATE NOT NULL,
  tipo VARCHAR(100) NOT NULL,
  agente VARCHAR(250) NULL,
  severidad ENUM('baja','media','alta') NOT NULL DEFAULT 'baja',
  tratamiento VARCHAR(500) NULL,
  dosis VARCHAR(120) NULL,
  periodo_carencia_dias INT NULL,
  observaciones TEXT NULL,
  usuario_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sanidad_lote FOREIGN KEY (lote_id) REFERENCES vivero_lotes(id),
  CONSTRAINT fk_sanidad_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  INDEX idx_sanidad_lote_fecha (lote_id, fecha, severidad)
);

CREATE TABLE IF NOT EXISTS vivero_despachos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lote_id BIGINT NOT NULL,
  fecha DATE NOT NULL,
  cantidad INT NOT NULL,
  tipo_destino VARCHAR(100) NOT NULL DEFAULT 'otro',
  destino VARCHAR(300) NOT NULL,
  responsable VARCHAR(200) NULL,
  observaciones TEXT NULL,
  usuario_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_despacho_lote FOREIGN KEY (lote_id) REFERENCES vivero_lotes(id),
  CONSTRAINT fk_despacho_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  INDEX idx_despacho_lote_fecha (lote_id, fecha)
);

CREATE TABLE IF NOT EXISTS vivero_mediciones (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  lote_id BIGINT NULL,
  temperatura DECIMAL(6,2) NULL,
  humedad_relativa DECIMAL(6,2) NULL,
  humedad_sustrato DECIMAL(6,2) NULL,
  ph DECIMAL(4,2) NULL,
  fertilizante VARCHAR(250) NULL,
  sustrato VARCHAR(250) NULL,
  observaciones TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_medicion_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  CONSTRAINT fk_medicion_lote FOREIGN KEY (lote_id) REFERENCES vivero_lotes(id) ON DELETE SET NULL,
  INDEX idx_medicion_fecha (created_at)
);

-- Calendario laboral administrable. No presupone días ni horarios por rol.
CREATE TABLE IF NOT EXISTS vivero_horarios (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  dia_semana TINYINT NOT NULL COMMENT '1=lunes, 7=domingo',
  hora_entrada TIME NOT NULL,
  hora_salida TIME NOT NULL,
  tolerancia_min INT NOT NULL DEFAULT 15,
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_horario_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  CONSTRAINT fk_horario_creador FOREIGN KEY (creado_por) REFERENCES vivero_usuarios(id),
  CONSTRAINT chk_horario_dia CHECK (dia_semana BETWEEN 1 AND 7),
  CONSTRAINT chk_horario_horas CHECK (hora_salida > hora_entrada),
  CONSTRAINT chk_horario_tolerancia CHECK (tolerancia_min BETWEEN 0 AND 180),
  INDEX idx_horario_usuario_vigencia (usuario_id, activo, vigente_desde, vigente_hasta, dia_semana)
);

CREATE TABLE IF NOT EXISTS vivero_ausencias (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  fecha_desde DATE NOT NULL,
  fecha_hasta DATE NOT NULL,
  tipo ENUM('licencia','comision','vacaciones','enfermedad','dia_estudio','otro') NOT NULL,
  estado ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'aprobada',
  observaciones VARCHAR(500) NULL,
  registrado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ausencia_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  CONSTRAINT fk_ausencia_registrador FOREIGN KEY (registrado_por) REFERENCES vivero_usuarios(id),
  CONSTRAINT chk_ausencia_fechas CHECK (fecha_hasta >= fecha_desde),
  INDEX idx_ausencia_usuario_fecha (usuario_id, fecha_desde, fecha_hasta, estado)
);

CREATE TABLE IF NOT EXISTS vivero_cronograma (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(250) NOT NULL,
  tipo ENUM('siembra','repique','riego','fertilizacion','sanidad','rustificacion','plantacion','despacho','mantenimiento','capacitacion','otro') NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NULL,
  hora TIME NULL,
  lote_id BIGINT NULL,
  responsable_usuario_id INT NULL,
  descripcion TEXT NULL,
  alertar_dias_antes INT NOT NULL DEFAULT 0,
  estado ENUM('programada','en_curso','completada','cancelada') NOT NULL DEFAULT 'programada',
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cronograma_lote FOREIGN KEY (lote_id) REFERENCES vivero_lotes(id) ON DELETE SET NULL,
  CONSTRAINT fk_cronograma_responsable FOREIGN KEY (responsable_usuario_id) REFERENCES vivero_usuarios(id) ON DELETE SET NULL,
  CONSTRAINT fk_cronograma_creador FOREIGN KEY (creado_por) REFERENCES vivero_usuarios(id),
  CONSTRAINT chk_cronograma_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
  CONSTRAINT chk_cronograma_alerta CHECK (alertar_dias_antes BETWEEN 0 AND 90),
  INDEX idx_cronograma_fecha_estado (fecha_inicio, estado),
  INDEX idx_cronograma_lote (lote_id),
  INDEX idx_cronograma_responsable (responsable_usuario_id)
);

CREATE VIEW v_asistencia_vivero AS
SELECT va.fecha_local AS fecha, va.usuario_id, va.nombre_usuario AS nombre,
       MIN(CASE WHEN va.tipo = 'entrada' THEN va.timestamp_registro END) AS primera_entrada,
       MAX(CASE WHEN va.tipo = 'salida' THEN va.timestamp_registro END) AS ultima_salida,
       COUNT(*) AS cantidad_registros,
       MIN(va.distancia_vivero_m) AS distancia_min_m
FROM vivero_asistencia va
WHERE va.anulado_en IS NULL
GROUP BY va.fecha_local, va.usuario_id, va.nombre_usuario;

CREATE VIEW vivero_tareas_detalle AS
SELECT t.*, u.nombre AS usuario_nombre
FROM vivero_tareas t JOIN vivero_usuarios u ON u.id = t.usuario_id;

CREATE VIEW vivero_ranking_semanal AS
SELECT u.id AS usuario_id, u.nombre,
       SUM(t.completada = 1) AS completadas,
       COUNT(t.id) AS total
FROM vivero_usuarios u
LEFT JOIN vivero_tareas t ON t.usuario_id = u.id
  AND t.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
WHERE u.activo = 1
GROUP BY u.id, u.nombre
ORDER BY completadas DESC, total DESC;

CREATE VIEW vivero_mediciones_detalle AS
SELECT m.*, u.nombre AS usuario_nombre, l.lote, l.especie
FROM vivero_mediciones m
JOIN vivero_usuarios u ON u.id = m.usuario_id
LEFT JOIN vivero_lotes l ON l.id = m.lote_id;
