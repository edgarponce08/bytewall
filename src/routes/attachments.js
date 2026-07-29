'use strict';

const fs = require('node:fs');
const express = require('express');

const { db, logActivity } = require('../db');
const { ALLOWED_EXTENSIONS } = require('../constants');
const { upload, extensionOf, resolveStoredPath, removeStoredFile } = require('../storage');
const { assertCanReport } = require('../policy');
const {
  HttpError,
  cleanText,
  parseId,
  parseProgress,
} = require('../validation');

/** Router anidado en /api/projects/:projectId/attachments */
const projectAttachments = express.Router({ mergeParams: true });

projectAttachments.get('/', (req, res) => {
  const projectId = parseId(req.params.projectId, 'projectId');
  res.json(
    db
      .prepare(
        `SELECT a.id, a.original_name, a.extension, a.mime_type, a.size_bytes,
                a.note, a.created_at, a.uploader_id, pe.name AS uploader_name
           FROM attachments a
           LEFT JOIN people pe ON pe.id = a.uploader_id
          WHERE a.project_id = ?
          ORDER BY a.id DESC`
      )
      .all(projectId)
  );
});

/** Se valida el permiso antes de multer para no escribir archivos en vano. */
function authorizeUpload(req, res, next) {
  try {
    const project = db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(parseId(req.params.projectId, 'projectId'));
    if (!project) throw new HttpError(404, 'Proyecto no encontrado.');
    assertCanReport(req.user, project);
    req.project = project;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Carga de evidencia (multipart/form-data).
 * Campos: file, note, progress (opcional: actualiza el avance).
 * El autor se toma de la sesion, no del cliente.
 */
projectAttachments.post('/', authorizeUpload, upload.single('file'), (req, res) => {
  const project = req.project;
  const projectId = project.id;

  if (!req.file) throw new HttpError(400, 'Adjunte un archivo de evidencia.');

  try {
    const note = cleanText(req.body.note, { field: 'nota', max: 1000 });
    const uploaderId = req.user.id;
    const progress = req.body.progress === undefined || req.body.progress === ''
      ? null
      : parseProgress(req.body.progress);

    const extension = extensionOf(req.file.originalname);
    const save = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO attachments
             (project_id, uploader_id, stored_name, original_name, extension, mime_type, size_bytes, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          projectId,
          uploaderId,
          req.file.filename,
          req.file.originalname,
          extension,
          req.file.mimetype || ALLOWED_EXTENSIONS[extension],
          req.file.size,
          note
        );

      logActivity(
        projectId,
        uploaderId,
        'evidence',
        `Evidencia adjunta: ${req.file.originalname}${note ? ` — ${note}` : ''}`
      );

      if (progress !== null && progress !== project.progress) {
        db.prepare(
          `UPDATE projects SET progress = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(progress, projectId);
        logActivity(projectId, uploaderId, 'progress', `Avance: ${project.progress}% -> ${progress}%.`);
      } else {
        db.prepare(`UPDATE projects SET updated_at = datetime('now') WHERE id = ?`).run(projectId);
      }

      return Number(info.lastInsertRowid);
    });

    const attachmentId = save();
    res.status(201).json(
      db
        .prepare(
          `SELECT a.id, a.original_name, a.extension, a.mime_type, a.size_bytes,
                  a.note, a.created_at, a.uploader_id, pe.name AS uploader_name
             FROM attachments a
             LEFT JOIN people pe ON pe.id = a.uploader_id
            WHERE a.id = ?`
        )
        .get(attachmentId)
    );
  } catch (err) {
    // No dejar archivos huerfanos si la validacion falla despues de la carga.
    removeStoredFile(req.file.filename);
    throw err;
  }
});

/** Router montado en /api/attachments */
const attachments = express.Router();

function requireAttachment(id) {
  const attachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  if (!attachment) throw new HttpError(404, 'Evidencia no encontrada.');
  return attachment;
}

/** Descarga o vista previa (?inline=1) de una evidencia. */
attachments.get('/:id/file', (req, res) => {
  const attachment = requireAttachment(parseId(req.params.id));
  const filePath = resolveStoredPath(attachment.stored_name);
  if (!fs.existsSync(filePath)) throw new HttpError(410, 'El archivo ya no esta disponible.');

  const inline = req.query.inline === '1';
  const asciiName = attachment.original_name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
  // Un adjunto servido en linea no debe poder ejecutar nada en el origen.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; ` +
      `filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`
  );
  res.sendFile(filePath);
});

attachments.delete('/:id', (req, res) => {
  const attachment = requireAttachment(parseId(req.params.id));
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(attachment.project_id);
  assertCanReport(req.user, project);
  const actorId = req.user.id;

  db.transaction(() => {
    db.prepare('DELETE FROM attachments WHERE id = ?').run(attachment.id);
    logActivity(
      attachment.project_id,
      actorId,
      'evidence_removed',
      `Evidencia eliminada: ${attachment.original_name}`
    );
  })();

  removeStoredFile(attachment.stored_name);
  res.json({ ok: true });
});

module.exports = { projectAttachments, attachments };
