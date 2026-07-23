/**
 * Clima y alertas oficiales para Vivero Lemú.
 * Área SMN 797: Cordillera Chubut Norte / Cordillera de Cushamen.
 */
const express = require('express');
const https = require('https');
const router = express.Router();

const SMN_AREA_ID = 797;
const SMN_AREA_PAGE = `https://ws2.smn.gob.ar/alertas_area?loc=${SMN_AREA_ID}`;
const SMN_API = 'https://ws1.smn.gob.ar/v1';
const EVENTOS = new Map([
  [37, 'lluvia'], [39, 'viento'], [40, 'niebla'], [41, 'tormenta'],
  [42, 'nevada'], [45, 'ceniza volcánica'], [46, 'polvo'],
  [47, 'viento zonda'], [54, 'humo'],
]);
const PERIODOS = {
  early_morning: 'madrugada', morning: 'mañana', afternoon: 'tarde', night: 'noche',
};
const NIVELES = {
  2: { nombre: 'advertencia', tipo: 'AC' },
  3: { nombre: 'amarillo', tipo: 'AL' },
  4: { nombre: 'naranja', tipo: 'AL' },
  5: { nombre: 'rojo', tipo: 'AL' },
};

function requireAuth(req, res, next) {
  if (!req.session?.usuario) return res.status(401).json({ error: 'No autenticado' });
  next();
}

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'ViveroLemuApp/2.0', ...headers },
    }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`SMN HTTP ${response.statusCode}`));
        }
        resolve(data);
      });
    });
    request.on('error', reject);
    request.setTimeout(8000, () => request.destroy(new Error('Timeout SMN')));
  });
}

async function fetchJSON(url, headers = {}) {
  const text = await fetchText(url, { Accept: 'application/json', ...headers });
  try { return JSON.parse(text); }
  catch { throw new Error('Respuesta JSON inválida del SMN'); }
}

function tokenFromAreaPage(html) {
  const match = html.match(/localStorage\.setItem\(['"]token['"],\s*['"]([^'"]+)['"]\)/);
  if (!match) throw new Error('Token público territorial del SMN no disponible');
  return match[1];
}

function reportFor(payload, eventId, level) {
  const report = (payload.reports || []).find(item => Number(item.event_id) === Number(eventId));
  return report?.levels?.find(item => Number(item.level) === Number(level)) || null;
}

function normalizeAlerts(payload, area) {
  const result = [];
  for (const day of payload.warnings || []) {
    for (const event of day.events || []) {
      const level = Math.max(...Object.values(event.levels || {}).filter(Number.isFinite), 0);
      if (level < 2 || !NIVELES[level]) continue;
      const meta = NIVELES[level];
      const phenomenon = EVENTOS.get(Number(event.id)) || 'fenómeno meteorológico';
      const periods = Object.entries(event.levels || {})
        .filter(([, value]) => Number(value) === level)
        .map(([key]) => PERIODOS[key] || key);
      const report = reportFor(payload, event.id, level);
      result.push({
        tipo: meta.tipo,
        nivel: meta.nombre,
        titulo: `${meta.tipo === 'AL' ? 'Alerta' : 'Advertencia'} ${meta.nombre} por ${phenomenon}`,
        zona: area?.name || 'Cordillera Chubut Norte',
        fecha: day.date,
        periodos: periods,
        vigencia: `${day.date}${periods.length ? ` · ${periods.join(', ')}` : ''}`,
        detalle: report?.description?.trim() || '',
        recomendaciones: report?.instruction?.trim() || '',
        fuente_url: SMN_AREA_PAGE,
      });
    }
  }
  return result;
}

async function fetchAreaAlerts() {
  const html = await fetchText(SMN_AREA_PAGE);
  const auth = { Authorization: `JWT ${tokenFromAreaPage(html)}` };
  const [area, warnings] = await Promise.all([
    fetchJSON(`${SMN_API}/georef/area/${SMN_AREA_ID}?show_geometry=false`, auth),
    fetchJSON(`${SMN_API}/warning/alert/area/${SMN_AREA_ID}`, auth),
  ]);
  return {
    area,
    updated: warnings.updated || null,
    alerts: normalizeAlerts(warnings, area),
  };
}

router.get('/', requireAuth, async (req, res) => {
  const [weatherResult, areaResult] = await Promise.allSettled([
    fetchJSON('https://ws.smn.gob.ar/map_items/weather'),
    fetchAreaAlerts(),
  ]);

  let clima = null;
  if (weatherResult.status === 'fulfilled' && Array.isArray(weatherResult.value)) {
    const localidad = weatherResult.value.find(item =>
      (item.name || item.nombre || '').toLowerCase().includes('esquel'));
    if (localidad) {
      const w = localidad.weather || localidad;
      clima = {
        nombre: localidad.name || localidad.nombre,
        referencia: 'Estación Aeropuerto Esquel (SMN) · referencia regional',
        temperatura: w.temp ?? w.temperatura ?? null,
        temp_max: w.tempMax ?? w.temp_max ?? null,
        temp_min: w.tempMin ?? w.temp_min ?? null,
        humedad: w.humidity ?? w.humedad ?? null,
        viento_vel: w.windSpeed ?? w.viento_velocidad ?? null,
        viento_dir: w.windDirection ?? w.viento_direccion ?? null,
        descripcion: w.weatherDescription ?? w.descripcion ?? null,
        icon: w.weatherIcon ?? w.icono ?? null,
        presion: w.pressure ?? w.presion ?? null,
      };
    }
  }

  const alertsAvailable = areaResult.status === 'fulfilled';
  const areaData = alertsAvailable ? areaResult.value : null;
  if (!alertsAvailable) console.error('[clima/alertas]', areaResult.reason?.message || 'Fuente no disponible');

  res.json({
    ok: true,
    clima,
    alertas: areaData?.alerts || [],
    alertas_disponibles: alertsAvailable,
    alerta_area: areaData?.area?.name || 'Cordillera Chubut Norte',
    alerta_actualizada: areaData?.updated || null,
    alerta_fuente_url: SMN_AREA_PAGE,
    fuente: 'Servicio Meteorológico Nacional',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
module.exports._test = { normalizeAlerts, tokenFromAreaPage };
