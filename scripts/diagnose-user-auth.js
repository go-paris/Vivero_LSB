'use strict';

require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../db');

async function main() {
  const identifier = String(process.argv[2] || '').trim().toLowerCase();
  const password = String(process.env.AUTH_DIAGNOSE_PASSWORD || '');
  if (!identifier || !password) {
    throw new Error('Uso: AUTH_DIAGNOSE_PASSWORD=<clave> node scripts/diagnose-user-auth.js <usuario>');
  }
  const [rows] = await db.query(
    `SELECT id, email, nombre, rol, activo, debe_cambiar_clave,
            intentos_fallidos, bloqueado_hasta, ultimo_acceso, password_hash
     FROM vivero_usuarios WHERE email = ? LIMIT 1`,
    [identifier]
  );
  const user = rows[0] || null;
  const passwordMatches = user ? await bcrypt.compare(password, user.password_hash) : false;
  console.log(JSON.stringify({
    found: !!user,
    user: user ? {
      id: user.id,
      email: user.email,
      nombre: user.nombre,
      rol: user.rol,
      activo: !!user.activo,
      debe_cambiar_clave: !!user.debe_cambiar_clave,
      intentos_fallidos: user.intentos_fallidos,
      bloqueado_hasta: user.bloqueado_hasta,
      ultimo_acceso: user.ultimo_acceso,
    } : null,
    password_matches: passwordMatches,
    secrets_exposed: false,
  }));
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
