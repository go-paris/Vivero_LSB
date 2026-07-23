'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('inicio avisa actividades por vencer y enlaza con su ficha en Actividades', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="actividadPopup"/);
  assert.match(html, /comprobarActividadesPorVencer\(\)/);
  assert.match(html, /nivelActividadPorDias/);
  assert.match(html, /lemu-actividad-vencimiento-vista/);
  assert.match(html, /cambiarTab\('instrucciones'\)/);
  assert.match(html, /id="actividad-\$\{i\.id\}"/);
});

test('las prioridades distinguen vencida, hoy, mañana y próxima', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /Nivel crítico · actividad vencida/);
  assert.match(html, /Nivel crítico · vence hoy/);
  assert.match(html, /Prioridad alta · vence mañana/);
  assert.match(html, /Prioridad media · vence en/);
});

test('cerrar sesión restablece los avisos para el próximo ingreso', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const logout = html.slice(html.indexOf("document.getElementById('btnLogout')"));
  assert.match(logout, /removeItem\('lemu-alerta-clima-vista'\)/);
  assert.match(logout, /removeItem\('lemu-actividad-vencimiento-vista'\)/);
  assert.ok(logout.indexOf('removeItem') < logout.indexOf("location.href = '/login.html'"));
});
