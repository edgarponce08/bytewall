'use strict';

/**
 * Administracion de cuentas desde la terminal, para el servidor donde corre
 * Bytewall. Sirve sobre todo cuando nadie puede entrar a la interfaz:
 * reiniciar la contrasena del administrador no necesita sesion.
 *
 *   npm run user -- list
 *   npm run user -- add "Ana Torres" ana@empresa.com --admin
 *   npm run user -- passwd ana@empresa.com --password='clave-larga'
 *   npm run user -- role ana@empresa.com member
 *   npm run user -- disable ana@empresa.com
 *   npm run user -- enable ana@empresa.com
 */

require('../env').loadEnvFile();

const crypto = require('node:crypto');
const { db } = require('../db');
const { hashPassword, destroyAllSessions } = require('../auth');

const USAGE = `Uso: npm run user -- <comando> [argumentos]

  list                             Lista las cuentas
  add <nombre> [correo]            Crea una persona
       --admin                       nivel administrador
       --password=<clave>            contrasena (si se omite, se genera)
       --no-login                    sin acceso, solo como responsable
       --role=<puesto>               puesto que se muestra en la interfaz
  passwd <correo> [--password=…]    Cambia o genera la contrasena
  role <correo> <admin|member>      Cambia el nivel de acceso
  disable <correo>                  Da de baja el acceso
  enable <correo>                   Reactiva el acceso
`;

const MIN_PASSWORD_LENGTH = 8;

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, value] = arg.slice(2).split(/=(.*)/s);
    flags[name] = value === undefined ? true : value;
  }
  return { flags, positional };
}

const generatePassword = () => crypto.randomBytes(9).toString('base64url');

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function findByEmail(email) {
  const person = db
    .prepare('SELECT * FROM people WHERE email = ? COLLATE NOCASE')
    .get(String(email || '').trim().toLowerCase());
  if (!person) fail(`No hay ninguna cuenta con el correo "${email}".`);
  return person;
}

/** Nunca se deja el sistema sin un administrador que pueda entrar. */
function assertNotLastAdmin(personId) {
  const others = db
    .prepare(
      `SELECT COUNT(*) AS total FROM people
        WHERE access_level = 'admin' AND active = 1
          AND password_hash IS NOT NULL AND id <> ?`
    )
    .get(personId).total;
  if (others === 0) fail('Debe quedar al menos un administrador con acceso.');
}

function checkPassword(password) {
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    fail(`La contrasena debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  return password;
}

const commands = {
  list() {
    const people = db
      .prepare(
        `SELECT p.id, p.name, p.email, p.role, p.access_level, p.active,
                (p.password_hash IS NOT NULL) AS has_login,
                COUNT(pr.id) AS projects
           FROM people p
           LEFT JOIN projects pr ON pr.assignee_id = p.id
          GROUP BY p.id
          ORDER BY p.name COLLATE NOCASE`
      )
      .all();

    if (!people.length) {
      console.log('No hay personas registradas.');
      return;
    }

    console.log(
      ['ID', 'NOMBRE', 'CORREO', 'NIVEL', 'ACCESO', 'ESTADO', 'PROY.']
        .map((header, index) => header.padEnd([4, 24, 28, 8, 8, 8, 5][index]))
        .join('')
    );
    for (const person of people) {
      console.log(
        String(person.id).padEnd(4) +
          person.name.slice(0, 23).padEnd(24) +
          (person.email || '—').slice(0, 27).padEnd(28) +
          person.access_level.padEnd(8) +
          (person.has_login ? 'si' : 'no').padEnd(8) +
          (person.active ? 'activo' : 'baja').padEnd(8) +
          String(person.projects)
      );
    }
  },

  add(positional, flags) {
    const [name, email] = positional;
    if (!name) fail('Falta el nombre. Ejemplo: npm run user -- add "Ana Torres" ana@empresa.com');

    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    const wantsLogin = !flags['no-login'];

    if (wantsLogin && !normalizedEmail) {
      fail('Para dar acceso se necesita un correo, o use --no-login.');
    }
    if (db.prepare('SELECT id FROM people WHERE name = ? COLLATE NOCASE').get(name)) {
      fail(`Ya existe una persona llamada "${name}".`);
    }
    if (
      normalizedEmail &&
      db.prepare('SELECT id FROM people WHERE email = ? COLLATE NOCASE').get(normalizedEmail)
    ) {
      fail(`El correo "${normalizedEmail}" ya esta registrado.`);
    }

    let password = null;
    if (wantsLogin) {
      password = flags.password ? checkPassword(flags.password) : generatePassword();
    }

    db.prepare(
      `INSERT INTO people (name, email, role, access_level, password_hash)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      name,
      normalizedEmail,
      flags.role || null,
      flags.admin ? 'admin' : 'member',
      password ? hashPassword(password) : null
    );

    console.log(`Cuenta creada: ${name}${normalizedEmail ? ` <${normalizedEmail}>` : ''}`);
    console.log(`  Nivel: ${flags.admin ? 'administrador' : 'miembro'}`);
    if (!wantsLogin) console.log('  Sin acceso: solo puede aparecer como responsable.');
    else if (!flags.password) console.log(`  Contrasena generada: ${password}`);
  },

  passwd(positional, flags) {
    const person = findByEmail(positional[0]);
    const password = flags.password ? checkPassword(flags.password) : generatePassword();

    db.prepare('UPDATE people SET password_hash = ? WHERE id = ?').run(
      hashPassword(password),
      person.id
    );
    destroyAllSessions(person.id);

    console.log(`Contrasena actualizada para ${person.name} <${person.email}>.`);
    if (!flags.password) console.log(`  Nueva contrasena: ${password}`);
    console.log('  Se cerraron sus sesiones abiertas.');
  },

  role(positional) {
    const person = findByEmail(positional[0]);
    const level = String(positional[1] || '').toLowerCase();
    if (!['admin', 'member'].includes(level)) fail('El nivel debe ser "admin" o "member".');
    if (level !== 'admin' && person.access_level === 'admin') assertNotLastAdmin(person.id);

    db.prepare('UPDATE people SET access_level = ? WHERE id = ?').run(level, person.id);
    console.log(`${person.name} ahora es ${level === 'admin' ? 'administrador' : 'miembro'}.`);
  },

  disable(positional) {
    const person = findByEmail(positional[0]);
    if (person.access_level === 'admin') assertNotLastAdmin(person.id);

    db.prepare('UPDATE people SET active = 0 WHERE id = ?').run(person.id);
    destroyAllSessions(person.id);
    console.log(`${person.name} ya no puede entrar. Sus proyectos siguen asignados.`);
  },

  enable(positional) {
    const person = findByEmail(positional[0]);
    db.prepare('UPDATE people SET active = 1 WHERE id = ?').run(person.id);
    console.log(`${person.name} puede entrar de nuevo.`);
  },
};

const { flags, positional } = parseArgs(process.argv.slice(2));
const [command, ...rest] = positional;

if (!command || flags.help) {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}
if (!Object.hasOwn(commands, command)) {
  console.error(`Comando desconocido: ${command}\n`);
  console.log(USAGE);
  process.exit(1);
}

commands[command](rest, flags);
