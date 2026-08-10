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

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vivero_lotes' AND COLUMN_NAME = 'semilla_id'
);
SET @column_sql = IF(@column_exists = 0,
  'ALTER TABLE vivero_lotes ADD COLUMN semilla_id BIGINT NULL AFTER cantidad_semilla',
  'SELECT 1');
PREPARE column_stmt FROM @column_sql;
EXECUTE column_stmt;
DEALLOCATE PREPARE column_stmt;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'vivero_lotes'
    AND CONSTRAINT_NAME = 'fk_lote_semilla' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @fk_sql = IF(@fk_exists = 0,
  'ALTER TABLE vivero_lotes ADD CONSTRAINT fk_lote_semilla FOREIGN KEY (semilla_id) REFERENCES vivero_semillas(id)',
  'SELECT 1');
PREPARE fk_stmt FROM @fk_sql;
EXECUTE fk_stmt;
DEALLOCATE PREPARE fk_stmt;

UPDATE vivero_metadata SET schema_version = 4 WHERE id = 1 AND sistema = 'VIVERO_LEMU';
