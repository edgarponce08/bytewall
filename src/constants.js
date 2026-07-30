'use strict';

const STATUSES = ['in_progress', 'hold', 'complete'];

const STATUS_LABELS = {
  in_progress: 'En progreso',
  hold: 'En espera',
  complete: 'Completado',
};

const PRIORITIES = ['baja', 'media', 'alta'];

/**
 * Formatos de evidencia aceptados.
 * La clave es la extension (sin punto) y el valor su MIME canonico.
 * "xmls" del requerimiento se cubre con xlsx/xls (Excel) y xml.
 */
const ALLOWED_EXTENSIONS = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  xml: 'application/xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 25);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

module.exports = {
  STATUSES,
  STATUS_LABELS,
  PRIORITIES,
  ALLOWED_EXTENSIONS,
  MAX_UPLOAD_MB,
  MAX_UPLOAD_BYTES,
};
