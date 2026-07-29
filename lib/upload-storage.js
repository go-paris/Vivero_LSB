'use strict';

const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..');

function resolveUploadDir(env = process.env) {
  const configured = String(env.RAILWAY_VOLUME_MOUNT_PATH || env.UPLOAD_DIR || '').trim();
  if (!configured) return path.join(appRoot, 'uploads');
  if (path.isAbsolute(configured)) return path.normalize(configured);
  const withoutAppPrefix = configured
    .replace(/^[.][\\/]/, '')
    .replace(/^app[\\/]/i, '');
  return path.resolve(appRoot, withoutAppPrefix);
}

function ensureUploadDir(env = process.env) {
  const directory = resolveUploadDir(env);
  fs.mkdirSync(directory, { recursive: true });
  fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
  return directory;
}

module.exports = { ensureUploadDir, resolveUploadDir };
