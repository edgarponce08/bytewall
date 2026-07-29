'use strict';

const express = require('express');
const { db } = require('../db');
const { HttpError, cleanText, parseId } = require('../validation');

const router = express.Router();

const LIST_PEOPLE = `
  SELECT p.id,
         p.name,
         p.email,
         p.role,
         p.active,
         p.created_at,
         COUNT(pr.id)                                                    AS total_projects,
         SUM(CASE WHEN pr.status = 'in_progress' THEN 1 ELSE 0 END)      AS in_progress,
         SUM(CASE WHEN pr.status = 'hold'        THEN 1 ELSE 0 END)      AS hold,
         SUM(CASE WHEN pr.status = 'complete'    THEN 1 ELSE 0 END)      AS complete,
         COALESCE(ROUND(AVG(pr.progress)), 0)                            AS avg_progress
    FROM people p
    LEFT JOIN projects pr ON pr.assignee_id = p.id
   GROUP BY p.id
   ORDER BY p.name COLLATE NOCASE`;

router.get('/', (req, res) => {
  res.json(db.prepare(LIST_PEOPLE).all());
});

router.post('/', (req, res) => {
  const name = cleanText(req.body.name, { field: 'nombre', max: 120, required: true });
  const email = cleanText(req.body.email, { field: 'correo', max: 160 });
  const role = cleanText(req.body.role, { field: 'puesto', max: 120 });

  const duplicate = db
    .prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE')
    .get(name);
  if (duplicate) throw new HttpError(409, `Ya existe una persona llamada "${name}".`);

  const info = db
    .prepare('INSERT INTO people (name, email, role) VALUES (?, ?, ?)')
    .run(name, email || null, role || null);

  res.status(201).json(db.prepare('SELECT * FROM people WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(id);
  if (!person) throw new HttpError(404, 'Persona no encontrada.');

  const name = req.body.name === undefined
    ? person.name
    : cleanText(req.body.name, { field: 'nombre', max: 120, required: true });
  const email = req.body.email === undefined
    ? person.email
    : cleanText(req.body.email, { field: 'correo', max: 160 }) || null;
  const role = req.body.role === undefined
    ? person.role
    : cleanText(req.body.role, { field: 'puesto', max: 120 }) || null;
  const active = req.body.active === undefined ? person.active : (req.body.active ? 1 : 0);

  if (name !== person.name) {
    const duplicate = db
      .prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE AND id <> ?')
      .get(name, id);
    if (duplicate) throw new HttpError(409, `Ya existe una persona llamada "${name}".`);
  }

  db.prepare('UPDATE people SET name = ?, email = ?, role = ?, active = ? WHERE id = ?')
    .run(name, email, role, active, id);

  res.json(db.prepare('SELECT * FROM people WHERE id = ?').get(id));
});

/**
 * Al eliminar una persona sus proyectos quedan sin responsable
 * (ON DELETE SET NULL), nunca se borran en cascada.
 */
router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  const info = db.prepare('DELETE FROM people WHERE id = ?').run(id);
  if (info.changes === 0) throw new HttpError(404, 'Persona no encontrada.');
  res.json({ ok: true });
});

module.exports = router;
