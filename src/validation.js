'use strict';

const { STATUSES, PRIORITIES } = require('./constants');

/** Error con codigo HTTP, capturado por el manejador de errores de Express. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanText(value, { field, max, required = false, fallback = '' }) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `El campo "${field}" es obligatorio.`);
    return fallback;
  }
  const text = String(value).trim();
  if (required && text === '') {
    throw new HttpError(400, `El campo "${field}" es obligatorio.`);
  }
  if (max && text.length > max) {
    throw new HttpError(400, `El campo "${field}" excede ${max} caracteres.`);
  }
  return text;
}

function parseStatus(value) {
  const status = String(value ?? '').trim();
  if (!STATUSES.includes(status)) {
    throw new HttpError(400, `Estado invalido. Use: ${STATUSES.join(', ')}.`);
  }
  return status;
}

function parsePriority(value) {
  const priority = String(value ?? '').trim().toLowerCase();
  if (!PRIORITIES.includes(priority)) {
    throw new HttpError(400, `Prioridad invalida. Use: ${PRIORITIES.join(', ')}.`);
  }
  return priority;
}

function parseProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw new HttpError(400, 'El avance debe ser un numero entre 0 y 100.');
  }
  return Math.round(progress);
}

/** Acepta null/'' para "sin fecha"; exige formato YYYY-MM-DD valido. */
function parseDueDate(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new HttpError(400, 'La fecha compromiso debe tener formato YYYY-MM-DD.');
  }
  return date;
}

function parseId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, `El campo "${field}" debe ser un id valido.`);
  }
  return id;
}

/** Igual que parseId pero permite null/'' para desasignar. */
function parseOptionalId(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return parseId(value, field);
}

module.exports = {
  HttpError,
  cleanText,
  parseStatus,
  parsePriority,
  parseProgress,
  parseDueDate,
  parseId,
  parseOptionalId,
};
