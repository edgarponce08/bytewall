'use strict';

const express = require('express');
const { db } = require('../db');
const { HttpError, cleanText, parseId } = require('../validation');
const { hashPassword, assertStrongPassword, destroyAllSessions, requireAdmin } = require('../auth');

const router = express.Router();

const LIST_PEOPLE = `
  SELECT p.id,
         p.name,
         p.email,
         p.role,
         p.active,
         p.access_level,
         (p.password_hash IS NOT NULL)                                   AS has_login,
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

const findById = (id) =>
  db
    .prepare(
      `SELECT id, name, email, role, active, access_level,
              (password_hash IS NOT NULL) AS has_login, created_at
         FROM people WHERE id = ?`
    )
    .get(id);

function parseAccessLevel(value) {
  const level = String(value ?? '').trim().toLowerCase();
  if (!['admin', 'member'].includes(level)) {
    throw new HttpError(400, 'El nivel de acceso debe ser "admin" o "member".');
  }
  return level;
}

function assertEmailAvailable(email, exceptId = null) {
  if (!email) return;
  const found = db
    .prepare('SELECT id FROM people WHERE email = ? COLLATE NOCASE AND id <> ?')
    .get(email, exceptId ?? 0);
  if (found) throw new HttpError(409, `El correo "${email}" ya esta registrado.`);
}

function assertNameAvailable(name, exceptId = null) {
  const found = db
    .prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE AND id <> ?')
    .get(name, exceptId ?? 0);
  if (found) throw new HttpError(409, `Ya existe una persona llamada "${name}".`);
}

/** Evita quedarse sin ningun administrador con acceso. */
function assertNotLastAdmin(personId) {
  const admins = db
    .prepare(
      `SELECT COUNT(*) AS total FROM people
        WHERE access_level = 'admin' AND active = 1 AND password_hash IS NOT NULL AND id <> ?`
    )
    .get(personId).total;
  if (admins === 0) {
    throw new HttpError(409, 'Debe existir al menos un administrador con acceso.');
  }
}

// Cualquier persona autenticada consulta el directorio; el resto es de admin.
router.get('/', (req, res) => {
  res.json(db.prepare(LIST_PEOPLE).all());
});

router.post('/', requireAdmin, (req, res) => {
  const name = cleanText(req.body.name, { field: 'nombre', max: 120, required: true });
  const email = cleanText(req.body.email, { field: 'correo', max: 160 }).toLowerCase();
  const role = cleanText(req.body.role, { field: 'puesto', max: 120 });
  const accessLevel = req.body.access_level ? parseAccessLevel(req.body.access_level) : 'member';
  const password = req.body.password ? assertStrongPassword(req.body.password) : null;

  if (password && !email) {
    throw new HttpError(400, 'Para dar acceso se necesita un correo (es el usuario).');
  }
  assertNameAvailable(name);
  assertEmailAvailable(email);

  const info = db
    .prepare(
      `INSERT INTO people (name, email, role, access_level, password_hash)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, email || null, role || null, accessLevel, password ? hashPassword(password) : null);

  res.status(201).json(findById(info.lastInsertRowid));
});

router.patch('/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(id);
  if (!person) throw new HttpError(404, 'Persona no encontrada.');

  const name = req.body.name === undefined
    ? person.name
    : cleanText(req.body.name, { field: 'nombre', max: 120, required: true });
  const email = req.body.email === undefined
    ? person.email
    : cleanText(req.body.email, { field: 'correo', max: 160 }).toLowerCase() || null;
  const role = req.body.role === undefined
    ? person.role
    : cleanText(req.body.role, { field: 'puesto', max: 120 }) || null;
  const accessLevel = req.body.access_level === undefined
    ? person.access_level
    : parseAccessLevel(req.body.access_level);
  const active = req.body.active === undefined ? person.active : (req.body.active ? 1 : 0);

  if (name !== person.name) assertNameAvailable(name, id);
  if (email !== person.email) assertEmailAvailable(email, id);

  // Quitarle el acceso o el rol al ultimo administrador dejaria la app cerrada.
  if ((accessLevel !== 'admin' || !active) && person.access_level === 'admin') {
    assertNotLastAdmin(id);
  }

  const passwordHash = req.body.password === undefined || req.body.password === ''
    ? person.password_hash
    : hashPassword(assertStrongPassword(req.body.password));

  if (passwordHash && !email) {
    throw new HttpError(400, 'Para dar acceso se necesita un correo (es el usuario).');
  }

  db.prepare(
    `UPDATE people
        SET name = ?, email = ?, role = ?, access_level = ?, active = ?, password_hash = ?
      WHERE id = ?`
  ).run(name, email, role, accessLevel, active, passwordHash, id);

  // Un cambio de contrasena o una baja invalidan las sesiones abiertas.
  if (passwordHash !== person.password_hash || !active) destroyAllSessions(id);

  res.json(findById(id));
});

/**
 * Al eliminar una persona sus proyectos quedan sin responsable
 * (ON DELETE SET NULL), nunca se borran en cascada.
 */
router.delete('/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (id === req.user.id) throw new HttpError(409, 'No puede eliminar su propia cuenta.');

  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(id);
  if (!person) throw new HttpError(404, 'Persona no encontrada.');
  if (person.access_level === 'admin') assertNotLastAdmin(id);

  db.prepare('DELETE FROM people WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
