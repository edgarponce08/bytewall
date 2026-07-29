'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(DATA_DIR, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const dbFile = process.env.DB_FILE
  ? path.resolve(process.env.DB_FILE)
  : path.join(DATA_DIR, 'bytewall.db');

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

/**
 * Migracion para bases creadas antes de que existiera el inicio de sesion:
 * CREATE TABLE IF NOT EXISTS no agrega columnas nuevas a una tabla ya creada.
 */
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing('people', 'password_hash', 'TEXT');
addColumnIfMissing('people', 'access_level', "TEXT NOT NULL DEFAULT 'member'");

/** Registra un evento en la bitacora del proyecto. */
function logActivity(projectId, personId, type, message) {
  db.prepare(
    `INSERT INTO activity (project_id, person_id, type, message)
     VALUES (?, ?, ?, ?)`
  ).run(projectId, personId ?? null, type, message);
}

module.exports = { db, logActivity, DATA_DIR, UPLOAD_DIR, dbFile };
