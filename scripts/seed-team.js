'use strict';
require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../db');

const people = [
  ['gustavo.paris', 'Gustavo Gonzalez Paris', 'director_general'],
  ['mario.guzman', 'Mario Guzman', 'administrador_tecnico'],
  ['pablo.morelli', 'Pablo Morelli', 'administrador_tecnico'],
  ['oscar.pichinan', 'Oscar Pichiñan', 'administrador_tecnico'],
  ['sergio.guisasola', 'Sergio Guisasola', 'usuario'],
  ['yamil.cordoba', 'Yamil Córdoba', 'usuario'],
  ['enzo.ataide', 'Enzo Ataide', 'usuario'],
  ['celeste.barrientos', 'Celeste Barrientos', 'usuario'],
  ['juan.elmonje', 'Juan El Monje', 'administrador_tecnico'],
];

async function main() {
  const temporaryPassword = String(process.env.INITIAL_TEAM_PASSWORD || '');
  if (temporaryPassword.length < 6) throw new Error('INITIAL_TEAM_PASSWORD es obligatorio y debe tener al menos 6 caracteres');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [directors] = await conn.query(`SELECT id FROM vivero_usuarios WHERE rol='director_general' ORDER BY id LIMIT 1 FOR UPDATE`);
    if (directors.length !== 1) throw new Error('Se requiere exactamente un Director General inicial');
    const actorId = directors[0].id;
    const [existing] = await conn.query('SELECT id FROM vivero_usuarios WHERE id <> ?', [actorId]);
    if (existing.length) throw new Error('Ya existen otros usuarios; no se realizó una carga parcial');
    for (const [identifier, nombre, rol] of people) {
      const hash = await bcrypt.hash(temporaryPassword, 12);
      let id;
      if (rol === 'director_general') {
        id = actorId;
        await conn.query(`UPDATE vivero_usuarios SET email=?,nombre=?,password_hash=?,debe_cambiar_clave=1,intentos_fallidos=0,bloqueado_hasta=NULL WHERE id=?`, [identifier,nombre,hash,id]);
      } else {
        const [result] = await conn.query(`INSERT INTO vivero_usuarios (email,password_hash,nombre,rol,activo,debe_cambiar_clave) VALUES (?,?,?,?,1,1)`, [identifier,hash,nombre,rol]);
        id = result.insertId;
      }
      await conn.query(`INSERT INTO vivero_auditoria (actor_usuario_id,accion,entidad,entidad_id,motivo,valores_nuevos) VALUES (?,?,'usuario',?,'Carga inicial autorizada del equipo Vivero Lemú',?)`, [actorId,rol==='director_general'?'CLAVE_TEMPORAL_ASIGNADA':'USUARIO_CREADO',String(id),JSON.stringify({identifier,nombre,rol,debe_cambiar_clave:true})]);
    }
    await conn.commit();
    console.log(JSON.stringify({ok:true,users:people.length,forced_password_change:true,credentials_file_created:false,secrets_exposed:false}));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
}

main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>db.end());
