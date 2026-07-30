'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Base y almacenamiento temporales: las pruebas no tocan los datos reales.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytewall-test-'));
process.env.DATA_DIR = tmpDir;
process.env.DB_FILE = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-secreta-123';

const { createApp } = require('../src/app');

let baseUrl;
const server = createApp({ quietBootstrap: true }).listen(0);

/** Cada sesion guarda su cookie; sin ella las peticiones van sin autenticar. */
function session() {
  return { cookie: null };
}
const admin = session();
const anon = session();

test.before(async () => {
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await login(admin, 'admin@test.local', 'admin-secreta-123');
});

test.after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function call(as, method, path, body) {
  const init = { method, headers: {}, redirect: 'manual' };
  if (as?.cookie) init.headers.cookie = as.cookie;
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, init);

  const setCookie = response.headers.getSetCookie?.() || [];
  const session = setCookie.find((item) => item.startsWith('bw_session='));
  if (as && session) as.cookie = session.split(';')[0];

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  return {
    status: response.status,
    headers: response.headers,
    body: isJson ? await response.json() : await response.text(),
  };
}

async function login(as, email, password) {
  const result = await call(as, 'POST', '/api/auth/login', { email, password });
  assert.equal(result.status, 200, `login fallido para ${email}: ${JSON.stringify(result.body)}`);
  return result.body;
}

/** Crea una persona con acceso y devuelve su sesion iniciada. */
async function createMember(name, email, accessLevel = 'member') {
  const password = 'miembro-secreta-1';
  const person = await call(admin, 'POST', '/api/people', {
    name,
    email,
    password,
    access_level: accessLevel,
  });
  assert.equal(person.status, 201, JSON.stringify(person.body));
  const as = session();
  await login(as, email, password);
  return { person: person.body, as };
}

/* ------------------------------ autenticacion ----------------------------- */

test('la API rechaza peticiones sin sesion', async () => {
  assert.equal((await call(anon, 'GET', '/api/projects')).status, 401);
  assert.equal((await call(anon, 'GET', '/api/people')).status, 401);
  assert.equal((await call(anon, 'POST', '/api/projects', { name: 'X' })).status, 401);
});

test('la interfaz redirige al login sin sesion', async () => {
  const home = await call(anon, 'GET', '/');
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/login.html');
});

test('el login rechaza credenciales incorrectas con el mismo mensaje', async () => {
  const badPassword = await call(anon, 'POST', '/api/auth/login', {
    email: 'admin@test.local',
    password: 'incorrecta',
  });
  const noUser = await call(anon, 'POST', '/api/auth/login', {
    email: 'nadie@test.local',
    password: 'incorrecta',
  });
  assert.equal(badPassword.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(badPassword.body.error, noUser.body.error);
});

test('la cookie de sesion es HttpOnly y SameSite=Lax', async () => {
  const as = session();
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.local', password: 'admin-secreta-123' }),
  });
  const cookie = response.headers.getSetCookie().find((item) => item.startsWith('bw_session='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.ok(as);
});

test('cerrar sesion invalida la cookie', async () => {
  const as = session();
  await login(as, 'admin@test.local', 'admin-secreta-123');
  assert.equal((await call(as, 'GET', '/api/auth/me')).status, 200);

  const cookie = as.cookie;
  assert.equal((await call(as, 'POST', '/api/auth/logout')).status, 200);
  assert.equal((await call({ cookie }, 'GET', '/api/auth/me')).status, 401);
});

test('rechaza peticiones marcadas como de otro origen', async () => {
  const response = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: admin.cookie,
      origin: 'http://evil.example',
    },
    body: JSON.stringify({ name: 'CSRF' }),
  });
  assert.equal(response.status, 403);
});

test('cambiar la contrasena cierra las demas sesiones', async () => {
  const { as } = await createMember('Cambio Clave', 'cambio@test.local');
  const otra = session();
  await login(otra, 'cambio@test.local', 'miembro-secreta-1');

  const changed = await call(as, 'POST', '/api/auth/password', {
    current_password: 'miembro-secreta-1',
    new_password: 'nueva-clave-larga',
  });
  assert.equal(changed.status, 200);

  assert.equal((await call(otra, 'GET', '/api/auth/me')).status, 401);
  assert.equal((await call(as, 'GET', '/api/auth/me')).status, 200);
  await login(session(), 'cambio@test.local', 'nueva-clave-larga');
});

test('la contrasena debe tener al menos 8 caracteres', async () => {
  const short = await call(admin, 'POST', '/api/people', {
    name: 'Clave Corta',
    email: 'corta@test.local',
    password: 'abc',
  });
  assert.equal(short.status, 400);
});

/* --------------------------------- personas -------------------------------- */

test('crea personas y rechaza duplicados', async () => {
  const created = await call(admin, 'POST', '/api/people', { name: 'Ana Torres', role: 'Lider' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Ana Torres');
  assert.equal(created.body.has_login, 0);

  assert.equal((await call(admin, 'POST', '/api/people', { name: 'ana torres' })).status, 409);
  assert.equal((await call(admin, 'POST', '/api/people', { name: '  ' })).status, 400);
});

test('la lista de personas nunca expone el hash de la contrasena', async () => {
  const people = (await call(admin, 'GET', '/api/people')).body;
  assert.ok(people.length > 0);
  for (const person of people) assert.equal(person.password_hash, undefined);
});

test('un miembro no puede administrar personas ni crear proyectos', async () => {
  const { as } = await createMember('Miembro Simple', 'simple@test.local');

  assert.equal((await call(as, 'GET', '/api/people')).status, 200);
  assert.equal((await call(as, 'POST', '/api/people', { name: 'Intruso' })).status, 403);
  assert.equal((await call(as, 'POST', '/api/projects', { name: 'Suyo' })).status, 403);
});

test('no se puede dejar el sistema sin administradores', async () => {
  const me = (await call(admin, 'GET', '/api/auth/me')).body;
  const downgrade = await call(admin, 'PATCH', `/api/people/${me.id}`, { access_level: 'member' });
  assert.equal(downgrade.status, 409);
  assert.equal((await call(admin, 'DELETE', `/api/people/${me.id}`)).status, 409);
});

/* -------------------------------- proyectos -------------------------------- */

test('crea un proyecto con responsable y lo lista', async () => {
  const person = (await call(admin, 'POST', '/api/people', { name: 'Luis Ramirez' })).body;
  const created = await call(admin, 'POST', '/api/projects', {
    name: 'Portal de proveedores',
    description: 'Alta de proveedores',
    status: 'in_progress',
    assignee_id: person.id,
    progress: 20,
    due_date: '2026-12-01',
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.assignee_name, 'Luis Ramirez');
  assert.equal(created.body.progress, 20);

  const filtered = await call(admin, 'GET', `/api/projects?assignee_id=${person.id}`);
  assert.equal(filtered.body.length, 1);
  assert.equal(filtered.body[0].name, 'Portal de proveedores');
});

test('valida estado, avance y fecha', async () => {
  const bad = (body) => call(admin, 'POST', '/api/projects', body);
  assert.equal((await bad({ name: 'X', status: 'raro' })).status, 400);
  assert.equal((await bad({ name: 'X', progress: 140 })).status, 400);
  assert.equal((await bad({ name: 'X', due_date: '01-2026' })).status, 400);
  assert.equal((await bad({ name: '' })).status, 400);
});

test('completar un proyecto lo lleva a 100% y registra bitacora', async () => {
  const project = (await call(admin, 'POST', '/api/projects', { name: 'Manual', progress: 40 })).body;

  const updated = await call(admin, 'PATCH', `/api/projects/${project.id}`, { status: 'complete' });
  assert.equal(updated.body.status, 'complete');
  assert.equal(updated.body.progress, 100);

  const detail = (await call(admin, 'GET', `/api/projects/${project.id}`)).body;
  const types = detail.activity.map((entry) => entry.type);
  assert.ok(types.includes('status'));
  assert.ok(types.includes('progress'));
});

test('la bitacora atribuye el cambio a quien inicio sesion', async () => {
  const { person, as } = await createMember('Bita Cora', 'bita@test.local');
  const project = (await call(admin, 'POST', '/api/projects', {
    name: 'Con bitacora',
    assignee_id: person.id,
  })).body;

  await call(as, 'PATCH', `/api/projects/${project.id}`, { progress: 60 });
  const detail = (await call(as, 'GET', `/api/projects/${project.id}`)).body;
  assert.equal(detail.activity[0].person_name, 'Bita Cora');
});

/* -------------------------------- permisos --------------------------------- */

test('el responsable actualiza estado y avance de su proyecto', async () => {
  const { person, as } = await createMember('Responsable Uno', 'resp1@test.local');
  const project = (await call(admin, 'POST', '/api/projects', {
    name: 'Proyecto asignado',
    assignee_id: person.id,
  })).body;

  const updated = await call(as, 'PATCH', `/api/projects/${project.id}`, {
    status: 'hold',
    progress: 30,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.status, 'hold');
  assert.equal(updated.body.progress, 30);
});

test('el responsable no puede renombrar ni reasignar su proyecto', async () => {
  const { person, as } = await createMember('Responsable Dos', 'resp2@test.local');
  const project = (await call(admin, 'POST', '/api/projects', {
    name: 'Solo lectura parcial',
    assignee_id: person.id,
  })).body;

  assert.equal((await call(as, 'PATCH', `/api/projects/${project.id}`, { name: 'Otro' })).status, 403);
  assert.equal((await call(as, 'PATCH', `/api/projects/${project.id}`, { assignee_id: null })).status, 403);
  assert.equal((await call(as, 'DELETE', `/api/projects/${project.id}`)).status, 403);
});

test('un miembro ajeno no puede tocar el proyecto de otro', async () => {
  const { person } = await createMember('Duena Del Proyecto', 'duena@test.local');
  const { as: ajeno } = await createMember('Ajeno Total', 'ajeno@test.local');
  const project = (await call(admin, 'POST', '/api/projects', {
    name: 'De otra persona',
    assignee_id: person.id,
  })).body;

  // Puede verlo...
  assert.equal((await call(ajeno, 'GET', `/api/projects/${project.id}`)).status, 200);
  // ...pero no modificarlo ni subirle evidencia.
  assert.equal((await call(ajeno, 'PATCH', `/api/projects/${project.id}`, { status: 'hold' })).status, 403);

  const form = new FormData();
  form.set('file', new File(['x'], 'ajeno.png', { type: 'image/png' }));
  assert.equal((await call(ajeno, 'POST', `/api/projects/${project.id}/attachments`, form)).status, 403);
});

/* -------------------------------- evidencias ------------------------------- */

test('adjunta evidencia, actualiza avance y permite descargarla', async () => {
  const { person, as } = await createMember('Sofia Mendez', 'sofia@test.local');
  const project = (await call(admin, 'POST', '/api/projects', {
    name: 'Auditoria',
    assignee_id: person.id,
  })).body;

  const form = new FormData();
  form.set('file', new File(['%PDF-1.4 evidencia'], 'reporte avance.pdf', { type: 'application/pdf' }));
  form.set('note', 'Primer corte');
  form.set('progress', '35');

  const uploaded = await call(as, 'POST', `/api/projects/${project.id}/attachments`, form);
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.original_name, 'reporte avance.pdf');
  // El autor sale de la sesion, no de lo que mande el cliente.
  assert.equal(uploaded.body.uploader_name, 'Sofia Mendez');

  const detail = (await call(as, 'GET', `/api/projects/${project.id}`)).body;
  assert.equal(detail.progress, 35);
  assert.equal(detail.attachments.length, 1);

  const download = await fetch(`${baseUrl}/api/attachments/${uploaded.body.id}/file`, {
    headers: { cookie: as.cookie },
  });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.match(await download.text(), /evidencia/);
});

test('las evidencias no se descargan sin sesion', async () => {
  const project = (await call(admin, 'POST', '/api/projects', { name: 'Privado' })).body;
  const form = new FormData();
  form.set('file', new File(['secreto'], 'secreto.pdf', { type: 'application/pdf' }));
  const uploaded = (await call(admin, 'POST', `/api/projects/${project.id}/attachments`, form)).body;

  assert.equal((await call(anon, 'GET', `/api/attachments/${uploaded.id}/file`)).status, 401);
});

test('rechaza formatos no permitidos y no deja archivos huerfanos', async () => {
  const project = (await call(admin, 'POST', '/api/projects', { name: 'Formatos' })).body;

  const form = new FormData();
  form.set('file', new File(['#!/bin/sh'], 'script.sh', { type: 'application/x-sh' }));
  assert.equal((await call(admin, 'POST', `/api/projects/${project.id}/attachments`, form)).status, 400);

  const uploads = fs.readdirSync(process.env.UPLOAD_DIR);
  assert.ok(!uploads.some((name) => name.endsWith('.sh')));
});

test('eliminar un proyecto borra sus evidencias del disco', async () => {
  const project = (await call(admin, 'POST', '/api/projects', { name: 'Temporal' })).body;

  const form = new FormData();
  form.set('file', new File(['imagen'], 'captura.png', { type: 'image/png' }));
  const uploaded = (await call(admin, 'POST', `/api/projects/${project.id}/attachments`, form)).body;

  const before = fs.readdirSync(process.env.UPLOAD_DIR).length;
  assert.equal((await call(admin, 'DELETE', `/api/projects/${project.id}`)).status, 200);
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, before - 1);
  assert.equal((await call(admin, 'GET', `/api/attachments/${uploaded.id}/file`)).status, 404);
});

test('las estadisticas reflejan los proyectos existentes', async () => {
  const stats = (await call(admin, 'GET', '/api/projects/stats')).body;
  assert.ok(stats.total > 0);
  assert.ok(Object.hasOwn(stats.by_status, 'in_progress'));
  assert.equal(typeof stats.avg_progress, 'number');
});
