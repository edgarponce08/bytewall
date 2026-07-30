'use strict';

/**
 * Respaldo en caliente: `npm run backup [carpeta-destino]`
 *
 * Usa la API de respaldo de SQLite, asi que se puede ejecutar con el servidor
 * encendido sin riesgo de copiar una base a medias (copiar el .db a mano
 * mientras hay escrituras si puede corromperlo).
 */

require('../env').loadEnvFile();

const fs = require('node:fs');
const path = require('node:path');
const { db, DATA_DIR, UPLOAD_DIR, dbFile } = require('../db');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const destinationRoot = path.resolve(
  process.argv[2] || process.env.BACKUP_DIR || path.join(DATA_DIR, '..', 'backups')
);
const destination = path.join(destinationRoot, `bytewall-${stamp}`);

function directorySize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
  }
  return total;
}

const formatMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  fs.mkdirSync(destination, { recursive: true });

  await db.backup(path.join(destination, 'bytewall.db'));

  const uploadsTarget = path.join(destination, 'uploads');
  fs.cpSync(UPLOAD_DIR, uploadsTarget, { recursive: true });

  const files = fs.readdirSync(uploadsTarget).length;
  const total = directorySize(destination);

  console.log(`Respaldo creado en ${destination}`);
  console.log(`  Base de datos: ${path.basename(dbFile)}`);
  console.log(`  Evidencias:    ${files} archivo(s)`);
  console.log(`  Tamano total:  ${formatMb(total)}`);
  console.log('\nPara guardarlo comprimido:');
  console.log(`  tar -czf ${destination}.tar.gz -C ${destinationRoot} ${path.basename(destination)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fallo el respaldo:', err.message);
    process.exit(1);
  });
