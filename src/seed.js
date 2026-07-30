'use strict';

/**
 * Datos de ejemplo para probar la interfaz: `npm run seed`.
 * No borra nada; solo agrega si la base esta vacia.
 */

const { db, logActivity } = require('./db');
const { hashPassword } = require('./auth');

const existing = db.prepare('SELECT COUNT(*) AS total FROM projects').get().total;
if (existing > 0) {
  console.log(`La base ya tiene ${existing} proyecto(s). No se agregaron datos de ejemplo.`);
  process.exit(0);
}

// Contrasena unica para las cuentas de ejemplo; sirve solo para probar.
const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'bytewall2026';

const people = [
  { name: 'Ana Torres', email: 'ana@ejemplo.com', role: 'Lider de proyecto', access: 'admin' },
  { name: 'Luis Ramirez', email: 'luis@ejemplo.com', role: 'Desarrollador', access: 'member' },
  { name: 'Sofia Mendez', email: 'sofia@ejemplo.com', role: 'Analista de calidad', access: 'member' },
];

const insertPerson = db.prepare(
  `INSERT INTO people (name, email, role, access_level, password_hash)
   VALUES (?, ?, ?, ?, ?)`
);
const insertProject = db.prepare(
  `INSERT INTO projects (name, description, status, assignee_id, progress, priority, due_date)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const seed = db.transaction(() => {
  const passwordHash = hashPassword(DEMO_PASSWORD);
  const ids = people.map((person) =>
    Number(
      insertPerson.run(person.name, person.email, person.role, person.access, passwordHash)
        .lastInsertRowid
    )
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
console.log(`Acceso de prueba (contrasena "${DEMO_PASSWORD}"):`);
for (const person of people) {
  console.log(`  ${person.email.padEnd(20)} ${person.access}`);
}
