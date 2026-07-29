'use strict';

require('dotenv').config();
const path = require('path');
const db = require('../db');

async function main() {
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.query(
      `SELECT id FROM vivero_usuarios
       WHERE rol = 'director_general' AND activo = 1 ORDER BY id LIMIT 1`
    );
    if (users.length !== 1) throw new Error('Director General activo no encontrado');
    await conn.query(
      `INSERT INTO vivero_archivos
       (usuario_id, nombre_orig, nombre_disco, tipo_mime, tamanio_kb, fecha_local)
       VALUES (?, 'diagnostico.pdf', 'diagnostico-no-persistido.pdf', 'application/pdf', 1, CURDATE())`,
      [users[0].id]
    );
    await conn.rollback();
    console.log(JSON.stringify({
      ok: true,
      database_insert: true,
      transaction_rolled_back: true,
      upload_dir: uploadDir,
      upload_dir_is_absolute: path.isAbsolute(process.env.UPLOAD_DIR || ''),
      secrets_exposed: false,
    }));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
