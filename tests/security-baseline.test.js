'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('no conecta por defecto con bosques_chubut ni permite root', () => {
  const db = read('db.js');
  assert.match(db, /vivero_lemu_/);
  assert.match(db, /root no está permitido/);
  assert.doesNotMatch(db, /database:\s*process\.env\.DB_NAME\s*\|\|/);
});

test('el cliente no decide la geocerca ni contiene sus coordenadas', () => {
  const html = read('public/index.html');
  assert.doesNotMatch(html, /VIVERO_(LAT|LNG|RADIO)/);
  assert.doesNotMatch(html, /geo_valida\s*:/);
  assert.doesNotMatch(html, /distancia_m\s*:/);
});

test('no quedan credenciales iniciales conocidas en el código ejecutable', () => {
  const sources = [
    read('routes/Seed-admin-vivero.js'),
    read('public/cambiar-clave.html'),
    read('server.js'),
  ].join('\n');
  assert.doesNotMatch(sources, /123456/);
  assert.doesNotMatch(sources, /vivero_secret/);
  assert.doesNotMatch(sources, /directorproyectos@/);
});

test('los archivos subidos requieren autenticación', () => {
const server = read('server.js');
  assert.match(server, /app\.use\('\/uploads', requireAuth, express\.static/);
});

test('las mutaciones exigen origen y token CSRF', () => {
  const server = read('server.js');
  assert.match(server, /function csrfProtection/);
  assert.match(server, /X-CSRF-Token/);
  assert.match(server, /ORIGIN_FORBIDDEN/);
  assert.match(server, /CSRF_INVALID/);
});

test('los controles heredados del frontend no quedan bloqueados por CSP', () => {
  const server = read('server.js');
  assert.match(server, /scriptSrcAttr:\s*\["'unsafe-inline'"\]/);
  assert.doesNotMatch(server, /script-src-attr\s+'none'/i);
});

test('las sesiones son persistentes y el login está limitado', () => {
  const server = read('server.js');
  assert.match(server, /new MySQLStore/);
  assert.match(server, /store:\s+sessionStore/);
  assert.match(server, /rateLimit/);
});

test('el login evita enumeración y aplica bloqueo persistente', () => {
  const auth = read('routes/auth.js');
  assert.match(auth, /dummyHash/);
  assert.match(auth, /intentos_fallidos = intentos_fallidos \+ 1/);
  assert.match(auth, /bloqueado_hasta/);
  assert.match(auth, /ultimo_acceso = NOW\(\)/);
});

test('los accesos correctos y cierres de sesión quedan auditados sin guardar la IP directa', () => {
  const auth = read('routes/auth.js');
  assert.match(auth, /INICIO_SESION/);
  assert.match(auth, /FIN_SESION/);
  assert.match(auth, /ip_hash/);
  assert.match(auth, /createHash\('sha256'\)/);
});

test('el primer ingreso va directo al cambio obligatorio de clave', () => {
  const login = read('public/login.html');
  assert.match(
    login,
    /location\.replace\(d\.debe_cambiar_clave\s*\?\s*['"]\/cambiar-clave\.html['"]\s*:\s*['"]\/index\.html['"]\)/
  );
  assert.doesNotMatch(login, /location\.href\s*=\s*['"]\/index\.html['"]/);
});

test('el cambio de clave exige doce caracteres en cliente y servidor', () => {
  const page = read('public/cambiar-clave.html');
  const auth = read('routes/auth.js');
  assert.match(page, /minlength="12"/);
  assert.match(page, /passNueva\.length < 12/);
  assert.match(page, /Mínimo 12 caracteres/);
  assert.match(auth, /password_nuevo\.length < 12/);
  assert.match(auth, /al menos 12 caracteres/);
});

test('las asistencias se rectifican con auditoría y nunca se borran', () => {
  const routes = read('routes/vivero.js');
  assert.match(routes, /ASISTENCIA_RECTIFICADA/);
  assert.match(routes, /motivo_anulacion/);
  assert.doesNotMatch(routes, /DELETE FROM vivero_asistencia/);
});

test('los adjuntos usan almacenamiento configurable y tipos acotados', () => {
  const routes = read('routes/vivero.js');
  assert.match(routes, /process\.env\.UPLOAD_DIR/);
  assert.match(routes, /application\/pdf/);
  assert.match(routes, /image\/jpeg/);
  assert.match(routes, /image\/png/);
});

test('una cuenta desactivada pierde acceso aunque conserve una cookie', () => {
  const server = read('server.js');
  const auth = read('routes/auth.js');
  assert.match(server, /SELECT id, email, nombre, rol, activo/);
  assert.match(server, /req\.session\.destroy/);
  assert.match(auth, /!rows\[0\]\.activo/);
});

test('los errores de carga no exponen trazas internas', () => {
  const server = read('server.js');
  assert.match(server, /error instanceof multer\.MulterError/);
  assert.match(server, /Archivo rechazado/);
});
