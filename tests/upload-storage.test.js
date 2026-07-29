'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { resolveUploadDir } = require('../lib/upload-storage');

const appRoot = path.join(__dirname, '..');

test('Railway usa siempre la ruta absoluta del volumen', () => {
  assert.equal(
    resolveUploadDir({
      RAILWAY_VOLUME_MOUNT_PATH: '/app/uploads',
      UPLOAD_DIR: 'app/uploads',
    }),
    path.normalize('/app/uploads')
  );
});

test('la configuración histórica app/uploads se normaliza dentro de la aplicación', () => {
  assert.equal(resolveUploadDir({ UPLOAD_DIR: 'app/uploads' }), path.join(appRoot, 'uploads'));
  assert.equal(resolveUploadDir({ UPLOAD_DIR: './uploads' }), path.join(appRoot, 'uploads'));
});

test('el contenedor prepara el volumen antes de bajar privilegios', () => {
  const dockerfile = fs.readFileSync(path.join(appRoot, 'Dockerfile'), 'utf8');
  const entrypoint = fs.readFileSync(path.join(appRoot, 'docker-entrypoint.sh'), 'utf8');
  assert.match(dockerfile, /apk add --no-cache su-exec/);
  assert.match(dockerfile, /ENTRYPOINT \["\/app\/docker-entrypoint\.sh"\]/);
  assert.match(entrypoint, /RAILWAY_VOLUME_MOUNT_PATH/);
  assert.match(entrypoint, /chown -R node:node/);
  assert.match(entrypoint, /exec su-exec node/);
});
