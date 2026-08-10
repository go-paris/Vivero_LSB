/**
 * routes/vivero.js — Vivero Lemú
 * Rutas operativas sobre la base independiente del Vivero Lemú
 */
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const db       = require('../db');
const { GeofenceError, evaluateGeofence, readGeofenceConfig } = require('../lib/geofence');
const { canAdminister } = require('../lib/roles');
const { ensureUploadDir } = require('../lib/upload-storage');

const router = express.Router();

// ── Middleware: verificar sesión ──────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.usuario) return res.status(401).json({ error: 'No autenticado' });
  next();
}
function requireAdmin(req, res, next) {
  const rol = req.session?.usuario?.rol;
  if (!canAdminister(rol)) return res.status(403).json({ error: 'Sin permisos' });
  next();
}

// ── Multer ────────────────────────────────────────────────
const uploadDir = ensureUploadDir();
const uploadTypes = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename:    (req, file, cb) => cb(null, `${crypto.randomUUID()}${uploadTypes.get(file.mimetype) || ''}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => uploadTypes.has(file.mimetype)
    ? cb(null, true)
    : cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'archivo')),
});

// ════════════════════════════════════════════════════════
// PERFIL
// ════════════════════════════════════════════════════════
router.patch('/perfil', requireAuth, async (req, res) => {
  const { bio, foto_url } = req.body;
  try {
    await db.query(
      'UPDATE vivero_usuarios SET bio = ?, foto_url = COALESCE(?, foto_url) WHERE id = ?',
      [bio || null, foto_url || null, req.session.usuario.id]
    );
    req.session.usuario.bio = bio || null;
    if (foto_url) req.session.usuario.foto_url = foto_url;
    res.json({ ok: true });
  } catch (err) {
    console.error('[perfil]', err.message);
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

// ════════════════════════════════════════════════════════
// ASISTENCIA
// Tabla real: vivero_asistencia
// Columnas:   id, usuario_id, nombre_usuario, timestamp_registro,
//             latitud, longitud, precision_m, distancia_vivero_m,
//             fecha_local, creado_en
// ════════════════════════════════════════════════════════
router.get('/asistencia/hoy', requireAuth, async (req, res) => {
  try {
    const geofence = readGeofenceConfig();
    const [rows] = await db.query(
      `SELECT *, timestamp_registro AS created_at,
              IF(distancia_vivero_m <= ?, 1, 0) AS geo_valida
       FROM vivero_asistencia
       WHERE usuario_id = ? AND anulado_en IS NULL
       ORDER BY timestamp_registro DESC
       LIMIT 100`,
      [geofence.radiusMeters, req.session.usuario.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[asistencia/hoy]', err.message);
    res.status(500).json({ error: 'Error al obtener asistencia' });
  }
});

router.post('/asistencia', requireAuth, async (req, res) => {
  const { tipo, lat, lng, precision_m } = req.body;
  const usuario = req.session.usuario;
  if (!['entrada','salida'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  let geolocation;
  try {
    geolocation = evaluateGeofence(
      { lat, lng, precision_m },
      readGeofenceConfig()
    );
  } catch (err) {
    if (err instanceof GeofenceError) {
      return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    }
    console.error('[asistencia/geofence-config]', err.message);
    return res.status(503).json({ error: 'Geocerca no disponible', code: 'GEO_CONFIG_UNAVAILABLE' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [lastRows] = await conn.query(
      `SELECT tipo FROM vivero_asistencia
       WHERE usuario_id = ? AND fecha_local = CURDATE() AND anulado_en IS NULL
       ORDER BY timestamp_registro DESC, id DESC LIMIT 1 FOR UPDATE`,
      [usuario.id]
    );
    const lastType = lastRows[0]?.tipo || null;
    if ((tipo === 'entrada' && lastType === 'entrada') || (tipo === 'salida' && lastType !== 'entrada')) {
      await conn.rollback();
      return res.status(409).json({
        error: tipo === 'entrada' ? 'Ya existe una entrada pendiente de salida' : 'No existe una entrada pendiente',
        code: 'ATTENDANCE_INVALID_SEQUENCE',
      });
    }

    await conn.query(
      `INSERT INTO vivero_asistencia
       (usuario_id, tipo, nombre_usuario, timestamp_registro, latitud, longitud,
        precision_m, distancia_vivero_m, fecha_local, sede_codigo, geocerca_version)
       VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, CURDATE(), ?, ?)`,
      [
        usuario.id,
        tipo,
        usuario.nombre,
        geolocation.latitude,
        geolocation.longitude,
        geolocation.accuracyMeters,
        geolocation.distanceMeters,
        geolocation.siteCode,
        geolocation.geofenceVersion,
      ]
    );
    await conn.commit();
    res.status(201).json({
      ok: true,
      tipo,
      timestamp_servidor: new Date().toISOString(),
      ubicacion: {
        verificada: true,
        distancia_m: geolocation.distanceMeters,
        precision_m: geolocation.accuracyMeters,
        sede_codigo: geolocation.siteCode,
        geocerca_version: geolocation.geofenceVersion,
      },
    });
  } catch (err) {
    await conn.rollback();
    console.error('[asistencia/post]', err.message);
    res.status(500).json({ error: 'Error al registrar asistencia' });
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════
// NOVEDADES
// Tabla real: vivero_novedades (también contiene instrucciones)
// Columnas:   id, usuario_id, nombre_usuario, tipo, contenido,
//             fecha_local, creado_en
// ════════════════════════════════════════════════════════
// DELETE /api/vivero/asistencia/:id
router.delete('/asistencia/:id', requireAuth, requireAdmin, async (req, res) => {
  res.status(405).json({
    error: 'Los registros de asistencia no se eliminan; deben rectificarse con auditoría',
    code: 'ATTENDANCE_DELETE_FORBIDDEN',
  });
});

router.patch('/asistencia/:id/rectificar', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const motivo = String(req.body.motivo || '').trim();
  if (!Number.isInteger(id) || id <= 0 || motivo.length < 5 || motivo.length > 500) {
    return res.status(400).json({ error: 'ID o motivo inválido' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id, usuario_id, tipo, timestamp_registro, anulado_en
       FROM vivero_asistencia WHERE id = ? LIMIT 1 FOR UPDATE`, [id]
    );
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: 'Registro no encontrado' }); }
    if (rows[0].anulado_en) { await conn.rollback(); return res.status(409).json({ error: 'El registro ya fue rectificado' }); }
    await conn.query(
      'UPDATE vivero_asistencia SET anulado_en = NOW(), anulado_por = ?, motivo_anulacion = ? WHERE id = ?',
      [req.session.usuario.id, motivo, id]
    );
    await conn.query(
      `INSERT INTO vivero_auditoria
       (actor_usuario_id, accion, entidad, entidad_id, motivo, valores_anteriores, valores_nuevos)
       VALUES (?, 'ASISTENCIA_RECTIFICADA', 'asistencia', ?, ?, ?, ?)`,
      [req.session.usuario.id, String(id), motivo, JSON.stringify(rows[0]), JSON.stringify({ anulado: true })]
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    console.error('[asistencia/rectificar]', error.message);
    res.status(500).json({ error: 'Error al rectificar asistencia' });
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════
// NOVEDADES
// ════════════════════════════════════════════════════════
router.get('/novedades', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT *, creado_en AS created_at, contenido AS texto, nombre_usuario
       FROM vivero_novedades
       WHERE tipo = 'novedad'
       ORDER BY creado_en DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    console.error('[novedades/get]', err.message);
    res.status(500).json({ error: 'Error al obtener novedades' });
  }
});

router.post('/novedades', requireAuth, async (req, res) => {
  const { texto } = req.body;
  if (!texto?.trim()) return res.status(400).json({ error: 'El texto es requerido' });
  const usuario = req.session.usuario;
  try {
    await db.query(
      `INSERT INTO vivero_novedades (usuario_id, nombre_usuario, tipo, contenido, fecha_local)
       VALUES (?, ?, 'novedad', ?, CURDATE())`,
      [usuario.id, usuario.nombre, texto.trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[novedades/post]', err.message);
    res.status(500).json({ error: 'Error al guardar novedad' });
  }
});

// ════════════════════════════════════════════════════════
// INSTRUCCIONES (mismo tabla, tipo='instruccion')
// ════════════════════════════════════════════════════════
router.get('/instrucciones', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT n.*, n.creado_en AS created_at, n.contenido AS texto, n.nombre_usuario,
              n.fecha_limite, n.estado,
              um.nombre AS marcada_por_nombre,
              uf.nombre AS finalizada_por_nombre
       FROM vivero_novedades n
       LEFT JOIN vivero_usuarios um ON um.id = n.marcada_por
       LEFT JOIN vivero_usuarios uf ON uf.id = n.finalizada_por
       WHERE n.tipo = 'instruccion'
       ORDER BY
         (n.estado = 'finalizada') ASC,
         (n.fecha_limite IS NULL) ASC,
         n.fecha_limite ASC,
         n.creado_en DESC`
    );

    // ── Subactividades de todas las instrucciones en un solo query ──
    let subPorInstruccion = {};
    if (rows.length) {
      const ids = rows.map(r => r.id);
      const [subs] = await db.query(
        `SELECT s.*, u.nombre AS completada_por_nombre
         FROM vivero_subactividades s
         LEFT JOIN vivero_usuarios u ON u.id = s.completada_por
         WHERE s.instruccion_id IN (?)
         ORDER BY s.orden ASC, s.id ASC`,
        [ids]
      );
      subPorInstruccion = subs.reduce((acc, s) => {
        (acc[s.instruccion_id] = acc[s.instruccion_id] || []).push(s);
        return acc;
      }, {});
    }

    // El campo titulo no existe en la tabla original — lo extraemos del contenido
    const mapped = rows.map(r => {
      const subactividades = subPorInstruccion[r.id] || [];
      const total = subactividades.length;
      const completadas = subactividades.filter(s => s.completada).length;
      return {
        ...r,
        titulo: r.texto?.split('\n')[0]?.substring(0, 80) || 'Instrucción',
        texto:  r.texto?.split('\n').slice(1).join('\n').trim() || r.texto,
        subactividades,
        progreso: {
          total,
          completadas,
          porcentaje: total ? Math.round((completadas / total) * 100) : null,
        },
      };
    });
    res.json(mapped);
  } catch (err) {
    console.error('[instrucciones/get]', err.message);
    res.status(500).json({ error: 'Error al obtener instrucciones' });
  }
});

router.post('/instrucciones', requireAuth, requireAdmin, async (req, res) => {
  const { titulo, texto, fecha_limite, subactividades } = req.body;
  if (!titulo?.trim() || !texto?.trim()) return res.status(400).json({ error: 'Faltan campos' });
  const usuario = req.session.usuario;
  // Guardamos título y texto juntos en contenido separados por salto de línea
  const contenido = `${titulo.trim()}\n${texto.trim()}`;

  // Lista de subactividades (opcional): array de strings con el título de cada una
  const subs = Array.isArray(subactividades)
    ? subactividades.map(s => (typeof s === 'string' ? s : s?.titulo)).filter(s => s?.trim())
    : [];

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO vivero_novedades (usuario_id, nombre_usuario, tipo, contenido, fecha_local, fecha_limite, estado)
       VALUES (?, ?, 'instruccion', ?, CURDATE(), ?, 'pendiente')`,
      [usuario.id, usuario.nombre, contenido, fecha_limite || null]
    );
    const instruccionId = result.insertId;

    if (subs.length) {
      const values = subs.map((s, i) => [instruccionId, s.trim().substring(0, 150), i]);
      await conn.query(
        `INSERT INTO vivero_subactividades (instruccion_id, titulo, orden) VALUES ?`,
        [values]
      );
    }

    await conn.commit();
    res.json({ ok: true, id: instruccionId });
  } catch (err) {
    await conn.rollback();
    console.error('[instrucciones/post]', err.message);
    res.status(500).json({ error: 'Error al guardar instrucción' });
  } finally {
    conn.release();
  }
});

// PATCH /instrucciones/:id/marcar — el operario avisa que terminó (queda a confirmar)
router.patch('/instrucciones/:id/marcar', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, estado FROM vivero_novedades WHERE id = ? AND tipo = 'instruccion' LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrada' });
    if (rows[0].estado === 'finalizada') {
      return res.status(400).json({ error: 'Esta actividad ya fue finalizada' });
    }
    const [[{ pendientes }]] = await db.query(
      `SELECT COUNT(*) AS pendientes FROM vivero_subactividades WHERE instruccion_id = ? AND completada = 0`,
      [req.params.id]
    );
    if (pendientes > 0) {
      return res.status(400).json({ error: 'Todavía hay subactividades sin completar' });
    }
    await db.query(
      `UPDATE vivero_novedades
       SET estado = 'concluida_operario', marcada_por = ?, marcada_en = NOW()
       WHERE id = ?`,
      [req.session.usuario.id, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[instrucciones/marcar]', err.message);
    res.status(500).json({ error: 'Error al marcar la actividad' });
  }
});

// PATCH /instrucciones/:id/finalizar — solo un coordinador confirma con el check final
router.patch('/instrucciones/:id/finalizar', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Una actividad global con subactividades solo puede finalizarse cuando
    // TODAS están completas. Una actividad sin subactividades no tiene esta
    // restricción (se comporta como siempre).
    const [[{ pendientes }]] = await db.query(
      `SELECT COUNT(*) AS pendientes FROM vivero_subactividades WHERE instruccion_id = ? AND completada = 0`,
      [req.params.id]
    );
    if (pendientes > 0) {
      return res.status(400).json({ error: `Faltan ${pendientes} subactividad(es) por completar` });
    }
    await db.query(
      `UPDATE vivero_novedades
       SET estado = 'finalizada', finalizada_por = ?, finalizada_en = NOW()
       WHERE id = ? AND tipo = 'instruccion'`,
      [req.session.usuario.id, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[instrucciones/finalizar]', err.message);
    res.status(500).json({ error: 'Error al finalizar la actividad' });
  }
});

// PATCH /instrucciones/:id/reabrir — un coordinador puede reabrir si se marcó por error
router.patch('/instrucciones/:id/reabrir', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.query(
      `UPDATE vivero_novedades
       SET estado = 'pendiente', marcada_por = NULL, marcada_en = NULL,
           finalizada_por = NULL, finalizada_en = NULL
       WHERE id = ? AND tipo = 'instruccion'`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[instrucciones/reabrir]', err.message);
    res.status(500).json({ error: 'Error al reabrir la actividad' });
  }
});

router.delete('/instrucciones/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.query("DELETE FROM vivero_novedades WHERE id = ? AND tipo = 'instruccion'", [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar' }); }
});

// ════════════════════════════════════════════════════════
// SUBACTIVIDADES (checklist de una actividad global)
// ════════════════════════════════════════════════════════

// POST /instrucciones/:id/subactividades — agregar un ítem al checklist (coordinador)
router.post('/instrucciones/:id/subactividades', requireAuth, requireAdmin, async (req, res) => {
  const { titulo } = req.body;
  if (!titulo?.trim()) return res.status(400).json({ error: 'El título es requerido' });
  try {
    const [rows] = await db.query(
      "SELECT id, estado FROM vivero_novedades WHERE id = ? AND tipo = 'instruccion' LIMIT 1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Actividad no encontrada' });

    const [[{ maxOrden }]] = await db.query(
      'SELECT COALESCE(MAX(orden), -1) AS maxOrden FROM vivero_subactividades WHERE instruccion_id = ?',
      [req.params.id]
    );
    await db.query(
      'INSERT INTO vivero_subactividades (instruccion_id, titulo, orden) VALUES (?, ?, ?)',
      [req.params.id, titulo.trim().substring(0, 150), maxOrden + 1]
    );

    // Si la actividad ya estaba finalizada o concluida y se le agrega un nuevo
    // paso, vuelve a quedar pendiente (el nuevo ítem todavía no está hecho).
    if (['finalizada', 'concluida_operario'].includes(rows[0].estado)) {
      await db.query(
        `UPDATE vivero_novedades
         SET estado = 'pendiente', marcada_por = NULL, marcada_en = NULL,
             finalizada_por = NULL, finalizada_en = NULL
         WHERE id = ?`,
        [req.params.id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[subactividades/post]', err.message);
    res.status(500).json({ error: 'Error al agregar la subactividad' });
  }
});

// PATCH /instrucciones/:id/subactividades/:subId — tildar/destildar un ítem
router.patch('/instrucciones/:id/subactividades/:subId', requireAuth, async (req, res) => {
  try {
    const [instRows] = await db.query(
      "SELECT id, estado FROM vivero_novedades WHERE id = ? AND tipo = 'instruccion' LIMIT 1",
      [req.params.id]
    );
    if (!instRows.length) return res.status(404).json({ error: 'Actividad no encontrada' });
    if (instRows[0].estado === 'finalizada') {
      return res.status(400).json({ error: 'Esta actividad ya fue finalizada' });
    }

    const [subRows] = await db.query(
      'SELECT * FROM vivero_subactividades WHERE id = ? AND instruccion_id = ? LIMIT 1',
      [req.params.subId, req.params.id]
    );
    if (!subRows.length) return res.status(404).json({ error: 'Subactividad no encontrada' });

    const nuevoValor = subRows[0].completada ? 0 : 1;
    await db.query(
      `UPDATE vivero_subactividades
       SET completada = ?, completada_por = ?, completada_en = ?
       WHERE id = ?`,
      [nuevoValor, nuevoValor ? req.session.usuario.id : null, nuevoValor ? new Date() : null, req.params.subId]
    );

    // ── Sincronizar estado de la actividad global con el checklist ──
    const [[{ total, pendientes }]] = await db.query(
      `SELECT COUNT(*) AS total, SUM(completada = 0) AS pendientes
       FROM vivero_subactividades WHERE instruccion_id = ?`,
      [req.params.id]
    );

    if (total > 0 && pendientes == 0 && instRows[0].estado === 'pendiente') {
      // Se completó el último ítem → queda "a confirmar" por el coordinador
      await db.query(
        `UPDATE vivero_novedades SET estado = 'concluida_operario', marcada_por = ?, marcada_en = NOW() WHERE id = ?`,
        [req.session.usuario.id, req.params.id]
      );
    } else if (total > 0 && pendientes > 0 && instRows[0].estado === 'concluida_operario') {
      // Se destildó un ítem después de haber quedado "a confirmar" → vuelve a pendiente
      await db.query(
        `UPDATE vivero_novedades SET estado = 'pendiente', marcada_por = NULL, marcada_en = NULL WHERE id = ?`,
        [req.params.id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[subactividades/patch]', err.message);
    res.status(500).json({ error: 'Error al actualizar la subactividad' });
  }
});

// DELETE /instrucciones/:id/subactividades/:subId — quitar un ítem (coordinador)
router.delete('/instrucciones/:id/subactividades/:subId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM vivero_subactividades WHERE id = ? AND instruccion_id = ?',
      [req.params.subId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[subactividades/delete]', err.message);
    res.status(500).json({ error: 'Error al eliminar la subactividad' });
  }
});

router.delete('/novedades/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM vivero_novedades WHERE id = ? AND usuario_id = ?',
      [req.params.id, req.session.usuario.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar' }); }
});

// ════════════════════════════════════════════════════════
// ARCHIVOS
// ════════════════════════════════════════════════════════
router.get('/archivos', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.id, a.nombre_orig AS nombre_original, a.nombre_disco,
              a.tamanio_kb, a.creado_en AS created_at,
              u.nombre AS nombre_usuario
       FROM vivero_archivos a
       JOIN vivero_usuarios u ON u.id = a.usuario_id
       ORDER BY a.creado_en DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener archivos' }); }
});

router.post('/archivos', requireAuth, requireAdmin, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  try {
    await db.query(
      'INSERT INTO vivero_archivos (usuario_id, nombre_orig, nombre_disco, tipo_mime, tamanio_kb, fecha_local) VALUES (?, ?, ?, ?, ?, CURDATE())',
      [req.session.usuario.id, req.file.originalname, req.file.filename,
       req.file.mimetype, Math.round(req.file.size / 1024)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[archivos/post]', err.message);
    if (req.file?.path) {
      try { await fs.promises.unlink(req.file.path); }
      catch (cleanupError) { console.error('[archivos/cleanup]', cleanupError.message); }
    }
    res.status(500).json({ error: 'Error al guardar archivo' });
  }
});

router.get('/archivos/:id/descargar', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM vivero_archivos WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.download(path.join(uploadDir, rows[0].nombre_disco), rows[0].nombre_orig);
  } catch (err) { res.status(500).json({ error: 'Error al descargar' }); }
});

// ════════════════════════════════════════════════════════
// BIBLIOGRAFÍA
// ════════════════════════════════════════════════════════
router.get('/bibliografia', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, u.nombre AS nombre_usuario
       FROM vivero_bibliografia b
       JOIN vivero_usuarios u ON u.id = b.usuario_id
       ORDER BY b.created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener bibliografía' }); }
});

router.post('/bibliografia', requireAuth, requireAdmin, async (req, res) => {
  const { titulo, autor, url, tags, descripcion } = req.body;
  if (!titulo?.trim()) return res.status(400).json({ error: 'El título es requerido' });
  try {
    await db.query(
      'INSERT INTO vivero_bibliografia (usuario_id, titulo, autor, url, tags, descripcion) VALUES (?, ?, ?, ?, ?, ?)',
      [req.session.usuario.id, titulo.trim(), autor||null, url||null, tags||null, descripcion||null]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error al guardar referencia' }); }
});

router.delete('/bibliografia/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM vivero_bibliografia WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar' }); }
});

// ════════════════════════════════════════════════════════
// TAREAS (Productividad)
// ════════════════════════════════════════════════════════
router.get('/tareas', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM vivero_tareas_detalle
       WHERE DATE(created_at) = CURDATE() AND usuario_id = ?
       ORDER BY completada ASC, created_at DESC`,
      [req.session.usuario.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener tareas' }); }
});

router.get('/tareas/ranking', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM vivero_ranking_semanal WHERE completadas > 0 LIMIT 10');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener ranking' }); }
});

router.post('/tareas', requireAuth, async (req, res) => {
  const { titulo, categoria, prioridad, observaciones } = req.body;
  if (!titulo?.trim()) return res.status(400).json({ error: 'El título es requerido' });
  try {
    await db.query(
      'INSERT INTO vivero_tareas (usuario_id, titulo, categoria, prioridad, observaciones) VALUES (?, ?, ?, ?, ?)',
      [req.session.usuario.id, titulo.trim(), categoria||'otro', prioridad||'media', observaciones||null]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error al guardar tarea' }); }
});

router.patch('/tareas/:id', requireAuth, async (req, res) => {
  const { completada } = req.body;
  try {
    await db.query(
      'UPDATE vivero_tareas SET completada = ? WHERE id = ? AND usuario_id = ?',
      [completada ? 1 : 0, req.params.id, req.session.usuario.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error al actualizar tarea' }); }
});

router.delete('/tareas/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM vivero_tareas WHERE id = ? AND usuario_id = ?',
      [req.params.id, req.session.usuario.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar tarea' }); }
});

// ════════════════════════════════════════════════════════
// LOTES DE PRODUCCIÓN
// ════════════════════════════════════════════════════════
router.get('/semillas', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, u.nombre AS creado_por_nombre FROM vivero_semillas s
       LEFT JOIN vivero_usuarios u ON u.id=s.created_by
       ORDER BY FIELD(s.estado,'disponible','en_tratamiento','agotada','descartada'), s.especie, s.codigo`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener semillas' }); }
});

function datosSemilla(body) {
  const numero = (valor, min, max) => {
    if (valor === '' || valor == null) return null;
    const n = Number(valor);
    return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
  };
  const texto = (valor, max) => String(valor ?? '').trim().slice(0, max) || null;
  return {
    codigo: texto(body.codigo, 120), especie: texto(body.especie, 180),
    nombre_comun: texto(body.nombre_comun, 180), procedencia: texto(body.procedencia, 300),
    proveedor_recolector: texto(body.proveedor_recolector, 250),
    fecha_recoleccion: body.fecha_recoleccion || null, fecha_ingreso: body.fecha_ingreso || null,
    peso_humedo_kg: numero(body.peso_humedo_kg, 0, 999999999),
    peso_seco_kg: numero(body.peso_seco_kg, 0, 999999999), humedad_pct: numero(body.humedad_pct, 0, 100),
    cantidad_inicial: numero(body.cantidad_inicial, 0, 99999999999),
    unidad: ['semillas','gramos','kilogramos'].includes(body.unidad) ? body.unidad : 'semillas',
    tratamiento_pregerminativo: texto(body.tratamiento_pregerminativo, 500),
    almacenamiento: texto(body.almacenamiento, 300),
    estado: ['disponible','en_tratamiento','agotada','descartada'].includes(body.estado) ? body.estado : 'disponible',
    observaciones: texto(body.observaciones, 4000),
  };
}

router.post('/semillas', requireAuth, requireAdmin, async (req, res) => {
  const s = datosSemilla(req.body);
  if (!s.codigo || !s.especie || !s.procedencia || !s.fecha_ingreso || s.cantidad_inicial == null) {
    return res.status(400).json({ error: 'Código, especie, procedencia, fecha de ingreso y cantidad son requeridos' });
  }
  if ([s.peso_humedo_kg,s.peso_seco_kg,s.humedad_pct,s.cantidad_inicial].some(Number.isNaN)) {
    return res.status(400).json({ error: 'Pesos, humedad o cantidad inválidos' });
  }
  if (s.peso_humedo_kg != null && s.peso_seco_kg != null && s.peso_seco_kg > s.peso_humedo_kg) {
    return res.status(400).json({ error: 'El peso seco no puede superar el peso húmedo' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO vivero_semillas
       (codigo,especie,nombre_comun,procedencia,proveedor_recolector,fecha_recoleccion,fecha_ingreso,
        peso_humedo_kg,peso_seco_kg,humedad_pct,cantidad_inicial,cantidad_disponible,unidad,
        tratamiento_pregerminativo,almacenamiento,estado,observaciones,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [s.codigo,s.especie,s.nombre_comun,s.procedencia,s.proveedor_recolector,s.fecha_recoleccion,s.fecha_ingreso,
       s.peso_humedo_kg,s.peso_seco_kg,s.humedad_pct,s.cantidad_inicial,s.cantidad_inicial,s.unidad,
       s.tratamiento_pregerminativo,s.almacenamiento,s.estado,s.observaciones,req.session.usuario.id]
    );
    await conn.query(
      `INSERT INTO vivero_auditoria (actor_usuario_id,accion,entidad,entidad_id,valores_nuevos)
       VALUES (?,'SEMILLAS_CREADAS','semilla',?,?)`,
      [req.session.usuario.id, String(result.insertId), JSON.stringify(s)]
    );
    await conn.commit();
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe ese código de semilla' });
    console.error('[semillas/post]', err.message);
    res.status(500).json({ error: 'Error al registrar semillas' });
  } finally { conn.release(); }
});

router.patch('/semillas/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const estado = String(req.body.estado || '');
  if (!Number.isInteger(id) || id <= 0 || !['disponible','en_tratamiento','agotada','descartada'].includes(estado)) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[anterior]] = await conn.query('SELECT estado FROM vivero_semillas WHERE id=? LIMIT 1 FOR UPDATE', [id]);
    if (!anterior) { await conn.rollback(); return res.status(404).json({ error: 'Partida no encontrada' }); }
    await conn.query('UPDATE vivero_semillas SET estado=? WHERE id=?', [estado, id]);
    await conn.query(
      `INSERT INTO vivero_auditoria (actor_usuario_id,accion,entidad,entidad_id,valores_anteriores,valores_nuevos)
       VALUES (?,'SEMILLAS_ESTADO_CAMBIADO','semilla',?,?,?)`,
      [req.session.usuario.id, String(id), JSON.stringify(anterior), JSON.stringify({ estado })]
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'Error al actualizar semillas' });
  } finally { conn.release(); }
});

router.get('/lotes', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM vivero_lotes WHERE activo = 1 ORDER BY especie ASC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener lotes' }); }
});

router.post('/lotes', requireAuth, requireAdmin, async (req, res) => {
  const {
    especie, nombre_comun, lote, cantidad, fecha_siembra, sustrato, sector, notas,
    procedencia_semilla, lote_semilla, cantidad_semilla, semilla_id
  } = req.body;
  if (!especie?.trim() || !lote?.trim()) return res.status(400).json({ error: 'Especie y lote son requeridos' });
  const cantidadInicial = cantidad_semilla ?? cantidad ?? null;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let semilla = null;
    if (semilla_id) {
      [[semilla]] = await conn.query(
        `SELECT id,codigo,procedencia,cantidad_disponible,unidad,estado
         FROM vivero_semillas WHERE id=? LIMIT 1 FOR UPDATE`, [semilla_id]
      );
      if (!semilla || !['disponible','en_tratamiento'].includes(semilla.estado)) {
        await conn.rollback(); return res.status(400).json({ error: 'La partida de semillas no está disponible' });
      }
      if (cantidadInicial == null || Number(cantidadInicial) <= 0 || Number(cantidadInicial) > Number(semilla.cantidad_disponible)) {
        await conn.rollback(); return res.status(400).json({ error: 'La cantidad supera la existencia disponible de semillas' });
      }
    }
    const [result] = await conn.query(
      `INSERT INTO vivero_lotes
       (especie, nombre_comun, lote, cantidad, fecha_siembra, sustrato, sector, notas, created_by,
        procedencia_semilla, lote_semilla, cantidad_semilla, semilla_id, cantidad_actual, etapa_actual, fecha_etapa_actual)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'siembra', ?)`,
      [especie.trim(), nombre_comun||null, lote.trim(), cantidad||null,
       fecha_siembra||null, sustrato||null, sector||null, notas||null, req.session.usuario.id,
       semilla?.procedencia || procedencia_semilla || null, semilla?.codigo || lote_semilla || null,
       cantidadInicial, semilla?.id || null, cantidadInicial, fecha_siembra||null]
    );
    if (semilla) {
      await conn.query(
        `UPDATE vivero_semillas SET cantidad_disponible=cantidad_disponible-?,
         estado=IF(cantidad_disponible-?<=0,'agotada',estado) WHERE id=?`,
        [cantidadInicial, cantidadInicial, semilla.id]
      );
    }
    await conn.commit();
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    await conn.rollback();
    console.error('[lotes/post]', err.message);
    res.status(500).json({ error: 'Error al crear lote' });
  } finally { conn.release(); }
});

router.patch('/lotes/:id', requireAuth, requireAdmin, async (req, res) => {
  const { activo } = req.body;
  try {
    await db.query('UPDATE vivero_lotes SET activo = ? WHERE id = ?', [activo ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error al actualizar lote' }); }
});

// ════════════════════════════════════════════════════════
// DETALLE DE LOTE — trazabilidad completa + estadística
// ════════════════════════════════════════════════════════
const ORDEN_ETAPAS = ['siembra', 'germinacion', 'repique', 'crecimiento', 'rustificacion', 'despacho'];

router.get('/lotes/:id/detalle', requireAuth, async (req, res) => {
  const loteId = req.params.id;
  try {
    const [[lote]] = await db.query('SELECT * FROM vivero_lotes WHERE id = ? LIMIT 1', [loteId]);
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });

    const [etapas]  = await db.query(
      `SELECT e.*, u.nombre AS usuario_nombre FROM vivero_lote_etapas e
       LEFT JOIN vivero_usuarios u ON u.id = e.usuario_id
       WHERE e.lote_id = ? ORDER BY e.fecha ASC, e.id ASC`, [loteId]);
    const [muestreos] = await db.query(
      `SELECT m.*, u.nombre AS usuario_nombre FROM vivero_lote_muestreos m
       LEFT JOIN vivero_usuarios u ON u.id = m.usuario_id
       WHERE m.lote_id = ? ORDER BY m.fecha DESC, m.id DESC`, [loteId]);
    const [riegos] = await db.query(
      `SELECT r.*, u.nombre AS usuario_nombre FROM vivero_riegos r
       LEFT JOIN vivero_usuarios u ON u.id = r.usuario_id
       WHERE r.lote_id = ? ORDER BY r.fecha DESC, r.id DESC LIMIT 50`, [loteId]);
    const [fertilizaciones] = await db.query(
      `SELECT f.*, u.nombre AS usuario_nombre FROM vivero_fertilizaciones f
       LEFT JOIN vivero_usuarios u ON u.id = f.usuario_id
       WHERE f.lote_id = ? ORDER BY f.fecha DESC, f.id DESC LIMIT 50`, [loteId]);
    const [sanidad] = await db.query(
      `SELECT s.*, u.nombre AS usuario_nombre FROM vivero_sanidad s
       LEFT JOIN vivero_usuarios u ON u.id = s.usuario_id
       WHERE s.lote_id = ? ORDER BY s.fecha DESC, s.id DESC LIMIT 50`, [loteId]);
    const [despachos] = await db.query(
      `SELECT d.*, u.nombre AS usuario_nombre FROM vivero_despachos d
       LEFT JOIN vivero_usuarios u ON u.id = d.usuario_id
       WHERE d.lote_id = ? ORDER BY d.fecha DESC, d.id DESC`, [loteId]);

    // ── Estadísticas de producción ──
    const porEtapa = {};
    etapas.forEach(e => { porEtapa[e.etapa] = e; }); // última fila de cada etapa (por orden ASC, se pisa con la más nueva)

    const cantidadInicial = lote.cantidad_semilla ?? lote.cantidad ?? null;
    const cantidadGerminada = porEtapa.germinacion?.cantidad_ok ?? null;
    const cantidadRepique   = porEtapa.repique?.cantidad_ok ?? null;
    const totalDespachado   = despachos.reduce((acc, d) => acc + d.cantidad, 0);
    const totalPerdido      = etapas.reduce((acc, e) => acc + (e.cantidad_perdida || 0), 0);

    const stats = {
      cantidad_inicial:        cantidadInicial,
      cantidad_actual:         lote.cantidad_actual,
      total_perdido:           totalPerdido,
      total_despachado:        totalDespachado,
      porcentaje_supervivencia: cantidadInicial ? Math.round((lote.cantidad_actual / cantidadInicial) * 1000) / 10 : null,
      porcentaje_germinacion:  (cantidadInicial && cantidadGerminada != null) ? Math.round((cantidadGerminada / cantidadInicial) * 1000) / 10 : null,
      porcentaje_prendimiento: (cantidadGerminada && cantidadRepique != null) ? Math.round((cantidadRepique / cantidadGerminada) * 1000) / 10 : null,
      ultimo_muestreo:         muestreos[0] || null,
      alertas_sanidad_activas: sanidad.filter(s => s.severidad === 'alta').length,
    };

    res.json({ lote, etapas, muestreos, riegos, fertilizaciones, sanidad, despachos, stats });
  } catch (err) {
    console.error('[lotes/detalle]', err.message);
    res.status(500).json({ error: 'Error al obtener el detalle del lote' });
  }
});

// ── Etapas del lote ─────────────────────────────────────────
router.post('/lotes/:id/etapas', requireAuth, async (req, res) => {
  const { etapa, fecha, cantidad_ok, cantidad_perdida, causa_perdida, observaciones } = req.body;
  if (!ORDEN_ETAPAS.includes(etapa)) return res.status(400).json({ error: 'Etapa inválida' });
  if (!fecha) return res.status(400).json({ error: 'La fecha es requerida' });
  const perdida = Number(cantidad_perdida) || 0;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO vivero_lote_etapas (lote_id, etapa, fecha, cantidad_ok, cantidad_perdida, causa_perdida, observaciones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, etapa, fecha, cantidad_ok ?? null, perdida, causa_perdida || null, observaciones || null, req.session.usuario.id]
    );
    // Actualizar estado del lote: avanza la etapa actual y descuenta bajas del stock vivo
    await conn.query(
      `UPDATE vivero_lotes
       SET etapa_actual = ?, fecha_etapa_actual = ?,
           cantidad_actual = GREATEST(COALESCE(cantidad_actual,0) - ?, 0)
       WHERE id = ?`,
      [etapa, fecha, perdida, req.params.id]
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('[lotes/etapas/post]', err.message);
    res.status(500).json({ error: 'Error al registrar la etapa' });
  } finally {
    conn.release();
  }
});

// ── Muestreos de crecimiento ─────────────────────────────────
router.post('/lotes/:id/muestreos', requireAuth, async (req, res) => {
  const { fecha, n_muestras, altura_prom_cm, altura_min_cm, altura_max_cm, diametro_prom_mm, vigor, observaciones } = req.body;
  if (!fecha) return res.status(400).json({ error: 'La fecha es requerida' });
  try {
    await db.query(
      `INSERT INTO vivero_lote_muestreos
       (lote_id, fecha, n_muestras, altura_prom_cm, altura_min_cm, altura_max_cm, diametro_prom_mm, vigor, observaciones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, fecha, n_muestras || 10, altura_prom_cm ?? null, altura_min_cm ?? null,
       altura_max_cm ?? null, diametro_prom_mm ?? null, vigor || null, observaciones || null, req.session.usuario.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[lotes/muestreos/post]', err.message);
    res.status(500).json({ error: 'Error al registrar el muestreo' });
  }
});

// ── Riego ─────────────────────────────────────────────────────
router.post('/lotes/:id/riegos', requireAuth, async (req, res) => {
  const { fecha, volumen_litros, sistema, duracion_min, observaciones } = req.body;
  if (!fecha) return res.status(400).json({ error: 'La fecha es requerida' });
  try {
    await db.query(
      `INSERT INTO vivero_riegos (lote_id, fecha, volumen_litros, sistema, duracion_min, observaciones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, fecha, volumen_litros ?? null, sistema || null, duracion_min ?? null, observaciones || null, req.session.usuario.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[lotes/riegos/post]', err.message);
    res.status(500).json({ error: 'Error al registrar el riego' });
  }
});

// ── Fertilización ──────────────────────────────────────────
router.post('/lotes/:id/fertilizaciones', requireAuth, async (req, res) => {
  const { fecha, producto, tipo_aplicacion, dosis, formula_npk, observaciones } = req.body;
  if (!fecha || !producto?.trim()) return res.status(400).json({ error: 'Fecha y producto son requeridos' });
  try {
    await db.query(
      `INSERT INTO vivero_fertilizaciones (lote_id, fecha, producto, tipo_aplicacion, dosis, formula_npk, observaciones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, fecha, producto.trim(), tipo_aplicacion || null, dosis || null, formula_npk || null, observaciones || null, req.session.usuario.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[lotes/fertilizaciones/post]', err.message);
    res.status(500).json({ error: 'Error al registrar la fertilización' });
  }
});

// ── Sanidad (plagas / enfermedades) ──────────────────────────
router.post('/lotes/:id/sanidad', requireAuth, async (req, res) => {
  const { fecha, tipo, agente, severidad, tratamiento, dosis, periodo_carencia_dias, observaciones } = req.body;
  if (!fecha || !tipo) return res.status(400).json({ error: 'Fecha y tipo son requeridos' });
  try {
    await db.query(
      `INSERT INTO vivero_sanidad
       (lote_id, fecha, tipo, agente, severidad, tratamiento, dosis, periodo_carencia_dias, observaciones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, fecha, tipo, agente || null, severidad || 'baja', tratamiento || null,
       dosis || null, periodo_carencia_dias ?? null, observaciones || null, req.session.usuario.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[lotes/sanidad/post]', err.message);
    res.status(500).json({ error: 'Error al registrar el evento sanitario' });
  }
});

// ── Despacho / destino final ─────────────────────────────────
router.post('/lotes/:id/despachos', requireAuth, requireAdmin, async (req, res) => {
  const { fecha, cantidad, tipo_destino, destino, responsable, observaciones } = req.body;
  if (!fecha || !cantidad || !destino?.trim()) return res.status(400).json({ error: 'Fecha, cantidad y destino son requeridos' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[lote]] = await conn.query('SELECT cantidad_actual FROM vivero_lotes WHERE id = ? LIMIT 1', [req.params.id]);
    if (!lote) { await conn.rollback(); return res.status(404).json({ error: 'Lote no encontrado' }); }
    if (Number(cantidad) > (lote.cantidad_actual || 0)) {
      await conn.rollback();
      return res.status(400).json({ error: `Solo hay ${lote.cantidad_actual || 0} plantas disponibles en este lote` });
    }
    await conn.query(
      `INSERT INTO vivero_despachos (lote_id, fecha, cantidad, tipo_destino, destino, responsable, observaciones, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, fecha, cantidad, tipo_destino || 'otro', destino.trim(), responsable || null, observaciones || null, req.session.usuario.id]
    );
    await conn.query(
      `UPDATE vivero_lotes SET cantidad_actual = cantidad_actual - ?, etapa_actual = 'despacho', fecha_etapa_actual = ? WHERE id = ?`,
      [cantidad, fecha, req.params.id]
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('[lotes/despachos/post]', err.message);
    res.status(500).json({ error: 'Error al registrar el despacho' });
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════
// MEDICIONES AMBIENTALES
// ════════════════════════════════════════════════════════
router.get('/mediciones', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM vivero_mediciones_detalle ORDER BY created_at DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error al obtener mediciones' }); }
});

router.post('/mediciones', requireAuth, async (req, res) => {
  const { temperatura, humedad_relativa, humedad_sustrato, ph, fertilizante, sustrato, lote_id, observaciones } = req.body;
  if (temperatura == null && humedad_relativa == null && ph == null) {
    return res.status(400).json({ error: 'Ingresá al menos un valor' });
  }
  try {
    await db.query(
      `INSERT INTO vivero_mediciones
       (usuario_id, lote_id, temperatura, humedad_relativa, humedad_sustrato, ph, fertilizante, sustrato, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.session.usuario.id, lote_id||null, temperatura??null, humedad_relativa??null,
       humedad_sustrato??null, ph??null, fertilizante||null, sustrato||null, observaciones||null]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Error al guardar medición' }); }
});

module.exports = router;
