/**
 * seed_admin_vivero.js
 * Crear un usuario inicial exclusivamente desde variables de entorno.
 * No ejecutar en producción después del alta inicial.
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const db     = require('../db');

async function seed() {
  const email    = String(process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.INITIAL_ADMIN_PASSWORD || '');
  const nombre   = String(process.env.INITIAL_ADMIN_NAME || '').trim();
  const rol      = 'director_general';

  if (!email || !nombre || password.length < 12) {
    throw new Error('Faltan INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_NAME o una clave inicial de al menos 12 caracteres');
  }

  const hash = await bcrypt.hash(password, 10);

  const sql = `
    INSERT INTO vivero_usuarios (email, password_hash, nombre, rol, activo)
    VALUES (?, ?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE
      password_hash = VALUES(password_hash),
      nombre        = VALUES(nombre),
      rol           = VALUES(rol),
      activo        = 1
  `;

  try {
    await db.query(sql, [email, hash, nombre, rol]);
    console.log('✅ Usuario administrador inicial creado correctamente.');
    console.log(`   Email: ${email}`);
  } catch (err) {
    console.error('❌ Error al crear usuario:', err.message);
  } finally {
    process.exit();
  }
}

seed();
