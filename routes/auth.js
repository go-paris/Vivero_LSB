/**
 * routes/auth.js — Vivero Lemú
 * Login/logout/cambiar-password contra tabla vivero_usuarios (bcrypt)
 */
const express = require('express');
const bcrypt  = require('bcrypt');
const crypto  = require('crypto');
const db      = require('../db');
const { isValidRole } = require('../lib/roles');

const router = express.Router();
const dummyHash = bcrypt.hashSync('vivero-lemu-dummy-password', 12);
const maxFailedAttempts = Number(process.env.AUTH_MAX_FAILED_ATTEMPTS || 5);
const lockMinutes = Number(process.env.AUTH_LOCK_MINUTES || 15);

// ── Middleware: verificar sesión ──────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.usuario) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const identifier = String(req.body.identifier || req.body.email || '').trim().toLowerCase();
  const { password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }
  try {
    const [rows] = await db.query(
      'SELECT * FROM vivero_usuarios WHERE email = ? LIMIT 1',
      [identifier]
    );
    const usuario = rows[0] || null;
    const ok = await bcrypt.compare(password, usuario?.password_hash || dummyHash);
    const blocked = usuario?.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date();
    if (!usuario || !usuario.activo || !isValidRole(usuario.rol) || blocked || !ok) {
      if (usuario && !blocked && usuario.activo) {
        await db.query(
          `UPDATE vivero_usuarios
           SET intentos_fallidos = intentos_fallidos + 1,
               bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= ?
                 THEN DATE_ADD(NOW(), INTERVAL ? MINUTE) ELSE bloqueado_hasta END
           WHERE id = ?`,
          [maxFailedAttempts, lockMinutes, usuario.id]
        );
      }
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    await db.query(
      'UPDATE vivero_usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = NOW() WHERE id = ?',
      [usuario.id]
    );

    // Guardar sesión
    req.session.usuario = {
      id:                usuario.id,
      email:             usuario.email,
      nombre:            usuario.nombre,
      rol:               usuario.rol,
      debe_cambiar_clave: !!usuario.debe_cambiar_clave,
      bio:               usuario.bio || null,
      foto_url:          usuario.foto_url || null,
    };
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');

    return res.json({
      ok:                true,
      nombre:            usuario.nombre,
      rol:               usuario.rol,
      debe_cambiar_clave: !!usuario.debe_cambiar_clave,
    });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    // Refrescar datos desde DB por si cambiaron (foto, bio, etc.)
    const [rows] = await db.query(
      'SELECT id, email, nombre, rol, activo, debe_cambiar_clave, bio, foto_url FROM vivero_usuarios WHERE id = ? LIMIT 1',
      [req.session.usuario.id]
    );
    if (!rows.length || !rows[0].activo || !isValidRole(rows[0].rol)) {
      return req.session.destroy(() => res.status(401).json({ error: 'Usuario no disponible' }));
    }
    const u = rows[0];
    // Actualizar sesión con datos frescos
    req.session.usuario = {
      id:                u.id,
      email:             u.email,
      nombre:            u.nombre,
      rol:               u.rol,
      debe_cambiar_clave: !!u.debe_cambiar_clave,
      bio:               u.bio || null,
      foto_url:          u.foto_url || null,
    };
    res.json({ ...req.session.usuario, csrf_token: req.session.csrfToken });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/auth/cambiar-password
router.post('/cambiar-password', requireAuth, async (req, res) => {
  const { password_actual, password_nuevo } = req.body;
  if (!password_actual || !password_nuevo) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  if (password_nuevo.length < 12) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 12 caracteres' });
  }
  try {
    const [rows] = await db.query(
      'SELECT * FROM vivero_usuarios WHERE id = ? LIMIT 1',
      [req.session.usuario.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });

    const usuario = rows[0];
    const ok = await bcrypt.compare(password_actual, usuario.password_hash);
    if (!ok) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });

    const nuevoHash = await bcrypt.hash(password_nuevo, 10);
    await db.query(
      'UPDATE vivero_usuarios SET password_hash = ?, debe_cambiar_clave = 0 WHERE id = ?',
      [nuevoHash, usuario.id]
    );

    // Actualizar sesión
    req.session.usuario.debe_cambiar_clave = false;

    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth/cambiar-password]', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
