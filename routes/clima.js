/**
 * Clima y alertas oficiales para Vivero Lemú.
 * Área SMN 797: Cordillera Chubut Norte / Cordillera de Cushamen.
 */
const express = require('express');
const https = require('https');
const router = express.Router();

const SMN_AREA_ID = 797;
const SMN_LOCATION_ID = 5756;
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

function nurseryRecommendations(phenomenon, level) {
  const common = [
    'Revisar el aviso oficial antes de asignar tareas al aire libre.',
    'Asegurar herramientas, bandejas, macetas y materiales sueltos.',
    'Verificar drenajes, reservas de agua y accesos antes del evento.',
  ];
  const byPhenomenon = {
    viento: [
      'Asegurar coberturas, media sombra, nylon e invernáculos sin trabajar en altura durante ráfagas.',
      'Trasladar plantines y bandejas livianas a sectores protegidos.',
    ],
    'viento zonda': [
      'Suspender labores con fuego, chispas o maquinaria que pueda iniciar incendios.',
      'Proteger plantines de la deshidratación y controlar riego cuando sea seguro.',
    ],
    nevada: [
      'Resguardar plantines sensibles y proteger cañerías, bombas y sistemas de riego contra congelamiento.',
      'No retirar nieve de techos o estructuras mientras persista el evento; inspeccionarlos cuando sea seguro.',
    ],
    lluvia: [
      'Liberar canaletas y desagües, y elevar insumos sensibles a la humedad.',
      'Evitar tareas eléctricas y circulación por sectores anegados.',
    ],
    tormenta: [
      'Suspender tareas a cielo abierto y alejarse de árboles aislados, alambrados y estructuras metálicas.',
      'Desconectar equipos exteriores únicamente si puede hacerse antes del evento y sin riesgo.',
    ],
    niebla: ['Reducir desplazamientos y usar señalización visible en accesos y zonas de circulación.'],
    humo: ['Suspender quemas y tareas que generen polvo; reducir la exposición al aire libre.'],
    'ceniza volcánica': ['Cubrir depósitos de agua, plantines e insumos y evitar remover ceniza en seco.'],
  };
  const byLevel = {
    advertencia: ['Mantener seguimiento periódico de las condiciones y preparar medidas preventivas.'],
    amarillo: ['Informar al equipo y reprogramar las tareas más expuestas si las condiciones empeoran.'],
    naranja: ['Suspender tareas expuestas, resguardar al personal y preparar el cierre preventivo de sectores.'],
    rojo: ['Interrumpir actividades, resguardar al personal y seguir las instrucciones de las autoridades locales.'],
  };
  return [...common, ...(byPhenomenon[phenomenon] || []), ...(byLevel[level] || [])];
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
        recomendaciones_vivero: nurseryRecommendations(phenomenon, meta.nombre),
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
  const [currentResult, forecastResult] = await Promise.allSettled([
    fetchJSON(`${SMN_API}/weather/location/${SMN_LOCATION_ID}`, auth),
    fetchJSON(`${SMN_API}/forecast/location/${SMN_LOCATION_ID}`, auth),
  ]);
  return {
    area,
    updated: warnings.updated || null,
    alerts: normalizeAlerts(warnings, area),
    current: currentResult.status === 'fulfilled' ? currentResult.value : null,
    forecast: forecastResult.status === 'fulfilled' ? forecastResult.value : null,
  };
}

router.get('/', requireAuth, async (req, res) => {
  const [areaResult] = await Promise.allSettled([fetchAreaAlerts()]);

  const alertsAvailable = areaResult.status === 'fulfilled';
  const areaData = alertsAvailable ? areaResult.value : null;
  if (!alertsAvailable) console.error('[clima/alertas]', areaResult.reason?.message || 'Fuente no disponible');
  const current = areaData?.current || null;
  const daily = areaData?.forecast?.forecast?.[0] || null;
  const period = daily?.afternoon || daily?.morning || daily?.night || daily?.early_morning || null;
  const clima = (current || daily) ? {
    nombre: current?.location?.name || 'Esquel',
    referencia: 'Estación Aeropuerto Esquel (SMN) · referencia regional',
    temperatura: current?.temperature ?? period?.temperature ?? null,
    temp_max: daily?.temp_max ?? null,
    temp_min: daily?.temp_min ?? null,
    humedad: current?.humidity ?? period?.humidity ?? null,
    viento_vel: current?.wind?.speed ?? period?.wind?.speed ?? null,
    viento_dir: current?.wind?.direction ?? period?.wind?.direction ?? null,
    descripcion: current?.weather?.description ?? period?.weather?.description ?? null,
    icon: current?.weather?.id ?? period?.weather?.id ?? null,
    presion: current?.pressure ?? null,
    observacion_actualizada: current?.date ?? null,
    pronostico_actualizado: areaData?.forecast?.updated ?? null,
  } : null;

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
module.exports._test = { normalizeAlerts, nurseryRecommendations, tokenFromAreaPage };
