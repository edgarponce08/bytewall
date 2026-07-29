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

const { createApp } = require('../src/app');

let baseUrl;
const server = createApp().listen(0);

test.before(async () => {
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function call(method, path, body) {
  const init = { method };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, init);
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  return { status: response.status, body: isJson ? await response.json() : await response.text() };
}

test('crea personas y rechaza duplicados', async () => {
  const created = await call('POST', '/api/people', { name: 'Ana Torres', role: 'Lider' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Ana Torres');

  const duplicate = await call('POST', '/api/people', { name: 'ana torres' });
  assert.equal(duplicate.status, 409);

  const missingName = await call('POST', '/api/people', { name: '  ' });
  assert.equal(missingName.status, 400);
});

test('crea un proyecto con responsable y lo lista', async () => {
  const person = (await call('POST', '/api/people', { name: 'Luis Ramirez' })).body;
  const created = await call('POST', '/api/projects', {
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

  const filtered = await call('GET', `/api/projects?assignee_id=${person.id}`);
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.length, 1);
  assert.equal(filtered.body[0].name, 'Portal de proveedores');
});

test('valida estado, avance y fecha', async () => {
  assert.equal((await call('POST', '/api/projects', { name: 'X', status: 'raro' })).status, 400);
  assert.equal((await call('POST', '/api/projects', { name: 'X', progress: 140 })).status, 400);
  assert.equal((await call('POST', '/api/projects', { name: 'X', due_date: '01-2026' })).status, 400);
  assert.equal((await call('POST', '/api/projects', { name: '' })).status, 400);
});

test('completar un proyecto lo lleva a 100% y registra bitacora', async () => {
  const project = (await call('POST', '/api/projects', { name: 'Manual', progress: 40 })).body;

  const updated = await call('PATCH', `/api/projects/${project.id}`, { status: 'complete' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.status, 'complete');
  assert.equal(updated.body.progress, 100);

  const detail = (await call('GET', `/api/projects/${project.id}`)).body;
  const types = detail.activity.map((entry) => entry.type);
  assert.ok(types.includes('status'));
  assert.ok(types.includes('progress'));
});

test('adjunta evidencia, actualiza avance y permite descargarla', async () => {
  const person = (await call('POST', '/api/people', { name: 'Sofia Mendez' })).body;
  const project = (await call('POST', '/api/projects', { name: 'Auditoria' })).body;

  const form = new FormData();
  form.set('file', new File(['%PDF-1.4 evidencia'], 'reporte avance.pdf', { type: 'application/pdf' }));
  form.set('note', 'Primer corte');
  form.set('uploader_id', String(person.id));
  form.set('progress', '35');

  const uploaded = await call('POST', `/api/projects/${project.id}/attachments`, form);
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.original_name, 'reporte avance.pdf');
  assert.equal(uploaded.body.uploader_name, 'Sofia Mendez');

  const detail = (await call('GET', `/api/projects/${project.id}`)).body;
  assert.equal(detail.progress, 35);
  assert.equal(detail.attachments.length, 1);

  const download = await fetch(`${baseUrl}/api/attachments/${uploaded.body.id}/file`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.match(await download.text(), /evidencia/);
});

test('rechaza formatos no permitidos y no deja archivos huerfanos', async () => {
  const project = (await call('POST', '/api/projects', { name: 'Formatos' })).body;

  const form = new FormData();
  form.set('file', new File(['#!/bin/sh'], 'script.sh', { type: 'application/x-sh' }));
  const rejected = await call('POST', `/api/projects/${project.id}/attachments`, form);
  assert.equal(rejected.status, 400);

  const uploads = fs.readdirSync(process.env.UPLOAD_DIR);
  assert.ok(!uploads.some((name) => name.endsWith('.sh')));
});

test('eliminar un proyecto borra sus evidencias del disco', async () => {
  const project = (await call('POST', '/api/projects', { name: 'Temporal' })).body;

  const form = new FormData();
  form.set('file', new File(['imagen'], 'captura.png', { type: 'image/png' }));
  const uploaded = (await call('POST', `/api/projects/${project.id}/attachments`, form)).body;

  const before = fs.readdirSync(process.env.UPLOAD_DIR).length;
  assert.equal((await call('DELETE', `/api/projects/${project.id}`)).status, 200);
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, before - 1);
  assert.equal((await call('GET', `/api/attachments/${uploaded.id}/file`)).status, 404);
});

test('las estadisticas reflejan los proyectos existentes', async () => {
  const stats = (await call('GET', '/api/projects/stats')).body;
  assert.ok(stats.total > 0);
  assert.ok(Object.hasOwn(stats.by_status, 'in_progress'));
  assert.equal(typeof stats.avg_progress, 'number');
});
