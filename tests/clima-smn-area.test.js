const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAlerts, tokenFromAreaPage } = require('../routes/clima')._test;

test('extrae el token territorial sin exponerlo en la respuesta', () => {
  assert.equal(tokenFromAreaPage("localStorage.setItem('token', 'abc.def.ghi');"), 'abc.def.ghi');
  assert.throws(() => tokenFromAreaPage('<html></html>'));
});

test('normaliza alerta territorial amarilla por nieve del área 797', () => {
  const payload = {
    warnings: [{ date: '2026-07-23', events: [{ id: 42, levels: { early_morning: 3, morning: 3, afternoon: 3, night: 1 } }] }],
    reports: [{ event_id: 42, levels: [{ level: 3, description: 'Nevadas persistentes.', instruction: 'Evitá actividades al aire libre.' }] }],
  };
  const result = normalizeAlerts(payload, { name: 'CORDILLERA CHUBUT NORTE' });
  assert.equal(result.length, 1);
  assert.equal(result[0].titulo, 'Alerta amarillo por nevada');
  assert.deepEqual(result[0].periodos, ['madrugada', 'mañana', 'tarde']);
  assert.equal(result[0].zona, 'CORDILLERA CHUBUT NORTE');
});

test('nivel verde no se presenta como alerta activa', () => {
  const payload = { warnings: [{ date: '2026-07-22', events: [{ id: 42, levels: { night: 1 } }] }], reports: [] };
  assert.deepEqual(normalizeAlerts(payload, { name: 'Área' }), []);
});

test('el inicio muestra un popup por alerta y evita repetirlo durante la sesión', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="climaPopupOverlay"/);
  assert.match(html, /comprobarAlertaClimaticaInicio\(\)/);
  assert.match(html, /sessionStorage\.getItem\('lemu-alerta-clima-vista'\)/);
  assert.match(html, /alertas_disponibles === false/);
  assert.match(html, /abrirClimaDesdePopup/);
});
