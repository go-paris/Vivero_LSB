'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const database = String(process.env.DB_NAME || '');
  if (!/^vivero_lemu_(development|test|validation|production)$/.test(database)) throw new Error('Base fuera del alcance Vivero Lemú');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
  });
  try {
    const [[marker]] = await connection.query('SELECT sistema, schema_version FROM vivero_metadata WHERE id = 1');
    const [objects] = await connection.query(
      `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND (TABLE_NAME LIKE 'vivero_%' OR TABLE_NAME = 'v_asistencia_vivero')
       ORDER BY TABLE_NAME`, [database]
    );
    const tables = objects.filter(item => item.TABLE_TYPE === 'BASE TABLE').length;
    const views = objects.filter(item => item.TABLE_TYPE === 'VIEW').length;
    const required = new Set(['vivero_horarios', 'vivero_ausencias', 'vivero_cronograma']);
    const present = new Set(objects.filter(item => item.TABLE_TYPE === 'BASE TABLE').map(item => item.TABLE_NAME));
    const ok = marker?.sistema === 'VIVERO_LEMU' && Number(marker.schema_version) >= 3
      && tables >= 21 && views === 4 && [...required].every(name => present.has(name));
    console.log(JSON.stringify({ ok, read_only: true, database, schema_version: marker?.schema_version, tables, views, secrets_exposed: false }));
    if (!ok) process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
