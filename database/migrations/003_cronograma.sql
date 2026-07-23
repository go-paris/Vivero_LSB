-- Migración v3. Ejecutar solo sobre vivero_lemu_validation seleccionada.
USE `vivero_lemu_validation`;
ALTER TABLE vivero_ausencias
  MODIFY COLUMN tipo ENUM('licencia','comision','vacaciones','enfermedad','dia_estudio','otro') NOT NULL;
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
UPDATE vivero_metadata SET schema_version=3 WHERE id=1 AND sistema='VIVERO_LEMU';
