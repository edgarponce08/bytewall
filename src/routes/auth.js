'use strict';

const express = require('express');
const { db } = require('../db');
const { HttpError, cleanText } = require('../validation');
const {
  hashPassword,
  verifyPassword,
  assertStrongPassword,
  createSession,
  destroySession,
  destroyAllSessions,
  purgeExpiredSessions,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  registerFailedLogin,
  assertNotThrottled,
  clearAttempts,
} = require('../auth');

const router = express.Router();

const publicUser = (person) => ({
  id: person.id,
  name: person.name,
  email: person.email,
  role: person.role,
  access_level: person.access_level,
});

router.post('/login', (req, res) => {
  const email = cleanText(req.body.email, { field: 'correo', max: 160, required: true }).toLowerCase();
  const password = String(req.body.password ?? '');
  const throttleKey = `${req.ip}|${email}`;

  assertNotThrottled(throttleKey);

  const person = db
    .prepare('SELECT * FROM people WHERE email = ? COLLATE NOCASE AND active = 1')
    .get(email);

  // Mismo mensaje y mismo costo aproximado exista o no la cuenta.
  if (!person || !verifyPassword(password, person.password_hash)) {
    registerFailedLogin(throttleKey);
    throw new HttpError(401, 'Correo o contrasena incorrectos.');
  }

  clearAttempts(throttleKey);
  purgeExpiredSessions();
  setSessionCookie(res, createSession(person.id, req.headers['user-agent']));
  res.json(publicUser(person));
});

router.post('/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

/** Cambio de contrasena propia: cierra las demas sesiones del usuario. */
router.post('/password', requireAuth, (req, res) => {
  const current = String(req.body.current_password ?? '');
  const next = assertStrongPassword(req.body.new_password, 'nueva contrasena');

  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current, person.password_hash)) {
    throw new HttpError(400, 'La contrasena actual no es correcta.');
  }
  if (verifyPassword(next, person.password_hash)) {
    throw new HttpError(400, 'La nueva contrasena debe ser distinta de la actual.');
  }

  db.prepare('UPDATE people SET password_hash = ? WHERE id = ?').run(hashPassword(next), person.id);
  destroyAllSessions(person.id);
  setSessionCookie(res, createSession(person.id, req.headers['user-agent']));
  res.json({ ok: true });
});

module.exports = router;
