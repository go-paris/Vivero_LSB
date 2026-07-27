'use strict';

require('dotenv').config();
const db = require('../db');

async function main() {
  const identifier = String(process.argv[2] || '').trim().toLowerCase();
  const actorIdentifier = String(process.env.UNLOCK_ACTOR_IDENTIFIER || '').trim().toLowerCase();
  if (!identifier || !actorIdentifier) throw new Error('Faltan usuario o actor del desbloqueo');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [targets] = await conn.query(
      'SELECT id, intentos_fallidos, bloqueado_hasta FROM vivero_usuarios WHERE email = ? LIMIT 1 FOR UPDATE',
      [identifier]
    );
    const [actors] = await conn.query(
      `SELECT id FROM vivero_usuarios
       WHERE email = ? AND rol = 'director_general' AND activo = 1 LIMIT 1`,
      [actorIdentifier]
    );
    if (targets.length !== 1) throw new Error('Usuario objetivo no encontrado');
    if (actors.length !== 1) throw new Error('Director General activo no encontrado');
    const before = targets[0];
    await conn.query(
      'UPDATE vivero_usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?',
      [before.id]
    );
    await conn.query(
      `INSERT INTO vivero_auditoria
       (actor_usuario_id, accion, entidad, entidad_id, motivo, valores_anteriores, valores_nuevos)
       VALUES (?, 'USUARIO_DESBLOQUEADO', 'usuario', ?,
       'Desbloqueo solicitado desde Administración de usuarios', ?, ?)`,
      [
        actors[0].id,
        String(before.id),
        JSON.stringify({
          intentos_fallidos: before.intentos_fallidos,
          bloqueado_hasta: before.bloqueado_hasta,
        }),
        JSON.stringify({ intentos_fallidos: 0, bloqueado_hasta: null }),
      ]
    );
    await conn.commit();
    console.log(JSON.stringify({ ok: true, user: identifier, unlocked: true, secrets_exposed: false }));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
