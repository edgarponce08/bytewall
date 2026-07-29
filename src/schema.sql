-- Esquema de Bytewall: control de proyectos multitarea.

CREATE TABLE IF NOT EXISTS people (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  email       TEXT,
  role        TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_people_name ON people (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'in_progress'
                CHECK (status IN ('in_progress', 'hold', 'complete')),
  assignee_id INTEGER REFERENCES people (id) ON DELETE SET NULL,
  progress    INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  priority    TEXT    NOT NULL DEFAULT 'media'
                CHECK (priority IN ('baja', 'media', 'alta')),
  due_date    TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_status   ON projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_assignee ON projects (assignee_id);

CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  uploader_id   INTEGER REFERENCES people (id) ON DELETE SET NULL,
  stored_name   TEXT    NOT NULL,
  original_name TEXT    NOT NULL,
  extension     TEXT    NOT NULL,
  mime_type     TEXT    NOT NULL DEFAULT 'application/octet-stream',
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  note          TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_project ON attachments (project_id);

CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  person_id  INTEGER REFERENCES people (id) ON DELETE SET NULL,
  type       TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_project ON activity (project_id, id DESC);
