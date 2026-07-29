'use strict';

const path = require('node:path');
const express = require('express');
const multer = require('multer');

const {
  STATUSES,
  STATUS_LABELS,
  PRIORITIES,
  ALLOWED_EXTENSIONS,
  MAX_UPLOAD_MB,
} = require('./constants');
const peopleRoutes = require('./routes/people');
const projectRoutes = require('./routes/projects');
const { projectAttachments, attachments } = require('./routes/attachments');

function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.get('/api/config', (req, res) => {
    res.json({
      statuses: STATUSES,
      status_labels: STATUS_LABELS,
      priorities: PRIORITIES,
      allowed_extensions: Object.keys(ALLOWED_EXTENSIONS),
      max_upload_mb: MAX_UPLOAD_MB,
    });
  });

  app.use('/api/people', peopleRoutes);
  app.use('/api/projects/:projectId/attachments', projectAttachments);
  app.use('/api/projects', projectRoutes);
  app.use('/api/attachments', attachments);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Recurso no encontrado.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `El archivo supera el limite de ${MAX_UPLOAD_MB} MB.`
        : `Error al subir el archivo: ${err.message}`;
      return res.status(413).json({ error: message });
    }
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({
      error: status >= 500 ? 'Error interno del servidor.' : err.message,
    });
  });

  return app;
}

module.exports = { createApp };
