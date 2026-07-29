'use strict';

const fs = require('node:fs');
const express = require('express');

const { db, logActivity } = require('../db');
const { ALLOWED_EXTENSIONS } = require('../constants');
const { upload, extensionOf, resolveStoredPath, removeStoredFile } = require('../storage');
const {
  HttpError,
  cleanText,
  parseId,
  parseOptionalId,
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

/**
 * Carga de evidencia (multipart/form-data).
 * Campos: file, note, uploader_id, progress (opcional: actualiza el avance).
 */
projectAttachments.post('/', upload.single('file'), (req, res) => {
  const projectId = parseId(req.params.projectId, 'projectId');
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);

  if (!project) {
    if (req.file) removeStoredFile(req.file.filename);
    throw new HttpError(404, 'Proyecto no encontrado.');
  }
  if (!req.file) throw new HttpError(400, 'Adjunte un archivo de evidencia.');

  try {
    const note = cleanText(req.body.note, { field: 'nota', max: 1000 });
    const uploaderId = parseOptionalId(req.body.uploader_id, 'uploader_id');
    if (uploaderId && !db.prepare('SELECT id FROM people WHERE id = ?').get(uploaderId)) {
      throw new HttpError(400, 'La persona que sube la evidencia no existe.');
    }
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
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; ` +
      `filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`
  );
  res.sendFile(filePath);
});

attachments.delete('/:id', (req, res) => {
  const attachment = requireAttachment(parseId(req.params.id));
  const actorId = parseOptionalId(req.body?.actor_id, 'actor_id');

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
