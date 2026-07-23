'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateGeofence, readGeofenceConfig } = require('../lib/geofence');

const env = {
  VIVERO_SITE_CODE: 'TEST_SITE',
  VIVERO_LATITUDE: '-42.9',
  VIVERO_LONGITUDE: '-71.3',
  VIVERO_RADIUS_METERS: '200',
  VIVERO_MAX_ACCURACY_METERS: '100',
  VIVERO_GEOFENCE_VERSION: 'TEST-001',
};

test('acepta una posición precisa dentro del radio', () => {
  const result = evaluateGeofence(
    { lat: -42.9, lng: -71.3, precision_m: 12 },
    readGeofenceConfig(env)
  );
  assert.equal(result.distanceMeters, 0);
  assert.equal(result.siteCode, 'TEST_SITE');
});

test('rechaza una posición exterior aunque el cliente diga que es válida', () => {
  assert.throws(
    () => evaluateGeofence(
      { lat: -42.89, lng: -71.3, precision_m: 10, geo_valida: true, distancia_m: 0 },
      readGeofenceConfig(env)
    ),
    error => error.code === 'GEO_OUTSIDE_GEOFENCE'
  );
});

test('rechaza una precisión insuficiente', () => {
  assert.throws(
    () => evaluateGeofence(
      { lat: -42.9, lng: -71.3, precision_m: 150 },
      readGeofenceConfig(env)
    ),
    error => error.code === 'GEO_INSUFFICIENT_ACCURACY'
  );
});

test('rechaza coordenadas ausentes o fuera de rango', () => {
  assert.throws(
    () => evaluateGeofence({ lat: null, lng: 400, precision_m: 10 }, readGeofenceConfig(env)),
    error => error.code === 'GEO_INVALID_COORDINATES'
  );
  assert.throws(
    () => evaluateGeofence({ lat: null, lng: null, precision_m: 10 }, readGeofenceConfig(env)),
    error => error.code === 'GEO_INVALID_COORDINATES'
  );
});
