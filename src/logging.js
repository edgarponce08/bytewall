'use strict';

const SKIP = /^\/(css|js|favicon)/;

/**
 * Registro de una linea por peticion: fecha, metodo, ruta, codigo, duracion y
 * usuario. No se registran cuerpos ni cabeceras, para no filtrar contrasenas.
 */
function requestLogger(req, res, next) {
  if (SKIP.test(req.path)) return next();

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const user = req.user ? `#${req.user.id}` : '-';
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.originalUrl} ` +
        `${res.statusCode} ${ms.toFixed(1)}ms user=${user}`
    );
  });
  next();
}

module.exports = { requestLogger };
