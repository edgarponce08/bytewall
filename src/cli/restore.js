'use strict';

/**
 * Restauracion de un respaldo: `npm run restore -- <carpeta> --confirmar`
 *
 * Sustituye la base y las evidencias actuales. El servidor debe estar
 * detenido. Los datos que se reemplazan no se borran: se mueven a un
 * directorio "reemplazado-<fecha>" al lado, por si la restauracion fue un
 * error.
 */

require('../env').loadEnvFile();

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const source = args.find((arg) => !arg.startsWith('--'));
const confirmed = args.includes('--confirmar');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(DATA_DIR, 'uploads');
const dbFile = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(DATA_DIR, 'bytewall.db');

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

if (!source) {
  console.log('Uso: npm run restore -- <carpeta-del-respaldo> --confirmar');
  console.log('\nEl servidor debe estar detenido antes de restaurar.');
  process.exit(1);
}

const backupDir = path.resolve(source);
const backupDb = path.join(backupDir, 'bytewall.db');
const backupUploads = path.join(backupDir, 'uploads');

if (!fs.existsSync(backupDb)) fail(`No se encontro ${backupDb}.`);
if (!fs.existsSync(backupUploads)) fail(`No se encontro ${backupUploads}.`);

if (!confirmed) {
  console.log(`Se restaurara desde: ${backupDir}`);
  console.log(`  Base de datos ->  ${dbFile}`);
  console.log(`  Evidencias    ->  ${UPLOAD_DIR}`);
  console.log('\nLos datos actuales se moveran a un directorio "reemplazado-<fecha>".');
  console.log('Detenga el servidor y repita el comando agregando --confirmar.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const shelf = path.join(DATA_DIR, `reemplazado-${stamp}`);
fs.mkdirSync(shelf, { recursive: true });

// Los archivos -wal y -shm sobrantes harian que SQLite lea estado viejo.
for (const suffix of ['', '-wal', '-shm']) {
  const current = `${dbFile}${suffix}`;
  if (fs.existsSync(current)) fs.renameSync(current, path.join(shelf, path.basename(current)));
}
if (fs.existsSync(UPLOAD_DIR)) {
  fs.renameSync(UPLOAD_DIR, path.join(shelf, 'uploads'));
}

fs.mkdirSync(path.dirname(dbFile), { recursive: true });
fs.copyFileSync(backupDb, dbFile);
fs.cpSync(backupUploads, UPLOAD_DIR, { recursive: true });

console.log(`Restauracion completa desde ${backupDir}.`);
console.log(`Los datos anteriores quedaron en ${shelf}`);
console.log('Puede volver a iniciar el servidor.');
