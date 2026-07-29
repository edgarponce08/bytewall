'use strict';

const crypto = require('node:crypto');
const { db } = require('./db');
const { HttpError } = require('./validation');

const COOKIE_NAME = 'bw_session';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const MIN_PASSWORD_LENGTH = 8;

/* ------------------------------ contrasenas ------------------------------ */

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Formato almacenado: scrypt$N$r$p$salt$hash (todo en hex). */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT_PARAMS;
  const derived = crypto.scryptSync(password, salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Comparacion en tiempo constante; nunca revela si el usuario existe. */
function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, N, r, p, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function assertStrongPassword(password, field = 'contrasena') {
  const value = String(password ?? '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `La ${field} debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (value.length > 200) {
    throw new HttpError(400, `La ${field} es demasiado larga.`);
  }
  return value;
}

/* -------------------------------- sesiones -------------------------------- */

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function createSession(personId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO sessions (token_hash, person_id, user_agent, expires_at)
     VALUES (?, ?, ?, datetime('now', ?))`
  ).run(hashToken(token), personId, (userAgent || '').slice(0, 200), `+${SESSION_DAYS} days`);
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function destroyAllSessions(personId) {
  db.prepare('DELETE FROM sessions WHERE person_id = ?').run(personId);
}

function purgeExpiredSessions() {
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
}

/** Devuelve la persona dueña de un token vigente, o null. */
function personForToken(token) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT p.id, p.name, p.email, p.role, p.access_level, p.active
           FROM sessions s
           JOIN people p ON p.id = s.person_id
          WHERE s.token_hash = ?
            AND s.expires_at > datetime('now')
            AND p.active = 1`
      )
      .get(hashToken(token)) || null
  );
}

/* --------------------------------- cookies -------------------------------- */

function parseCookies(header) {
  const jar = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
  };
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_DAYS * 86400000 });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

/* ------------------------------- middleware ------------------------------- */

/** Adjunta req.user cuando hay sesion valida. No bloquea. */
function attachUser(req, res, next) {
  req.sessionToken = parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
  req.user = personForToken(req.sessionToken);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Inicie sesion para continuar.'));
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Inicie sesion para continuar.'));
  if (req.user.access_level !== 'admin') {
    return next(new HttpError(403, 'Se requieren permisos de administrador.'));
  }
  next();
}

/**
 * Defensa CSRF: con SameSite=Lax el navegador ya no manda la cookie en
 * peticiones POST de otro sitio; esto ademas rechaza las que declaren
 * explicitamente un origen distinto.
 */
function sameOriginOnly(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'same-site', 'none'].includes(site)) {
    return next(new HttpError(403, 'Peticion de origen no permitido.'));
  }

  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return next(new HttpError(403, 'Peticion de origen no permitido.'));
      }
    } catch {
      return next(new HttpError(403, 'Origen invalido.'));
    }
  }
  next();
}

/* ---------------------- limite de intentos de acceso ---------------------- */

const attempts = new Map();
const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 8);
const WINDOW_MS = 10 * 60 * 1000;

function registerFailedLogin(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) attempts.set(key, { count: 1, first: now });
  else entry.count += 1;
}

function assertNotThrottled(key) {
  const entry = attempts.get(key);
  if (!entry) return;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return;
  }
  if (entry.count >= MAX_ATTEMPTS) {
    throw new HttpError(429, 'Demasiados intentos fallidos. Espere unos minutos.');
  }
}

const clearAttempts = (key) => attempts.delete(key);

/* --------------------------- administrador inicial ------------------------- */

/**
 * En el primer arranque crea un administrador para poder entrar.
 * Con ADMIN_EMAIL / ADMIN_PASSWORD se fijan las credenciales; si no, se
 * genera una contrasena aleatoria y se imprime una sola vez en la consola.
 */
function ensureBootstrapAdmin({ quiet = false } = {}) {
  const existing = db
    .prepare(`SELECT COUNT(*) AS total FROM people WHERE password_hash IS NOT NULL`)
    .get().total;
  if (existing > 0) return null;

  const email = (process.env.ADMIN_EMAIL || 'admin@bytewall.local').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const name = process.env.ADMIN_NAME || 'Administrador';

  const current = db.prepare('SELECT id FROM people WHERE email = ? COLLATE NOCASE').get(email);
  if (current) {
    db.prepare(`UPDATE people SET password_hash = ?, access_level = 'admin' WHERE id = ?`)
      .run(hashPassword(password), current.id);
  } else {
    db.prepare(
      `INSERT INTO people (name, email, role, password_hash, access_level)
       VALUES (?, ?, ?, ?, 'admin')`
    ).run(name, email, 'Administrador', hashPassword(password));
  }

  if (!quiet) {
    console.log('\n=== Usuario administrador inicial ===');
    console.log(`  Correo:     ${email}`);
    console.log(`  Contrasena: ${password}`);
    console.log('  Cambiela despues de iniciar sesion.\n');
  }
  return { email, password };
}

module.exports = {
  COOKIE_NAME,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
  assertStrongPassword,
  createSession,
  destroySession,
  destroyAllSessions,
  purgeExpiredSessions,
  personForToken,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  requireAdmin,
  sameOriginOnly,
  registerFailedLogin,
  assertNotThrottled,
  clearAttempts,
  ensureBootstrapAdmin,
};
