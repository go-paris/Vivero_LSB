/**
 * Vivero Lemú — Server
 * App de gestión diaria para el equipo del Vivero de El Maitén
 * Puerto: 3001 (independiente del SUIF que corre en 3000)
 * Base de datos: independiente del SUIF
 */

require('dotenv').config();

const express  = require('express');
const session  = require('express-session');
const helmet   = require('helmet');
const { rateLimit } = require('express-rate-limit');
const MySQLStore = require('express-mysql-session')(session);
const crypto   = require('crypto');
const multer   = require('multer');
const path     = require('path');
const db       = require('./db');
const { readGeofenceConfig } = require('./lib/geofence');
const { ensureUploadDir } = require('./lib/upload-storage');
const uploadDir = ensureUploadDir();

const app = express();
const PORT = process.env.PORT || process.env.VIVERO_PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = String(process.env.SESSION_SECRET || '');
const allowedOrigin = String(process.env.ALLOWED_ORIGIN || '').replace(/\/$/, '');
if (sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET es obligatorio y debe tener al menos 32 caracteres');
}
if (!allowedOrigin) throw new Error('ALLOWED_ORIGIN es obligatorio');
readGeofenceConfig();

if (isProduction) app.set('trust proxy', 1);

// ── Middleware ─────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
      // Compatibilidad transitoria con los controles onclick del frontend original.
      // Antes de producción se migrarán a listeners en archivos JS propios.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https://ws.smn.gob.ar'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (path.extname(filePath).toLowerCase() === '.html') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 8 * 60 * 60 * 1000,
  schema: { tableName: 'vivero_sessions' },
}, db);

// Sesiones — mismo SECRET que el SUIF para coherencia
app.use(session({
  name:              'vivero.sid',
  secret:            sessionSecret,
  resave:            false,
  saveUninitialized: false,
  store:             sessionStore,
  cookie: {
    secure:   isProduction,
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   8 * 60 * 60 * 1000 // 8 horas — jornada laboral
  }
}));

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = String(req.get('origin') || '').replace(/\/$/, '');
  if (!safeEqual(origin, allowedOrigin)) {
    return res.status(403).json({ error: 'Origen no autorizado', code: 'ORIGIN_FORBIDDEN' });
  }
  if (req.path === '/api/auth/login') return next();
  if (!req.session?.usuario || !safeEqual(req.get('X-CSRF-Token'), req.session.csrfToken)) {
    return res.status(403).json({ error: 'Token CSRF inválido', code: 'CSRF_INVALID' });
  }
  next();
}

app.use(csrfProtection);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intentá nuevamente más tarde.', code: 'AUTH_RATE_LIMITED' },
});
app.use('/api/auth/login', loginLimiter);

// ── Auth middleware ────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  if (!req.session?.usuario) return res.status(401).json({ error: 'No autenticado' });
  try {
    const [rows] = await db.query(
      'SELECT id, email, nombre, rol, activo, debe_cambiar_clave FROM vivero_usuarios WHERE id = ? LIMIT 1',
      [req.session.usuario.id]
    );
    const user = rows[0];
    if (!user?.activo || !['director_general', 'administrador_tecnico', 'usuario'].includes(user.rol)) {
      return req.session.destroy(() => res.status(401).json({ error: 'Acceso deshabilitado' }));
    }
    req.session.usuario = { ...req.session.usuario, email: user.email, nombre: user.nombre, rol: user.rol, debe_cambiar_clave: !!user.debe_cambiar_clave };
    next();
  } catch (error) {
    console.error('[auth/middleware]', error.message);
    res.status(503).json({ error: 'No se pudo verificar la sesión' });
  }
}

// Los adjuntos nunca se sirven públicamente sin sesión.
app.use('/uploads', requireAuth, express.static(uploadDir, {
  dotfiles: 'deny',
  index: false,
  fallthrough: false,
}));

app.get('/health', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT sistema, schema_version FROM vivero_metadata WHERE id = 1 LIMIT 1');
    if (rows[0]?.sistema !== 'VIVERO_LEMU') throw new Error('Marca de base inválida');
    res.json({ ok: true, service: 'vivero-lemu', schema_version: rows[0].schema_version });
  } catch (error) {
    res.status(503).json({ ok: false, service: 'vivero-lemu' });
  }
});

// ── Rutas ──────────────────────────────────────────────────────────
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/usuarios', requireAuth, require('./routes/usuarios'));
app.use('/api/vivero', requireAuth, require('./routes/vivero'));
app.use('/api/gestion', requireAuth, require('./routes/gestion'));
app.use('/api/cronograma', requireAuth, require('./routes/cronograma'));
app.use('/api/clima',  requireAuth, require('./routes/clima'));

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Archivo rechazado: tipo, cantidad o tamaño no permitido' });
  }
  console.error('[http/unhandled]', error?.message || 'Error desconocido');
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Catch-all → index.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Iniciar ────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌱 Vivero Lemú escuchando en el puerto ${PORT}`);
});

function shutdown(signal) {
  console.log(`Cierre solicitado: ${signal}`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server };
