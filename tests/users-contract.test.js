'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'routes', 'usuarios.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public', 'usuarios.html'), 'utf8');

test('la administración no expone hashes ni permite borrar usuarios', () => {
  assert.doesNotMatch(route, /SELECT\s+\*\s+FROM\s+vivero_usuarios/i);
  assert.match(route, /USER_DELETE_FORBIDDEN/);
  assert.doesNotMatch(page, /password_hash/);
});

test('solo el director puede gestionar administradores técnicos', () => {
  assert.match(route, /actor\.rol === 'director_general'/);
  assert.match(route, /targetRole === 'usuario' && requestedRole === 'usuario'/);
});

test('altas, cambios, claves y desbloqueos se auditan', () => {
  for (const action of ['USUARIO_CREADO','USUARIO_ACTUALIZADO','CLAVE_TEMPORAL_ASIGNADA','USUARIO_DESBLOQUEADO']) {
    assert.match(route, new RegExp(action));
  }
});

test('la actividad consolidada es exclusiva del Director General', () => {
  assert.match(route, /router\.get\('\/actividad', requireDirector/);
  assert.match(route, /req\.session\?\.usuario\?\.rol !== 'director_general'/);
  for (const source of ['vivero_auditoria', 'vivero_asistencia', 'vivero_novedades', 'vivero_archivos']) {
    assert.match(route, new RegExp(source));
  }
  const activityPage = fs.readFileSync(path.join(root, 'public', 'actividad.html'), 'utf8');
  assert.match(activityPage, /\/api\/usuarios\/actividad/);
  assert.match(activityPage, /currentUser\.rol!=='director_general'/);
});
