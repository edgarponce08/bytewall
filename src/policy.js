'use strict';

const { HttpError } = require('./validation');

/**
 * Reglas de acceso, concentradas aqui para poder ajustarlas en un solo lugar.
 *
 *   admin  : todo — crear/editar/eliminar proyectos y administrar personas.
 *   member : ve todos los proyectos; reporta avance (estado, porcentaje y
 *            evidencias) solo en los proyectos donde es responsable.
 *
 * Para que cualquier miembro pueda reportar en cualquier proyecto, basta con
 * que canReportOnProject devuelva true para todo usuario autenticado.
 */

const isAdmin = (user) => user?.access_level === 'admin';

const isAssignee = (user, project) => Boolean(user) && project?.assignee_id === user.id;

/** Cambiar estado y avance, y adjuntar o borrar evidencias. */
const canReportOnProject = (user, project) => isAdmin(user) || isAssignee(user, project);

/** Editar nombre, descripcion, responsable, prioridad y fecha compromiso. */
const canEditProjectDetails = (user) => isAdmin(user);

/** Campos que un responsable no administrador puede modificar. */
const REPORTABLE_FIELDS = new Set(['status', 'progress']);

function assertCanReport(user, project) {
  if (!canReportOnProject(user, project)) {
    throw new HttpError(
      403,
      'Solo el responsable del proyecto o un administrador pueden reportar avance.'
    );
  }
}

function assertAdmin(user) {
  if (!isAdmin(user)) throw new HttpError(403, 'Se requieren permisos de administrador.');
}

/**
 * Valida los campos que trae un PATCH segun el rol.
 * Un responsable no administrador solo puede tocar estado y avance.
 */
function assertCanApplyChanges(user, project, fields) {
  assertCanReport(user, project);
  if (isAdmin(user)) return;
  const forbidden = fields.filter((field) => !REPORTABLE_FIELDS.has(field));
  if (forbidden.length) {
    throw new HttpError(
      403,
      `Como responsable puede actualizar estado y avance. Pida a un administrador cambiar: ${forbidden.join(', ')}.`
    );
  }
}

module.exports = {
  isAdmin,
  isAssignee,
  canReportOnProject,
  canEditProjectDetails,
  assertCanReport,
  assertAdmin,
  assertCanApplyChanges,
  REPORTABLE_FIELDS,
};
