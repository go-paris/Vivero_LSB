'use strict';

const express = require('express');
const db = require('../db');
const { canAdminister } = require('../lib/roles');

const router = express.Router();
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const isoMonth = /^\d{4}-(0[1-9]|1[0-2])$/;

router.use((req, res, next) => canAdminister(req.session?.usuario?.rol)
  ? next()
  : res.status(403).json({ error: 'Sin permisos' }));

function dateParam(value) {
  const result = String(value || '').trim();
  return isoDate.test(result) ? result : null;
}

function audit(conn, actor, action, entity, entityId, reason, before, after) {
  return conn.query(
    `INSERT INTO vivero_auditoria
     (actor_usuario_id, accion, entidad, entidad_id, motivo, valores_anteriores, valores_nuevos)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [actor.id, action, entity, String(entityId || ''), reason,
      JSON.stringify(before || null), JSON.stringify(after || null)]
  );
}

function attendanceStatus(row) {
  if (row.ausencia_tipo) return 'ausencia_justificada';
  if (!row.hora_entrada_programada) return row.primera_entrada ? 'presente_no_programado' : 'no_programado';
  if (!row.primera_entrada) return 'ausente';
  if (!row.ultima_salida) return 'jornada_abierta';
  return Number(row.minutos_tarde || 0) > Number(row.tolerancia_min || 0) ? 'tarde' : 'presente';
}

router.get('/asistencia', async (req, res) => {
  const fecha = dateParam(req.query.fecha);
  if (!fecha) return res.status(400).json({ error: 'Fecha inválida' });
  try {
    const [rows] = await db.query(
      `SELECT u.id AS usuario_id, u.nombre, u.rol,
              h.hora_entrada AS hora_entrada_programada,
              h.hora_salida AS hora_salida_programada,
              h.tolerancia_min,
              a.primera_entrada, a.ultima_salida, a.cantidad_registros,
              DATE_FORMAT(DATE_SUB(a.primera_entrada, INTERVAL 3 HOUR), '%H:%i') AS primera_entrada_local,
              DATE_FORMAT(DATE_SUB(a.ultima_salida, INTERVAL 3 HOUR), '%H:%i') AS ultima_salida_local,
              CASE WHEN a.primera_entrada IS NULL THEN NULL
                   ELSE GREATEST(0, TIMESTAMPDIFF(MINUTE, CONCAT(?, ' ', h.hora_entrada), DATE_SUB(a.primera_entrada, INTERVAL 3 HOUR))) END AS minutos_tarde,
              CASE WHEN a.primera_entrada IS NULL OR a.ultima_salida IS NULL THEN NULL
                   ELSE TIMESTAMPDIFF(MINUTE, a.primera_entrada, a.ultima_salida) END AS minutos_trabajados,
              au.tipo AS ausencia_tipo, au.observaciones AS ausencia_observaciones
       FROM vivero_usuarios u
       LEFT JOIN vivero_horarios h ON h.usuario_id = u.id AND h.activo = 1
         AND h.dia_semana = WEEKDAY(?) + 1
         AND h.vigente_desde <= ? AND (h.vigente_hasta IS NULL OR h.vigente_hasta >= ?)
       LEFT JOIN v_asistencia_vivero a ON a.usuario_id = u.id AND a.fecha = ?
       LEFT JOIN vivero_ausencias au ON au.usuario_id = u.id AND au.estado = 'aprobada'
         AND ? BETWEEN au.fecha_desde AND au.fecha_hasta
       WHERE u.activo = 1
       ORDER BY FIELD(u.rol, 'director_general','administrador_tecnico','usuario'), u.nombre`,
      [fecha, fecha, fecha, fecha, fecha, fecha]
    );
    const personas = rows.map(row => ({ ...row, estado_asistencia: attendanceStatus(row) }));
    const resumen = personas.reduce((acc, item) => {
      acc[item.estado_asistencia] = (acc[item.estado_asistencia] || 0) + 1;
      return acc;
    }, { total: personas.length });
    res.json({ fecha, resumen, personas });
  } catch (error) {
    console.error('[gestion/asistencia]', error.message);
    res.status(500).json({ error: 'No se pudo calcular la asistencia' });
  }
});

router.get('/horarios', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT h.*, u.nombre FROM vivero_horarios h
       JOIN vivero_usuarios u ON u.id = h.usuario_id
       WHERE h.activo = 1 ORDER BY u.nombre, h.dia_semana, h.vigente_desde DESC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron obtener los horarios' });
  }
});

router.put('/horarios/:usuarioId', async (req, res) => {
  const usuarioId = Number(req.params.usuarioId);
  const dias = Array.isArray(req.body.dias) ? [...new Set(req.body.dias.map(Number))] : [];
  const entrada = String(req.body.hora_entrada || '');
  const salida = String(req.body.hora_salida || '');
  const tolerancia = Number(req.body.tolerancia_min ?? 15);
  const desde = dateParam(req.body.vigente_desde);
  const motivo = String(req.body.motivo || '').trim();
  if (!Number.isInteger(usuarioId) || !dias.length || dias.some(d => d < 1 || d > 7)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entrada) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(salida)
      || salida <= entrada || tolerancia < 0 || tolerancia > 180 || !desde || motivo.length < 5) {
    return res.status(400).json({ error: 'Horario o motivo inválido' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.query('SELECT id, nombre FROM vivero_usuarios WHERE id = ? AND activo = 1 FOR UPDATE', [usuarioId]);
    if (!users[0]) { await conn.rollback(); return res.status(404).json({ error: 'Usuario inexistente' }); }
    const [before] = await conn.query('SELECT * FROM vivero_horarios WHERE usuario_id = ? AND activo = 1', [usuarioId]);
    await conn.query('UPDATE vivero_horarios SET activo = 0, vigente_hasta = DATE_SUB(?, INTERVAL 1 DAY) WHERE usuario_id = ? AND activo = 1', [desde, usuarioId]);
    for (const dia of dias) {
      await conn.query(
        `INSERT INTO vivero_horarios
         (usuario_id, dia_semana, hora_entrada, hora_salida, tolerancia_min, vigente_desde, creado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [usuarioId, dia, entrada, salida, tolerancia, desde, req.session.usuario.id]
      );
    }
    const after = { dias, hora_entrada: entrada, hora_salida: salida, tolerancia_min: tolerancia, vigente_desde: desde };
    await audit(conn, req.session.usuario, 'HORARIO_ACTUALIZADO', 'horario', usuarioId, motivo, before, after);
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error('[gestion/horarios]', error.message);
    res.status(500).json({ error: 'No se pudo actualizar el horario' });
  } finally { conn.release(); }
});

router.post('/ausencias', async (req, res) => {
  const usuarioId = Number(req.body.usuario_id);
  const desde = dateParam(req.body.fecha_desde);
  const hasta = dateParam(req.body.fecha_hasta);
  const tipo = String(req.body.tipo || 'otro');
  const observaciones = String(req.body.observaciones || '').trim();
  const motivo = String(req.body.motivo || '').trim();
  if (!Number.isInteger(usuarioId) || !desde || !hasta || hasta < desde
      || !['licencia','comision','vacaciones','enfermedad','dia_estudio','otro'].includes(tipo) || motivo.length < 5) {
    return res.status(400).json({ error: 'Ausencia o motivo inválido' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO vivero_ausencias
       (usuario_id, fecha_desde, fecha_hasta, tipo, estado, observaciones, registrado_por)
       VALUES (?, ?, ?, ?, 'aprobada', ?, ?)`,
      [usuarioId, desde, hasta, tipo, observaciones || null, req.session.usuario.id]
    );
    await audit(conn, req.session.usuario, 'AUSENCIA_REGISTRADA', 'ausencia', result.insertId, motivo, null,
      { usuario_id: usuarioId, fecha_desde: desde, fecha_hasta: hasta, tipo, observaciones });
    await conn.commit();
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: 'No se pudo registrar la ausencia' });
  } finally { conn.release(); }
});

async function monthlyReport(month) {
  const start = `${month}-01`;
  const [summary] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM vivero_asistencia WHERE fecha_local >= ? AND fecha_local < DATE_ADD(?, INTERVAL 1 MONTH) AND tipo='entrada' AND anulado_en IS NULL) AS asistencias,
       (SELECT COUNT(*) FROM vivero_tareas WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 MONTH)) AS tareas_total,
       (SELECT COUNT(*) FROM vivero_tareas WHERE updated_at >= ? AND updated_at < DATE_ADD(?, INTERVAL 1 MONTH) AND completada=1) AS tareas_completadas,
       (SELECT COALESCE(SUM(cantidad_actual),0) FROM vivero_lotes WHERE activo=1) AS plantas_stock,
       (SELECT COUNT(*) FROM vivero_lotes WHERE activo=1) AS lotes_activos,
       (SELECT COUNT(*) FROM vivero_sanidad s JOIN vivero_lotes l ON l.id=s.lote_id WHERE l.activo=1 AND s.severidad='alta' AND s.fecha >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)) AS alertas_sanitarias,
       (SELECT COALESCE(SUM(cantidad),0) FROM vivero_despachos WHERE fecha >= ? AND fecha < DATE_ADD(?, INTERVAL 1 MONTH)) AS plantas_despachadas,
       (SELECT COALESCE(SUM(cantidad_perdida),0) FROM vivero_lote_etapas WHERE fecha >= ? AND fecha < DATE_ADD(?, INTERVAL 1 MONTH)) AS bajas_mes,
       (SELECT COALESCE(SUM(volumen_litros),0) FROM vivero_riegos WHERE fecha >= ? AND fecha < DATE_ADD(?, INTERVAL 1 MONTH)) AS agua_litros_mes,
       (SELECT ROUND(COALESCE(SUM(cantidad_actual),0)/NULLIF(SUM(cantidad_semilla),0)*100,1) FROM vivero_lotes WHERE activo=1) AS retencion_acumulada_pct,
       (SELECT COUNT(*) FROM vivero_lotes l WHERE l.activo=1 AND NOT EXISTS (SELECT 1 FROM vivero_lote_muestreos m WHERE m.lote_id=l.id AND m.fecha>=DATE_SUB(CURDATE(),INTERVAL 60 DAY))) AS lotes_sin_muestreo_60d`,
    [start,start,start,start,start,start,start,start,start,start,start,start]
  );
  const [attendance] = await db.query(
    `SELECT u.nombre, COUNT(DISTINCT a.fecha_local) AS dias_con_asistencia,
            ROUND(SUM(CASE WHEN a.tipo='salida' THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN a.tipo='entrada' THEN 1 ELSE 0 END),0) * 100, 1) AS jornadas_cerradas_pct
     FROM vivero_usuarios u LEFT JOIN vivero_asistencia a ON a.usuario_id=u.id
       AND a.fecha_local >= ? AND a.fecha_local < DATE_ADD(?, INTERVAL 1 MONTH) AND a.anulado_en IS NULL
     WHERE u.activo=1 GROUP BY u.id,u.nombre ORDER BY u.nombre`, [start,start]
  );
  const [species] = await db.query(
    `SELECT especie, COUNT(*) AS lotes, COALESCE(SUM(cantidad_actual),0) AS plantas
     FROM vivero_lotes WHERE activo=1 GROUP BY especie ORDER BY plantas DESC, especie`
  );
  return { mes: month, resumen: summary[0], asistencia: attendance, especies: species };
}

router.get('/informe-mensual', async (req, res) => {
  const month = String(req.query.mes || '');
  if (!isoMonth.test(month)) return res.status(400).json({ error: 'Mes inválido' });
  try { res.json(await monthlyReport(month)); }
  catch (error) { console.error('[gestion/informe]', error.message); res.status(500).json({ error: 'No se pudo generar el informe' }); }
});

router.get('/informe-mensual.csv', async (req, res) => {
  const month = String(req.query.mes || '');
  if (!isoMonth.test(month)) return res.status(400).json({ error: 'Mes inválido' });
  try {
    const report = await monthlyReport(month);
    const q = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [['Indicador','Valor'], ...Object.entries(report.resumen), [], ['Persona','Días con asistencia','Jornadas cerradas %'],
      ...report.asistencia.map(x => [x.nombre,x.dias_con_asistencia,x.jornadas_cerradas_pct ?? 'Sin dato']), [],
      ['Especie','Lotes','Plantas'], ...report.especies.map(x => [x.especie,x.lotes,x.plantas])];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vivero-lemu-${month}.csv"`);
    res.send('\uFEFF' + lines.map(row => row.map(q).join(';')).join('\r\n'));
  } catch (error) { res.status(500).json({ error: 'No se pudo exportar el informe' }); }
});

module.exports = router;
