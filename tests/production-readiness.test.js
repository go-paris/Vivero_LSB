'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
test('la carga aprobada usa gustavo.paris y secreto temporal no incrustado',()=>{const seed=read('scripts/seed-team.js');assert.match(seed,/gustavo\.paris/);assert.match(seed,/INITIAL_TEAM_PASSWORD/);assert.doesNotMatch(seed,/123456/);assert.match(seed,/debe_cambiar_clave\s*=\s*1/)});
test('preflight exige HTTPS, volumen, base independiente y n8n apagado',()=>{const p=read('scripts/production-preflight.js');for(const v of ['vivero_lemu_production','https:','/app/uploads','LEMU_EL_MAITEN','N8N_ENABLED'])assert.ok(p.includes(v))});
test('provisionamiento separa preparador y aplicación con privilegios acotados',()=>{const sql=read('database/production/provision-users.sql.example');assert.match(sql,/vivero_deployer/);assert.match(sql,/vivero_app/);assert.match(sql,/SELECT, INSERT, UPDATE, DELETE/);assert.doesNotMatch(sql,/GRANT ALL/i)});
