'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

const { UPLOAD_DIR } = require('./db');
const { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } = require('./constants');
const { HttpError } = require('./validation');

/** Extension normalizada (sin punto, minusculas) de un nombre de archivo. */
function extensionOf(filename) {
  return path.extname(String(filename || '')).replace('.', '').toLowerCase();
}

function isAllowedFile(filename) {
  return Object.hasOwn(ALLOWED_EXTENSIONS, extensionOf(filename));
}

/**
 * El nombre en disco lo genera el servidor (uuid + extension validada),
 * de modo que el nombre original del usuario nunca toca el sistema de archivos.
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    cb(null, `${crypto.randomUUID()}.${extensionOf(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!isAllowedFile(file.originalname)) {
      cb(
        new HttpError(
          400,
          `Formato no permitido. Se aceptan: ${Object.keys(ALLOWED_EXTENSIONS).join(', ')}.`
        )
      );
      return;
    }
    cb(null, true);
  },
});

/** Ruta absoluta de un archivo guardado, blindada contra path traversal. */
function resolveStoredPath(storedName) {
  const resolved = path.resolve(UPLOAD_DIR, path.basename(String(storedName)));
  if (!resolved.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
    throw new HttpError(400, 'Ruta de archivo invalida.');
  }
  return resolved;
}

function removeStoredFile(storedName) {
  try {
    fs.unlinkSync(resolveStoredPath(storedName));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = {
  upload,
  extensionOf,
  isAllowedFile,
  resolveStoredPath,
  removeStoredFile,
  MAX_UPLOAD_MB,
};
