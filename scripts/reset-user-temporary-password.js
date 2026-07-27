'use strict';

require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../db');

async function main() {
  const identifier = String(process.argv[2] || '').trim().toLowerCase();
  const actorIdentifier = String(process.env.RESET_ACTOR_IDENTIFIER || '').trim().toLowerCase();
  const password = String(process.env.RESET_TEMPORARY_PASSWORD || '');
  const reason = String(process.env.RESET_REASON || '').trim();
  if (!identifier || !actorIdentifier || password.length < 12 || reason.length < 5) {
    throw new Error('Faltan usuario, actor, clave temporal de 12 caracteres o motivo');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [targets] = await conn.query(
      'SELECT id, email, rol, activo, debe_cambiar_clave, intentos_fallidos, bloqueado_hasta FROM vivero_usuarios WHERE email = ? LIMIT 1 FOR UPDATE',
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
    const hash = await bcrypt.hash(password, 12);
    await conn.query(
      `UPDATE vivero_usuarios
       SET password_hash = ?, debe_cambiar_clave = 1,
           intentos_fallidos = 0, bloqueado_hasta = NULL
       WHERE id = ?`,
      [hash, before.id]
    );
    await conn.query(
      `INSERT INTO vivero_auditoria
       (actor_usuario_id, accion, entidad, entidad_id, motivo, valores_anteriores, valores_nuevos)
       VALUES (?, 'CLAVE_TEMPORAL_ASIGNADA', 'usuario', ?, ?, ?, ?)`,
      [
        actors[0].id,
        String(before.id),
        reason,
        JSON.stringify({
          debe_cambiar_clave: !!before.debe_cambiar_clave,
          intentos_fallidos: before.intentos_fallidos,
          bloqueado_hasta: before.bloqueado_hasta,
        }),
        JSON.stringify({
          debe_cambiar_clave: true,
          intentos_fallidos: 0,
          bloqueado_hasta: null,
        }),
      ]
    );
    await conn.commit();
    console.log(JSON.stringify({
      ok: true,
      user: identifier,
      forced_change: true,
      unlocked: true,
      secrets_exposed: false,
    }));
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
