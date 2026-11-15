'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'routes', 'vivero.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

test('Dirección y Administración Técnica pueden editar y eliminar actividades', () => {
  assert.match(route, /router\.patch\('\/instrucciones\/:id', requireAuth, requireAdmin/);
  assert.match(route, /router\.delete\('\/instrucciones\/:id', requireAuth, requireAdmin/);
  assert.match(index, /\['director_general','administrador_tecnico'\]\.includes\(usuario\.rol\)/);
  assert.match(index, /editarInstruccion\(\$\{i\.id\}\)/);
  assert.match(index, /eliminarInstruccion\(\$\{i\.id\}\)/);
});

test('Actividad, Usuarios y Gestión comparten Poppins y Hind', () => {
  for (const file of ['actividad.html', 'usuarios.html', 'gestion.html']) {
    const html = fs.readFileSync(path.join(root, 'public', file), 'utf8');
    assert.match(html, /family=Poppins|family=Hind/);
    assert.match(html, /font-family:'Poppins'/);
    assert.match(html, /font-family:'Hind'/);
  }
});
