'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

(async () => {
  const database = String(process.env.DB_NAME || '');
  if (!/^vivero_lemu_(development|test|validation|production)$/.test(database)) {
    throw new Error('Migración v4 rechazada fuera de una base Vivero Lemú');
  }
  if (process.env.SCHEMA_APPLY_CONFIRM !== database) throw new Error('Falta confirmación exacta SCHEMA_APPLY_CONFIRM');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database, multipleStatements: true,
  });
  try {
    const [[marker]] = await connection.query('SELECT sistema, schema_version FROM vivero_metadata WHERE id=1');
    if (marker?.sistema !== 'VIVERO_LEMU' || Number(marker.schema_version) < 3 || Number(marker.schema_version) > 4) {
      throw new Error('Marca o versión incompatible');
    }
    await connection.query(fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '004_semillas.sql'), 'utf8'));
    const [[table]] = await connection.query(
      `SELECT COUNT(*) total FROM information_schema.TABLES
       WHERE TABLE_SCHEMA=? AND TABLE_NAME='vivero_semillas'`, [database]
    );
    const [[column]] = await connection.query(
      `SELECT COUNT(*) total FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME='vivero_lotes' AND COLUMN_NAME='semilla_id'`, [database]
    );
    if (Number(table.total) !== 1 || Number(column.total) !== 1) throw new Error('Verificación posterior incompleta');
    console.log(JSON.stringify({ ok: true, database, schema_version: 4, table_added: 'vivero_semillas', secrets_exposed: false }));
  } finally { await connection.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
