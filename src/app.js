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
const { attachUser, requireAuth, sameOriginOnly, ensureBootstrapAdmin } = require('./auth');
const authRoutes = require('./routes/auth');
const peopleRoutes = require('./routes/people');
const projectRoutes = require('./routes/projects');
const { projectAttachments, attachments } = require('./routes/attachments');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp({ bootstrap = true, quietBootstrap = false } = {}) {
  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY === '1');

  if (bootstrap) ensureBootstrapAdmin({ quiet: quietBootstrap });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(attachUser);
  app.use(sameOriginOnly);

  // Unica seccion abierta: iniciar sesion.
  app.use('/api/auth', authRoutes);

  // De aqui en adelante todo exige sesion valida.
  app.use('/api', requireAuth);

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

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Recurso no encontrado.' });
  });

  // La interfaz solo se entrega con sesion iniciada.
  const sendApp = (req, res) => {
    if (!req.user) return res.redirect('/login.html');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  };
  app.get('/', sendApp);
  app.get('/index.html', sendApp);
  app.get('/login.html', (req, res, next) => {
    if (req.user) return res.redirect('/');
    next();
  });

  app.use(express.static(PUBLIC_DIR, { index: false }));

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

module.exports = { createApp, PUBLIC_DIR };
