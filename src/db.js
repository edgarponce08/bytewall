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

/** Registra un evento en la bitacora del proyecto. */
function logActivity(projectId, personId, type, message) {
  db.prepare(
    `INSERT INTO activity (project_id, person_id, type, message)
     VALUES (?, ?, ?, ?)`
  ).run(projectId, personId ?? null, type, message);
}

module.exports = { db, logActivity, DATA_DIR, UPLOAD_DIR, dbFile };
