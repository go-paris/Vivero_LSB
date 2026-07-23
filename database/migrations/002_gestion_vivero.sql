-- Migración v2. Ejecutar solo sobre una base vivero_lemu_* validada.
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
  tipo ENUM('licencia','comision','vacaciones','enfermedad','otro') NOT NULL,
  estado ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'aprobada',
  observaciones VARCHAR(500) NULL,
  registrado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ausencia_usuario FOREIGN KEY (usuario_id) REFERENCES vivero_usuarios(id),
  CONSTRAINT fk_ausencia_registrador FOREIGN KEY (registrado_por) REFERENCES vivero_usuarios(id),
  CONSTRAINT chk_ausencia_fechas CHECK (fecha_hasta >= fecha_desde),
  INDEX idx_ausencia_usuario_fecha (usuario_id, fecha_desde, fecha_hasta, estado)
);
UPDATE vivero_metadata SET schema_version = 2 WHERE id = 1 AND sistema = 'VIVERO_LEMU';
