'use strict';

// El .env se carga antes de cualquier modulo que lea process.env.
require('./src/env').loadEnvFile();

const { createApp } = require('./src/app');
const { db, dbFile, UPLOAD_DIR } = require('./src/db');
const { purgeExpiredSessions } = require('./src/auth');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const server = createApp().listen(PORT, HOST, () => {
  console.log(`Bytewall escuchando en http://localhost:${PORT}`);
  console.log(`Base de datos: ${dbFile}`);
  console.log(`Evidencias:    ${UPLOAD_DIR}`);
  if (process.env.COOKIE_SECURE !== '1') {
    console.log(
      'Aviso: COOKIE_SECURE no esta activo. Uselo en 1 al servir por HTTPS.'
    );
  }
});

// Las sesiones vencidas se limpian cada tanto, no solo al iniciar sesion.
const purgeTimer = setInterval(purgeExpiredSessions, PURGE_INTERVAL_MS);
purgeTimer.unref();

/**
 * Cierre ordenado: deja de aceptar conexiones y cierra SQLite para que el
 * WAL quede consolidado. Al segundo aviso se sale de inmediato.
 */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  console.log(`\n${signal} recibido, cerrando…`);

  clearInterval(purgeTimer);
  const forceExit = setTimeout(() => {
    console.error('Cierre forzado tras 10 s de espera.');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close(() => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (err) {
      console.error('Error al cerrar la base de datos:', err);
    }
    console.log('Listo.');
    process.exit(0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}
