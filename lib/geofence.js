'use strict';

class GeofenceError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'GeofenceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function finiteNumber(value, field) {
  if (value === null || value === undefined || value === '') {
    throw new GeofenceError('GEO_INVALID_COORDINATES', `${field} requerida`);
  }
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new GeofenceError('GEO_INVALID_COORDINATES', `${field} inválida`);
  }
  return number;
}

function normalizePoint(input) {
  const latitude = finiteNumber(input?.latitude ?? input?.lat, 'Latitud');
  const longitude = finiteNumber(input?.longitude ?? input?.lng, 'Longitud');
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new GeofenceError('GEO_INVALID_COORDINATES', 'Coordenadas fuera de rango');
  }
  return { latitude, longitude };
}

function distanceMeters(originInput, destinationInput) {
  const origin = normalizePoint(originInput);
  const destination = normalizePoint(destinationInput);
  const radians = degrees => degrees * Math.PI / 180;
  const earthRadius = 6371000;
  const deltaLatitude = radians(destination.latitude - origin.latitude);
  const deltaLongitude = radians(destination.longitude - origin.longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(origin.latitude))
    * Math.cos(radians(destination.latitude))
    * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function readGeofenceConfig(env = process.env) {
  const center = normalizePoint({
    latitude: env.VIVERO_LATITUDE,
    longitude: env.VIVERO_LONGITUDE,
  });
  const radiusMeters = finiteNumber(env.VIVERO_RADIUS_METERS, 'Radio');
  const maxAccuracyMeters = finiteNumber(env.VIVERO_MAX_ACCURACY_METERS, 'Precisión máxima');
  if (radiusMeters <= 0 || maxAccuracyMeters <= 0) {
    throw new GeofenceError('GEO_INVALID_CONFIG', 'Radio y precisión máxima deben ser mayores que cero', 500);
  }
  return {
    siteCode: String(env.VIVERO_SITE_CODE || '').trim(),
    version: String(env.VIVERO_GEOFENCE_VERSION || '').trim(),
    center,
    radiusMeters,
    maxAccuracyMeters,
  };
}

function evaluateGeofence(positionInput, config) {
  const position = normalizePoint(positionInput);
  const accuracyMeters = finiteNumber(
    positionInput?.accuracyMeters ?? positionInput?.accuracy_m ?? positionInput?.precision_m,
    'Precisión GPS'
  );
  if (accuracyMeters <= 0 || accuracyMeters > config.maxAccuracyMeters) {
    throw new GeofenceError(
      'GEO_INSUFFICIENT_ACCURACY',
      'La precisión del GPS no permite validar la ubicación',
      422,
      { accuracyMeters: Math.round(accuracyMeters), maxAccuracyMeters: config.maxAccuracyMeters }
    );
  }
  const measuredDistanceMeters = distanceMeters(position, config.center);
  if (measuredDistanceMeters > config.radiusMeters) {
    throw new GeofenceError(
      'GEO_OUTSIDE_GEOFENCE',
      'La ubicación se encuentra fuera del área autorizada',
      422,
      { distanceMeters: Math.round(measuredDistanceMeters), radiusMeters: config.radiusMeters }
    );
  }
  return {
    ...position,
    accuracyMeters: Math.round(accuracyMeters),
    distanceMeters: Math.round(measuredDistanceMeters),
    siteCode: config.siteCode,
    geofenceVersion: config.version,
  };
}

module.exports = {
  GeofenceError,
  distanceMeters,
  evaluateGeofence,
  normalizePoint,
  readGeofenceConfig,
};
