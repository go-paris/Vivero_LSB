'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('asistencia almacena UTC y entrega un instante ISO inequívoco', () => {
  const route = read('routes/vivero.js');
  assert.match(route, /UTC_TIMESTAMP\(\)/);
  assert.match(route, /DATE_SUB\(UTC_TIMESTAMP\(\), INTERVAL 3 HOUR\)/);
  assert.match(route, /DATE_FORMAT\(timestamp_registro, '%Y-%m-%dT%H:%i:%sZ'\) AS created_at/);
  assert.doesNotMatch(route, /timestamp_registro AS created_at/);
});

test('GPS reúne varias lecturas y conserva la más precisa', () => {
  const html = read('public/index.html');
  assert.match(html, /navigator\.geolocation\.watchPosition/);
  assert.match(html, /lectura\.precision_m < geoCoords\.precision_m/);
  assert.match(html, /setTimeout\(\(\) => finalizarCaptura\(Boolean\(geoCoords\)\), 45000\)/);
  assert.match(html, /navigator\.geolocation\.clearWatch/);
  assert.match(html, /enableHighAccuracy:\s*true/);
});

test('Gestión usa horarios locales calculados por el servidor', () => {
  assert.match(read('routes/gestion.js'), /primera_entrada_local/);
  const page = read('public/gestion.html');
  assert.match(page, /p\.primera_entrada_local/);
  assert.doesNotMatch(page, /new Date\(p\.primera_entrada\)/);
});
