'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('Cronograma usa una jerarquía tipográfica legible y responsive', () => {
  for (const className of [
    'cron-card',
    'cron-card-header',
    'cron-card-title',
    'cron-card-meta',
    'cron-card-state',
    'cron-card-description',
  ]) {
    assert.match(html, new RegExp(`\\.${className}\\{`));
  }
  assert.match(html, /class="cron-card-title"/);
  assert.match(html, /font-family:'Hind'/);
});

test('Actividades muestra y limpia un contador de novedades por usuario', () => {
  assert.match(html, /id="instBadge"/);
  assert.match(html, /lemu-actividades-vistas-\$\{usuario\.id\}/);
  assert.match(html, /actualizarBadgeActividades\(data\)/);
  assert.match(html, /if \(tab === 'instrucciones'\) marcarActividadesVistas\(\)/);
  assert.match(html, /item\.estado !== 'finalizada'/);
});

test('Novedades muestra y limpia un contador personal al abrir la pestaña', () => {
  assert.match(html, /id="novBadge"/);
  assert.match(html, /lemu-novedades-vistas-\$\{usuario\.id\}/);
  assert.match(html, /actualizarBadgeNovedades\(data\)/);
  assert.match(html, /if \(tab === 'novedades'\) marcarNovedadesVistas\(\)/);
  assert.match(html, /panelNovedades'\)\.classList\.contains\('activo'\)/);
});
