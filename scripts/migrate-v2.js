'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const database = String(process.env.DB_NAME || '');
  if (!/^vivero_lemu_(development|test|validation)$/.test(database)) throw new Error('Migración v2 rechazada fuera de desarrollo/prueba/validación');
  if (!['development','test','validation'].includes(process.env.NODE_ENV)) throw new Error('NODE_ENV no autorizado para migración v2');
  const connection = await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database,multipleStatements:true});
  try {
    const [[marker]] = await connection.query('SELECT sistema, schema_version FROM vivero_metadata WHERE id=1');
    if (marker?.sistema !== 'VIVERO_LEMU') throw new Error('Marca VIVERO_LEMU ausente');
    if (Number(marker.schema_version) > 2) throw new Error('La base tiene una versión posterior');
    const sql = fs.readFileSync(path.join(__dirname,'..','database','migrations','002_gestion_vivero.sql'),'utf8');
    await connection.beginTransaction();
    await connection.query(sql);
    const [tables] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN ('vivero_horarios','vivero_ausencias')`,[database]);
    if (tables.length !== 2) throw new Error('Verificación posterior incompleta');
    await connection.commit();
    console.log(JSON.stringify({ok:true,database,schema_version:2,tables_added:['vivero_horarios','vivero_ausencias'],official_databases_accessed:false,secrets_exposed:false}));
  } catch (error) { try { await connection.rollback(); } catch {} throw error; }
  finally { await connection.end(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
