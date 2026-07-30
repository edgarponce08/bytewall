'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ENV_FILE = path.join(__dirname, '..', '.env');

/**
 * Carga variables desde un archivo .env sin dependencias externas.
 * Nunca sobrescribe lo que ya venga del entorno, para que la linea de
 * comandos y systemd sigan teniendo la ultima palabra.
 */
function loadEnvFile(file = process.env.ENV_FILE || DEFAULT_ENV_FILE) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim().replace(/^export\s+/, '');
    if (!key || Object.hasOwn(process.env, key)) continue;

    let value = line.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);

    process.env[key] = value;
  }
  return true;
}

module.exports = { loadEnvFile, DEFAULT_ENV_FILE };
