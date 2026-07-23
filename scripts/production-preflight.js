'use strict';
const fs = require('node:fs');
const path = require('node:path');
function fail(message) { throw new Error(`Preflight productivo: ${message}`); }
function exactNumber(name, expected) { const value=Number(process.env[name]); if(!Number.isFinite(value)||value!==expected) fail(`${name} debe ser ${expected}`); }
if(process.env.NODE_ENV!=='production') fail('NODE_ENV debe ser production');
if(process.env.DB_NAME!=='vivero_lemu_production') fail('DB_NAME debe ser vivero_lemu_production');
if(!process.env.DB_HOST||!process.env.DB_USER||process.env.DB_USER.toLowerCase()==='root'||!process.env.DB_PASSWORD) fail('la cuenta MySQL debe ser exclusiva y no root');
if(String(process.env.SESSION_SECRET||'').length<32) fail('SESSION_SECRET debe tener al menos 32 caracteres');
if(!/^https:\/\/[^/]+$/.test(String(process.env.ALLOWED_ORIGIN||''))) fail('ALLOWED_ORIGIN debe ser un origen HTTPS exacto');
if(path.resolve(process.env.UPLOAD_DIR||'')!==path.resolve('/app/uploads')) fail('UPLOAD_DIR debe ser /app/uploads');
if(process.env.VIVERO_SITE_CODE!=='LEMU_EL_MAITEN') fail('VIVERO_SITE_CODE incorrecto');
exactNumber('VIVERO_LATITUDE',-42.061998); exactNumber('VIVERO_LONGITUDE',-71.193158); exactNumber('VIVERO_RADIUS_METERS',200);
if(process.env.N8N_ENABLED!=='0') fail('n8n debe permanecer deshabilitado en la primera publicación');
for(const file of ['Dockerfile','railway.json','vivero_schema.sql']) if(!fs.existsSync(path.join(__dirname,'..',file))) fail(`falta ${file}`);
console.log(JSON.stringify({ok:true,mode:'production-preflight',database:'vivero_lemu_production',https:true,volume:'/app/uploads',n8n_enabled:false,secrets_exposed:false}));
