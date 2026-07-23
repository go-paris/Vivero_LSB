'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');

async function main() {
  const before = 'gustavo.gonzalez';
  const after = 'gustavo.paris';
  const credentialsPath = path.join(__dirname, '..', '.team-initial-credentials.txt');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id, email, nombre, rol FROM vivero_usuarios
       WHERE email = ? AND rol = 'director_general' LIMIT 1 FOR UPDATE`,
      [before]
    );
    if (rows.length !== 1) throw new Error('No se encontró el identificador original exacto');
    const [duplicate] = await conn.query('SELECT id FROM vivero_usuarios WHERE email = ? LIMIT 1', [after]);
    if (duplicate.length) throw new Error('El nuevo identificador ya está en uso');
    await conn.query('UPDATE vivero_usuarios SET email = ? WHERE id = ?', [after, rows[0].id]);
    await conn.query(
      `INSERT INTO vivero_auditoria
       (actor_usuario_id, accion, entidad, entidad_id, motivo, valores_anteriores, valores_nuevos)
       VALUES (?, 'USUARIO_ACTUALIZADO', 'usuario', ?,
       'Corrección autorizada del identificador inicial del Director General', ?, ?)`,
      [rows[0].id, String(rows[0].id), JSON.stringify({ identifier: before }), JSON.stringify({ identifier: after })]
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  const credentials = fs.readFileSync(credentialsPath, 'utf8');
  if (!credentials.includes(`Usuario: ${before}`)) throw new Error('La base se actualizó, pero la distribución local no contiene el identificador anterior');
  fs.writeFileSync(credentialsPath, credentials.replace(`Usuario: ${before}`, `Usuario: ${after}`), { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ ok: true, identifier: after, role: 'director_general', password_changed: false, secrets_exposed: false }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.end());
