'use strict';

const { createApp } = require('./src/app');
const { dbFile, UPLOAD_DIR } = require('./src/db');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

createApp().listen(PORT, HOST, () => {
  console.log(`Bytewall escuchando en http://localhost:${PORT}`);
  console.log(`Base de datos: ${dbFile}`);
  console.log(`Evidencias:    ${UPLOAD_DIR}`);
});
