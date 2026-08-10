'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Semillas es una pestaña principal junto a Plantas', () => {
  const html = read('public/index.html');
  assert.match(html, /cambiarTab\('plantas'\)[\s\S]*cambiarTab\('semillas'\)/);
  assert.match(html, /id="panelSemillas"/);
  assert.match(html, /id="semillaGrid"/);
  for (const field of ['smProcedencia','smPesoHumedo','smPesoSeco','smHumedad','smAlmacenamiento']) {
    assert.match(html, new RegExp(`id="${field}"`));
  }
});

test('la API administra un inventario independiente de semillas', () => {
  const route = read('routes/vivero.js');
  assert.match(route, /router\.get\('\/semillas'/);
  assert.match(route, /router\.post\('\/semillas', requireAuth, requireAdmin/);
  assert.match(route, /peso seco no puede superar el peso húmedo/i);
  assert.match(route, /cantidad_disponible/);
});

test('los lotes vegetales pueden vincular y consumir una partida', () => {
  const html = read('public/index.html');
  const route = read('routes/vivero.js');
  assert.match(html, /id="nlSemillaId"/);
  assert.match(route, /semilla_id/);
  assert.match(route, /cantidad_disponible=cantidad_disponible-\?/);
});

test('el esquema v4 crea el inventario de semillas y la relación con lotes', () => {
  const schema = read('vivero_schema.sql');
  const migration = read('database/migrations/004_semillas.sql');
  for (const sql of [schema, migration]) {
    assert.match(sql, /vivero_semillas/);
    assert.match(sql, /peso_humedo_kg/);
    assert.match(sql, /peso_seco_kg/);
    assert.match(sql, /humedad_pct/);
  }
  assert.match(schema, /semilla_id BIGINT NULL/);
  assert.match(schema, /VALUES \(1, 'VIVERO_LEMU', 4\)/);
});
