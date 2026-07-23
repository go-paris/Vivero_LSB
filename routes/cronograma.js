'use strict';
const express=require('express');
const db=require('../db');
const {canAdminister}=require('../lib/roles');
const router=express.Router();
const types=new Set(['siembra','repique','riego','fertilizacion','sanidad','rustificacion','plantacion','despacho','mantenimiento','capacitacion','otro']);
const states=new Set(['programada','en_curso','completada','cancelada']);
const dateRx=/^\d{4}-\d{2}-\d{2}$/;
const admin=(req,res,next)=>canAdminister(req.session?.usuario?.rol)?next():res.status(403).json({error:'Sin permisos'});
const clean=value=>String(value||'').trim();

async function audit(conn,actor,action,id,reason,before,after){
  await conn.query(`INSERT INTO vivero_auditoria (actor_usuario_id,accion,entidad,entidad_id,motivo,valores_anteriores,valores_nuevos) VALUES (?,?, 'cronograma',?,?,?,?)`,[actor.id,action,String(id),reason||null,JSON.stringify(before||null),JSON.stringify(after||null)]);
}

router.get('/',async(req,res)=>{
  const from=dateRx.test(String(req.query.desde||''))?String(req.query.desde):null;
  const to=dateRx.test(String(req.query.hasta||''))?String(req.query.hasta):null;
  try{
    const params=[];let where="WHERE c.estado <> 'cancelada'";
    if(from){where+=' AND COALESCE(c.fecha_fin,c.fecha_inicio)>=?';params.push(from)}
    if(to){where+=' AND c.fecha_inicio<=?';params.push(to)}
    const [rows]=await db.query(`SELECT c.*,l.lote,l.especie,u.nombre AS responsable_nombre, DATEDIFF(c.fecha_inicio,CURDATE()) AS dias_hasta_inicio, CASE WHEN c.estado IN ('programada','en_curso') AND CURDATE() BETWEEN DATE_SUB(c.fecha_inicio,INTERVAL c.alertar_dias_antes DAY) AND COALESCE(c.fecha_fin,c.fecha_inicio) THEN 1 ELSE 0 END AS alerta_activa FROM vivero_cronograma c LEFT JOIN vivero_lotes l ON l.id=c.lote_id LEFT JOIN vivero_usuarios u ON u.id=c.responsable_usuario_id ${where} ORDER BY c.fecha_inicio,c.hora,c.id`,params);
    res.json(rows);
  }catch(error){console.error('[cronograma/get]',error.message);res.status(500).json({error:'No se pudo cargar el cronograma'})}
});

router.post('/',admin,async(req,res)=>{
  const data={titulo:clean(req.body.titulo),tipo:clean(req.body.tipo),fecha_inicio:clean(req.body.fecha_inicio),fecha_fin:clean(req.body.fecha_fin)||null,hora:clean(req.body.hora)||null,lote_id:req.body.lote_id?Number(req.body.lote_id):null,responsable_usuario_id:req.body.responsable_usuario_id?Number(req.body.responsable_usuario_id):null,descripcion:clean(req.body.descripcion)||null,alertar_dias_antes:Number(req.body.alertar_dias_antes||0)};
  const reason=clean(req.body.motivo);
  if(data.titulo.length<3||!types.has(data.tipo)||!dateRx.test(data.fecha_inicio)||(data.fecha_fin&&(!dateRx.test(data.fecha_fin)||data.fecha_fin<data.fecha_inicio))||data.alertar_dias_antes<0||data.alertar_dias_antes>90||reason.length<5)return res.status(400).json({error:'Actividad, fechas o motivo inválidos'});
  const conn=await db.getConnection();try{await conn.beginTransaction();const[result]=await conn.query(`INSERT INTO vivero_cronograma (titulo,tipo,fecha_inicio,fecha_fin,hora,lote_id,responsable_usuario_id,descripcion,alertar_dias_antes,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?)`,[data.titulo,data.tipo,data.fecha_inicio,data.fecha_fin,data.hora,data.lote_id,data.responsable_usuario_id,data.descripcion,data.alertar_dias_antes,req.session.usuario.id]);await audit(conn,req.session.usuario,'CRONOGRAMA_CREADO',result.insertId,reason,null,data);await conn.commit();res.status(201).json({ok:true,id:result.insertId})}catch(error){await conn.rollback();console.error('[cronograma/post]',error.message);res.status(500).json({error:'No se pudo calendarizar la actividad'})}finally{conn.release()}
});

router.patch('/:id/estado',admin,async(req,res)=>{
  const state=clean(req.body.estado),reason=clean(req.body.motivo);if(!states.has(state)||reason.length<5)return res.status(400).json({error:'Estado o motivo inválido'});
  const conn=await db.getConnection();try{await conn.beginTransaction();const[rows]=await conn.query('SELECT id,estado FROM vivero_cronograma WHERE id=? FOR UPDATE',[req.params.id]);if(!rows[0]){await conn.rollback();return res.status(404).json({error:'Actividad inexistente'})}await conn.query('UPDATE vivero_cronograma SET estado=? WHERE id=?',[state,req.params.id]);await audit(conn,req.session.usuario,'CRONOGRAMA_ESTADO',req.params.id,reason,rows[0],{estado:state});await conn.commit();res.json({ok:true})}catch(error){await conn.rollback();res.status(500).json({error:'No se pudo cambiar el estado'})}finally{conn.release()}
});
module.exports=router;
