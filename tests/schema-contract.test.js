'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'routes', 'vivero.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'vivero_schema.sql'), 'utf8');
const executableSchema = schema.replace(/^\s*--.*$/gm, '');

function names(pattern, source) {
  return [...source.matchAll(pattern)].map(match => match[1].toLowerCase());
}

test('todo objeto SQL consumido por las rutas está declarado', () => {
  const used = new Set(names(/(?:FROM|JOIN|INTO|UPDATE)\s+`?(vivero_[a-z0-9_]+)/gi, route));
  const declared = new Set(names(/CREATE\s+(?:TABLE\s+IF\s+NOT\s+EXISTS|VIEW)\s+`?(vivero_[a-z0-9_]+)/gi, schema));
  assert.deepEqual([...used].filter(name => !declared.has(name)), []);
});

test('el esquema no crea ni selecciona bases y no menciona la base oficial', () => {
  assert.doesNotMatch(executableSchema, /CREATE\s+DATABASE|\bUSE\s+/i);
  assert.doesNotMatch(executableSchema, /bosques_chubut/i);
});

test('los roles son exactamente director, administrador técnico y usuario', () => {
  assert.match(schema, /ENUM\('director_general','administrador_tecnico','usuario'\)/);
});
