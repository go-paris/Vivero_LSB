'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

function environment() {
  const value = {
    host: String(process.env.DB_HOST || ''),
    port: Number(process.env.DB_PORT || 3306),
    user: String(process.env.DB_USER || ''),
    password: String(process.env.DB_PASSWORD || ''),
    database: String(process.env.DB_NAME || ''),
  };
  if (!/^vivero_lemu_(development|test|validation|production)$/.test(value.database)) throw new Error('Base fuera del alcance Vivero Lemú');
  if (!value.host || !value.user || value.user.toLowerCase() === 'root' || !value.password) throw new Error('Credenciales de aplicación inválidas');
  if (process.env.SCHEMA_APPLY_CONFIRM !== value.database) throw new Error('Falta confirmación exacta SCHEMA_APPLY_CONFIRM');
  return value;
}

async function main() {
  const env = environment();
  const sql = fs.readFileSync(path.join(__dirname, '..', 'vivero_schema.sql'), 'utf8');
  if (/\bbosques_chubut\b|CREATE\s+DATABASE|\bUSE\s+/i.test(sql.replace(/^\s*--.*$/gm, ''))) throw new Error('SQL fuera de alcance');
  const connection = await mysql.createConnection({ ...env, multipleStatements: true });
  try {
    const [existing] = await connection.query(
      'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
      [env.database]
    );
    const tables = existing.filter(item => item.TABLE_TYPE === 'BASE TABLE');
    const views = existing.filter(item => item.TABLE_TYPE === 'VIEW');
    if (views.length === 4) throw new Error('El esquema ya fue aplicado; no se reejecutó');
    if (existing.length && !(tables.length === 18 && views.length === 0)) {
      throw new Error(`Estado parcial no recuperable automáticamente: ${tables.length} tablas y ${views.length} vistas`);
    }
    if (tables.length === 18) {
      const [[partialMarker]] = await connection.query('SELECT sistema, schema_version FROM vivero_metadata WHERE id = 1');
      const [[operationalRows]] = await connection.query(`
        SELECT
          (SELECT COUNT(*) FROM vivero_usuarios) +
          (SELECT COUNT(*) FROM vivero_asistencia) +
          (SELECT COUNT(*) FROM vivero_auditoria) AS total
      `);
      if (partialMarker?.sistema !== 'VIVERO_LEMU' || Number(operationalRows.total) !== 0) {
        throw new Error('Estado parcial con marca o datos incompatibles; no se reanudó');
      }
    }
    await connection.query(sql);
    const [[marker]] = await connection.query('SELECT sistema, schema_version FROM vivero_metadata WHERE id = 1');
    if (marker?.sistema !== 'VIVERO_LEMU') throw new Error('Verificación de marca fallida');
    console.log(JSON.stringify({ ok: true, database: env.database, schema_version: marker.schema_version, secrets_exposed: false }));
  } finally {
    await connection.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
