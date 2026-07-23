'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { canAdminister, isValidRole } = require('../lib/roles');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!canAdminister(req.session?.usuario?.rol)) return res.status(403).json({ error: 'Sin permisos' });
  next();
}

function validReason(value) {
  return typeof value === 'string' && value.trim().length >= 5 && value.trim().length <= 500;
}

function mayManage(actor, targetRole, requestedRole = targetRole) {
  if (actor.rol === 'director_general') return true;
  return targetRole === 'usuario' && requestedRole === 'usuario';
}

async function audit(conn, actor, action, targetId, reason, before, after) {
  await conn.query(
    `INSERT INTO vivero_auditoria
     (actor_usuario_id, accion, entidad, entidad_id, motivo, valores_anteriores, valores_nuevos)
     VALUES (?, ?, 'usuario', ?, ?, ?, ?)`,
    [actor.id, action, String(targetId), reason, JSON.stringify(before || null), JSON.stringify(after || null)]
  );
}

router.use(requireAdmin);

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, email, nombre, rol, activo, debe_cambiar_clave,
              intentos_fallidos, bloqueado_hasta, ultimo_acceso, creado_en
       FROM vivero_usuarios ORDER BY activo DESC, nombre ASC`
    );
    res.json(rows);
  } catch (error) {
    console.error('[usuarios/get]', error.message);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

router.post('/', async (req, res) => {
  const actor = req.session.usuario;
  const email = String(req.body.email || '').trim().toLowerCase();
  const nombre = String(req.body.nombre || '').trim();
  const rol = String(req.body.rol || 'usuario');
  const password = String(req.body.password_temporal || '');
  const motivo = String(req.body.motivo || '').trim();
  if (!email || !nombre || !isValidRole(rol) || password.length < 12 || !validReason(motivo)) {
    return res.status(400).json({ error: 'Datos inválidos; la clave temporal requiere 12 caracteres y el motivo al menos 5' });
  }
  if (!mayManage(actor, 'usuario', rol)) return res.status(403).json({ error: 'No podés asignar ese rol' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const hash = await bcrypt.hash(password, 12);
    const [result] = await conn.query(
      `INSERT INTO vivero_usuarios (email, password_hash, nombre, rol, activo, debe_cambiar_clave)
       VALUES (?, ?, ?, ?, 1, 1)`,
      [email, hash, nombre, rol]
    );
    await audit(conn, actor, 'USUARIO_CREADO', result.insertId, motivo, null, { email, nombre, rol, activo: true });
    await conn.commit();
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (error) {
    await conn.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El correo ya está registrado' });
    console.error('[usuarios/post]', error.message);
    res.status(500).json({ error: 'Error al crear usuario' });
  } finally {
    conn.release();
  }
});

router.patch('/:id', async (req, res) => {
  const actor = req.session.usuario;
  const id = Number(req.params.id);
  const motivo = String(req.body.motivo || '').trim();
  if (!Number.isInteger(id) || id <= 0 || !validReason(motivo)) return res.status(400).json({ error: 'ID o motivo inválido' });
  if (id === actor.id && (req.body.rol !== undefined || req.body.activo === false || req.body.activo === 0)) {
    return res.status(403).json({ error: 'No podés modificar tu propio rol ni desactivarte' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT id, email, nombre, rol, activo FROM vivero_usuarios WHERE id = ? LIMIT 1 FOR UPDATE',
      [id]
    );
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: 'Usuario no encontrado' }); }
    const before = rows[0];
    const requestedRole = req.body.rol === undefined ? before.rol : String(req.body.rol);
    if (!isValidRole(requestedRole) || !mayManage(actor, before.rol, requestedRole)) {
      await conn.rollback(); return res.status(403).json({ error: 'No podés administrar ese usuario o rol' });
    }
    const after = {
      nombre: req.body.nombre === undefined ? before.nombre : String(req.body.nombre).trim(),
      rol: requestedRole,
      activo: req.body.activo === undefined ? !!before.activo : !!req.body.activo,
    };
    if (!after.nombre) { await conn.rollback(); return res.status(400).json({ error: 'Nombre inválido' }); }
    await conn.query('UPDATE vivero_usuarios SET nombre = ?, rol = ?, activo = ? WHERE id = ?', [after.nombre, after.rol, after.activo ? 1 : 0, id]);
    await audit(conn, actor, 'USUARIO_ACTUALIZADO', id, motivo, before, after);
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error('[usuarios/patch]', error.message);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  } finally {
    conn.release();
  }
});

router.post('/:id/clave-temporal', async (req, res) => {
  const actor = req.session.usuario;
  const id = Number(req.params.id);
  const password = String(req.body.password_temporal || '');
  const motivo = String(req.body.motivo || '').trim();
  if (!Number.isInteger(id) || password.length < 12 || !validReason(motivo)) return res.status(400).json({ error: 'Datos inválidos' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id, rol FROM vivero_usuarios WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: 'Usuario no encontrado' }); }
    if (!mayManage(actor, rows[0].rol)) { await conn.rollback(); return res.status(403).json({ error: 'No podés administrar ese usuario' }); }
    const hash = await bcrypt.hash(password, 12);
    await conn.query(
      `UPDATE vivero_usuarios SET password_hash = ?, debe_cambiar_clave = 1,
       intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?`,
      [hash, id]
    );
    await audit(conn, actor, 'CLAVE_TEMPORAL_ASIGNADA', id, motivo, null, { debe_cambiar_clave: true });
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error('[usuarios/clave-temporal]', error.message);
    res.status(500).json({ error: 'Error al asignar clave temporal' });
  } finally {
    conn.release();
  }
});

router.post('/:id/desbloquear', async (req, res) => {
  const actor = req.session.usuario;
  const id = Number(req.params.id);
  const motivo = String(req.body.motivo || '').trim();
  if (!Number.isInteger(id) || !validReason(motivo)) return res.status(400).json({ error: 'Datos inválidos' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id, rol, intentos_fallidos, bloqueado_hasta FROM vivero_usuarios WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: 'Usuario no encontrado' }); }
    if (!mayManage(actor, rows[0].rol)) { await conn.rollback(); return res.status(403).json({ error: 'No podés administrar ese usuario' }); }
    await conn.query('UPDATE vivero_usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?', [id]);
    await audit(conn, actor, 'USUARIO_DESBLOQUEADO', id, motivo, rows[0], { intentos_fallidos: 0, bloqueado_hasta: null });
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error('[usuarios/desbloquear]', error.message);
    res.status(500).json({ error: 'Error al desbloquear usuario' });
  } finally {
    conn.release();
  }
});

router.delete('/:id', (req, res) => {
  res.status(405).json({ error: 'Los usuarios no se eliminan; se desactivan', code: 'USER_DELETE_FORBIDDEN' });
});

module.exports = router;
