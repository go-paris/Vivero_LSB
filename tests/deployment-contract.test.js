'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Railway usa contenedor, healthcheck y volumen configurable', () => {
  const railway = JSON.parse(read('railway.json'));
  assert.equal(railway.build.builder, 'DOCKERFILE');
  assert.equal(railway.deploy.healthcheckPath, '/health');
  assert.match(read('Dockerfile'), /ENTRYPOINT \["\/app\/docker-entrypoint\.sh"\]/);
  assert.match(read('docker-entrypoint.sh'), /exec su-exec node/);
  assert.match(read('.env.example'), /UPLOAD_DIR=/);
});

test('los scripts de esquema rechazan bases ajenas y requieren confirmación', () => {
  const apply = read('scripts/schema-apply.js');
  assert.match(apply, /vivero_lemu_/);
  assert.match(apply, /SCHEMA_APPLY_CONFIRM/);
  assert.match(apply, /bosques_chubut/);
});

test('el esquema v3 declara 21 tablas y 4 vistas', () => {
  const schema = read('vivero_schema.sql');
  assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS/gi) || []).length, 21);
  assert.equal((schema.match(/CREATE VIEW/gi) || []).length, 4);
});

test('la geocerca validada vive en configuración y no en el HTML', () => {
  const env = read('.env.example');
  assert.match(env, /VIVERO_LATITUDE=-42\.061998/);
  assert.match(env, /VIVERO_LONGITUDE=-71\.193158/);
  assert.match(env, /VIVERO_RADIUS_METERS=200/);
  assert.doesNotMatch(read('public/index.html'), /-42\.061998|-71\.193158/);
});
