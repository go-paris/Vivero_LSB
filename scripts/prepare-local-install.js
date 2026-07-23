'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const targets = ['.env', '.initial-admin-credentials.txt', 'local-provision.sql', 'local-lockdown.sql'];
for (const name of targets) {
  if (fs.existsSync(path.join(root, name))) throw new Error(`Instalación abortada: ${name} ya existe`);
}

const database = 'vivero_lemu_validation';
const dbUser = 'vivero_app';
const dbPassword = crypto.randomBytes(32).toString('base64url');
const sessionSecret = crypto.randomBytes(48).toString('base64url');
const initialPassword = crypto.randomBytes(18).toString('base64url') + '!aA7';
const adminEmail = 'directorproyectos@bosques.chubut.gov.ar';
const adminName = 'Director General de Programas y Proyectos';

function mysqlLiteral(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
}

const env = `NODE_ENV=validation
VIVERO_PORT=3300
DB_HOST=localhost
DB_PORT=3306
DB_USER=${dbUser}
DB_PASSWORD=${dbPassword}
DB_NAME=${database}
SESSION_SECRET=${sessionSecret}
ALLOWED_ORIGIN=http://127.0.0.1:3300
AUTH_MAX_FAILED_ATTEMPTS=5
AUTH_LOCK_MINUTES=15
UPLOAD_DIR=./uploads
VIVERO_SITE_CODE=LEMU_EL_MAITEN
VIVERO_LATITUDE=-42.061998
VIVERO_LONGITUDE=-71.193158
VIVERO_RADIUS_METERS=200
VIVERO_MAX_ACCURACY_METERS=100
VIVERO_GEOFENCE_VERSION=LEMU-001
N8N_ENABLED=0
N8N_WEBHOOK_URL=
N8N_WEBHOOK_SECRET=
SCHEMA_APPLY_CONFIRM=${database}
INITIAL_ADMIN_EMAIL=${adminEmail}
INITIAL_ADMIN_NAME=${adminName}
INITIAL_ADMIN_PASSWORD=${initialPassword}
`;

const provision = `-- Ejecutar una sola vez en MySQL Workbench con una cuenta administradora local.
-- Alcance exclusivo: Vivero Lemú. No modifica bosques_chubut.
CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER ${mysqlLiteral(dbUser)}@'localhost' IDENTIFIED BY ${mysqlLiteral(dbPassword)};
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, CREATE VIEW, SHOW VIEW, REFERENCES, INDEX
  ON \`${database}\`.* TO ${mysqlLiteral(dbUser)}@'localhost';
SHOW GRANTS FOR ${mysqlLiteral(dbUser)}@'localhost';
`;

const lockdown = `-- Ejecutar después de aplicar y verificar el esquema.
REVOKE CREATE, CREATE VIEW, SHOW VIEW, REFERENCES, INDEX
  ON \`${database}\`.* FROM ${mysqlLiteral(dbUser)}@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON \`${database}\`.* TO ${mysqlLiteral(dbUser)}@'localhost';
SHOW GRANTS FOR ${mysqlLiteral(dbUser)}@'localhost';
`;

const credentials = `Vivero Lemú — credencial inicial local
Usuario: ${adminEmail}
Clave temporal: ${initialPassword}
Acción obligatoria: cambiar la clave al primer ingreso y eliminar este archivo.
`;

fs.writeFileSync(path.join(root, '.env'), env, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
fs.writeFileSync(path.join(root, 'local-provision.sql'), provision, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
fs.writeFileSync(path.join(root, 'local-lockdown.sql'), lockdown, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
fs.writeFileSync(path.join(root, '.initial-admin-credentials.txt'), credentials, { encoding: 'utf8', mode: 0o600, flag: 'wx' });

console.log(JSON.stringify({ ok: true, files_created: targets.length, database, admin_email: adminEmail, secrets_exposed: false }));
