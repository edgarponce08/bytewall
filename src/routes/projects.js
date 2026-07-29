'use strict';

const express = require('express');
const { db, logActivity } = require('../db');
const { removeStoredFile } = require('../storage');
const { STATUSES, STATUS_LABELS } = require('../constants');
const {
  HttpError,
  cleanText,
  parseStatus,
  parsePriority,
  parseProgress,
  parseDueDate,
  parseId,
  parseOptionalId,
} = require('../validation');

const router = express.Router();

const PROJECT_COLUMNS = `
         pr.id,
         pr.name,
         pr.description,
         pr.status,
         pr.progress,
         pr.priority,
         pr.due_date,
         pr.assignee_id,
         pr.created_at,
         pr.updated_at,
         pe.name AS assignee_name,
         (SELECT COUNT(*) FROM attachments a WHERE a.project_id = pr.id)     AS evidence_count,
         (SELECT MAX(a.created_at) FROM attachments a WHERE a.project_id = pr.id) AS last_evidence_at`;

function getProject(id) {
  return db
    .prepare(
      `SELECT ${PROJECT_COLUMNS}
         FROM projects pr
         LEFT JOIN people pe ON pe.id = pr.assignee_id
        WHERE pr.id = ?`
    )
    .get(id);
}

function requireProject(id) {
  const project = getProject(id);
  if (!project) throw new HttpError(404, 'Proyecto no encontrado.');
  return project;
}

function assertPersonExists(personId, field) {
  if (personId === null) return;
  const person = db.prepare('SELECT id FROM people WHERE id = ?').get(personId);
  if (!person) throw new HttpError(400, `No existe la persona indicada en "${field}".`);
}

/** GET /api/projects?status=&assignee_id=&q=&sort= */
router.get('/', (req, res) => {
  const filters = [];
  const params = {};

  if (req.query.status) {
    filters.push('pr.status = @status');
    params.status = parseStatus(req.query.status);
  }
  if (req.query.assignee_id === 'none') {
    filters.push('pr.assignee_id IS NULL');
  } else if (req.query.assignee_id) {
    filters.push('pr.assignee_id = @assignee_id');
    params.assignee_id = parseId(req.query.assignee_id, 'assignee_id');
  }
  if (req.query.q) {
    filters.push('(pr.name LIKE @q OR pr.description LIKE @q)');
    params.q = `%${String(req.query.q).trim()}%`;
  }

  const sorts = {
    updated: 'pr.updated_at DESC',
    created: 'pr.created_at DESC',
    name: 'pr.name COLLATE NOCASE ASC',
    progress: 'pr.progress DESC',
    due: 'pr.due_date IS NULL, pr.due_date ASC',
  };
  const orderBy = sorts[req.query.sort] || sorts.updated;
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  res.json(
    db
      .prepare(
        `SELECT ${PROJECT_COLUMNS}
           FROM projects pr
           LEFT JOIN people pe ON pe.id = pr.assignee_id
           ${where}
          ORDER BY ${orderBy}`
      )
      .all(params)
  );
});

/** Resumen para los indicadores del tablero. */
router.get('/stats', (req, res) => {
  const byStatus = db
    .prepare('SELECT status, COUNT(*) AS total FROM projects GROUP BY status')
    .all();
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of byStatus) counts[row.status] = row.total;

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(ROUND(AVG(progress)), 0) AS avg_progress,
              SUM(CASE WHEN due_date IS NOT NULL
                        AND due_date < date('now')
                        AND status <> 'complete' THEN 1 ELSE 0 END) AS overdue
         FROM projects`
    )
    .get();

  const evidence = db.prepare('SELECT COUNT(*) AS total FROM attachments').get();

  res.json({
    by_status: counts,
    total: totals.total,
    avg_progress: totals.avg_progress,
    overdue: totals.overdue || 0,
    evidence_total: evidence.total,
    people: db.prepare('SELECT COUNT(*) AS total FROM people').get().total,
  });
});

/** Detalle con evidencias y bitacora. */
router.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const project = requireProject(id);

  project.attachments = db
    .prepare(
      `SELECT a.id, a.original_name, a.extension, a.mime_type, a.size_bytes,
              a.note, a.created_at, a.uploader_id, pe.name AS uploader_name
         FROM attachments a
         LEFT JOIN people pe ON pe.id = a.uploader_id
        WHERE a.project_id = ?
        ORDER BY a.id DESC`
    )
    .all(id);

  project.activity = db
    .prepare(
      `SELECT ac.id, ac.type, ac.message, ac.created_at, pe.name AS person_name
         FROM activity ac
         LEFT JOIN people pe ON pe.id = ac.person_id
        WHERE ac.project_id = ?
        ORDER BY ac.id DESC
        LIMIT 100`
    )
    .all(id);

  res.json(project);
});

router.post('/', (req, res) => {
  const name = cleanText(req.body.name, { field: 'nombre', max: 160, required: true });
  const description = cleanText(req.body.description, { field: 'descripcion', max: 4000 });
  const status = req.body.status ? parseStatus(req.body.status) : 'in_progress';
  const priority = req.body.priority ? parsePriority(req.body.priority) : 'media';
  const assigneeId = parseOptionalId(req.body.assignee_id, 'assignee_id');
  const dueDate = parseDueDate(req.body.due_date);
  const actorId = parseOptionalId(req.body.actor_id, 'actor_id');
  let progress = req.body.progress === undefined ? 0 : parseProgress(req.body.progress);
  if (status === 'complete' && req.body.progress === undefined) progress = 100;

  assertPersonExists(assigneeId, 'assignee_id');

  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO projects (name, description, status, assignee_id, progress, priority, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(name, description, status, assigneeId, progress, priority, dueDate);

    const projectId = Number(info.lastInsertRowid);
    logActivity(projectId, actorId, 'created', `Proyecto creado con estado "${STATUS_LABELS[status]}".`);
    if (assigneeId) {
      const person = db.prepare('SELECT name FROM people WHERE id = ?').get(assigneeId);
      logActivity(projectId, actorId, 'assign', `Asignado a ${person.name}.`);
    }
    return projectId;
  });

  res.status(201).json(getProject(create()));
});

/** Actualizacion parcial: solo cambian los campos presentes en el body. */
router.patch('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const current = requireProject(id);
  const actorId = parseOptionalId(req.body.actor_id, 'actor_id');

  const next = { ...current };
  const changes = [];

  if (req.body.name !== undefined) {
    next.name = cleanText(req.body.name, { field: 'nombre', max: 160, required: true });
    if (next.name !== current.name) changes.push(['edit', `Nombre actualizado a "${next.name}".`]);
  }
  if (req.body.description !== undefined) {
    next.description = cleanText(req.body.description, { field: 'descripcion', max: 4000 });
    if (next.description !== current.description) changes.push(['edit', 'Descripcion actualizada.']);
  }
  if (req.body.priority !== undefined) {
    next.priority = parsePriority(req.body.priority);
    if (next.priority !== current.priority) {
      changes.push(['edit', `Prioridad: ${current.priority} -> ${next.priority}.`]);
    }
  }
  if (req.body.due_date !== undefined) {
    next.due_date = parseDueDate(req.body.due_date);
    if (next.due_date !== current.due_date) {
      changes.push(['edit', `Fecha compromiso: ${next.due_date || 'sin fecha'}.`]);
    }
  }
  if (req.body.assignee_id !== undefined) {
    next.assignee_id = parseOptionalId(req.body.assignee_id, 'assignee_id');
    assertPersonExists(next.assignee_id, 'assignee_id');
    if (next.assignee_id !== current.assignee_id) {
      const name = next.assignee_id
        ? db.prepare('SELECT name FROM people WHERE id = ?').get(next.assignee_id).name
        : null;
      changes.push(['assign', name ? `Asignado a ${name}.` : 'Proyecto sin responsable.']);
    }
  }
  if (req.body.progress !== undefined) {
    next.progress = parseProgress(req.body.progress);
    if (next.progress !== current.progress) {
      changes.push(['progress', `Avance: ${current.progress}% -> ${next.progress}%.`]);
    }
  }
  if (req.body.status !== undefined) {
    next.status = parseStatus(req.body.status);
    if (next.status !== current.status) {
      changes.push([
        'status',
        `Estado: ${STATUS_LABELS[current.status]} -> ${STATUS_LABELS[next.status]}.`,
      ]);
      // Completar un proyecto implica 100% de avance, salvo que el avance
      // venga explicito en la misma peticion.
      if (next.status === 'complete' && req.body.progress === undefined && next.progress !== 100) {
        changes.push(['progress', `Avance: ${next.progress}% -> 100%.`]);
        next.progress = 100;
      }
    }
  }

  if (changes.length === 0) return res.json(current);

  const update = db.transaction(() => {
    db.prepare(
      `UPDATE projects
          SET name = ?, description = ?, status = ?, assignee_id = ?,
              progress = ?, priority = ?, due_date = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).run(
      next.name,
      next.description,
      next.status,
      next.assignee_id,
      next.progress,
      next.priority,
      next.due_date,
      id
    );
    for (const [type, message] of changes) logActivity(id, actorId, type, message);
  });
  update();

  res.json(getProject(id));
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const files = db.prepare('SELECT stored_name FROM attachments WHERE project_id = ?').all(id);
  const info = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  if (info.changes === 0) throw new HttpError(404, 'Proyecto no encontrado.');
  // Las evidencias se borran en cascada en la BD; los archivos, aqui.
  for (const file of files) removeStoredFile(file.stored_name);
  res.json({ ok: true });
});

module.exports = router;
