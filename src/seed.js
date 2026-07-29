'use strict';

/**
 * Datos de ejemplo para probar la interfaz: `npm run seed`.
 * No borra nada; solo agrega si la base esta vacia.
 */

const { db, logActivity } = require('./db');

const existing = db.prepare('SELECT COUNT(*) AS total FROM projects').get().total;
if (existing > 0) {
  console.log(`La base ya tiene ${existing} proyecto(s). No se agregaron datos de ejemplo.`);
  process.exit(0);
}

const people = [
  { name: 'Ana Torres', email: 'ana@ejemplo.com', role: 'Lider de proyecto' },
  { name: 'Luis Ramirez', email: 'luis@ejemplo.com', role: 'Desarrollador' },
  { name: 'Sofia Mendez', email: 'sofia@ejemplo.com', role: 'Analista de calidad' },
];

const insertPerson = db.prepare('INSERT INTO people (name, email, role) VALUES (?, ?, ?)');
const insertProject = db.prepare(
  `INSERT INTO projects (name, description, status, assignee_id, progress, priority, due_date)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const seed = db.transaction(() => {
  const ids = people.map((person) =>
    Number(insertPerson.run(person.name, person.email, person.role).lastInsertRowid)
  );

  const projects = [
    ['Migracion de facturacion', 'Mover el modulo de facturacion al nuevo esquema fiscal.', 'in_progress', ids[0], 45, 'alta', '2026-09-30'],
    ['Portal de proveedores', 'Alta y seguimiento de proveedores con carga de documentos.', 'in_progress', ids[1], 20, 'media', '2026-10-15'],
    ['Auditoria de seguridad', 'Revision de accesos y politicas de contrasenas.', 'hold', ids[2], 10, 'alta', '2026-08-20'],
    ['Manual de operacion', 'Documentar procesos del area de soporte.', 'complete', ids[2], 100, 'baja', null],
  ];

  for (const project of projects) {
    const id = Number(insertProject.run(...project).lastInsertRowid);
    logActivity(id, project[3], 'created', 'Proyecto creado (datos de ejemplo).');
  }
});

seed();
console.log('Datos de ejemplo cargados: 3 personas y 4 proyectos.');
