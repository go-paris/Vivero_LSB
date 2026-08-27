'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

test('v2 declares configurable schedules and justified absences',()=>{
  const schema=read('vivero_schema.sql');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS vivero_horarios/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS vivero_ausencias/);
  assert.doesNotMatch(schema,/Mario|Pablo|Oscar|martes.*jueves/i);
});
test('management endpoints require admin and validate dates',()=>{
  const route=read('routes/gestion.js');
  assert.match(route,/canAdminister/);
  assert.match(route,/isoDate/);
  assert.match(route,/HORARIO_ACTUALIZADO/);
  assert.match(route,/AUSENCIA_REGISTRADA/);
});
test('monthly report is based on operational tables and not invented data',()=>{
  const route=read('routes/gestion.js');
  for(const table of ['vivero_asistencia','vivero_tareas','vivero_lotes','vivero_sanidad','vivero_despachos']) assert.match(route,new RegExp(table));
  assert.doesNotMatch(route,/Math\.random|dato simulado|ficticio/i);
});
test('management page uses authenticated APIs and escapes output',()=>{
  const page=read('public/gestion.html');
  assert.match(page,/\/api\/auth\/me/);
  assert.match(page,/\/api\/gestion\/asistencia/);
  assert.match(page,/function esc/);
  assert.match(page,/informe-mensual\.csv/);
});
test('attendance UI prevents duplicate requests and explains geolocation errors',()=>{
  const page=read('public/index.html');
  assert.match(page,/geoRequestInProgress/);
  assert.match(page,/maximumAge:\s*30000/);
  assert.match(page,/watchPosition/);
  assert.match(page,/clearWatch/);
  assert.match(page,/Necesitamos permiso de ubicación/);
});
test('schedule form has a compact typography hierarchy aligned with the dashboard',()=>{
  const page=read('public/gestion.html');
  assert.match(page,/#scheduleForm\{font-size:12px\}/);
  assert.match(page,/#scheduleForm>label/);
  assert.match(page,/#scheduleForm \.days label\{font-size:11px/);
  assert.match(page,/font-family:'Poppins'/);
  assert.match(page,/\.hero #fecha\{height:40px/);
  assert.match(page,/\.hero #actualizar\{height:40px/);
  assert.match(page,/#month,#loadReport,#downloadReport\{height:38px/);
  assert.match(page,/#absenceForm\{font-size:12px/);
  assert.match(page,/\.top a\{display:inline-flex/);
});
test('absence categories include study leave consistently',()=>{
  assert.match(read('vivero_schema.sql'),/dia_estudio/);
  assert.match(read('routes/gestion.js'),/dia_estudio/);
  assert.match(read('public/gestion.html'),/>Día de estudio</);
});
