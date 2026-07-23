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
