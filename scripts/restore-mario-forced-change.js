'use strict';
require('dotenv').config();
const db = require('../db');

async function main() {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id FROM vivero_usuarios
       WHERE email = 'mario.guzman' AND rol = 'administrador_tecnico' FOR UPDATE`
    );
    if (rows.length !== 1) throw new Error('Usuario de prueba no encontrado');
    await conn.query('UPDATE vivero_usuarios SET debe_cambiar_clave = 1 WHERE id = ?', [rows[0].id]);
    await conn.query(
      `INSERT INTO vivero_auditoria
       (actor_usuario_id, accion, entidad, entidad_id, motivo, valores_nuevos)
       VALUES (?, 'CLAVE_TEMPORAL_ASIGNADA', 'usuario', ?,
       'Restauración posterior a prueba funcional controlada', ?)`,
      [rows[0].id, String(rows[0].id), JSON.stringify({ debe_cambiar_clave: true })]
    );
    await conn.commit();
    console.log(JSON.stringify({ ok: true, user: 'mario.guzman', forced_change: true, secrets_exposed: false }));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.end());
