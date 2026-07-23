'use strict';

const ROLES = Object.freeze(['director_general', 'administrador_tecnico', 'usuario']);
const ADMIN_ROLES = new Set(['director_general', 'administrador_tecnico']);

function isValidRole(role) {
  return ROLES.includes(role);
}

function canAdminister(role) {
  return ADMIN_ROLES.has(role);
}

module.exports = { ROLES, canAdminister, isValidRole };
