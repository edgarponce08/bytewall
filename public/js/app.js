'use strict';

/* =========================================================================
 * Bytewall — cliente de la interfaz de control de proyectos.
 * ========================================================================= */

const STATUS_LABELS = {
  in_progress: 'En progreso',
  hold: 'En espera',
  complete: 'Completado',
};
const STATUS_ORDER = ['in_progress', 'hold', 'complete'];
const IDENTITY_KEY = 'bytewall.identity';

const state = {
  view: 'board',
  people: [],
  projects: [],
  stats: null,
  config: { allowed_extensions: [], max_upload_mb: 25 },
  identityId: Number(localStorage.getItem(IDENTITY_KEY)) || null,
  filters: { q: '', assignee_id: '', status: '', sort: 'updated' },
};

/* ------------------------------- utilidades ------------------------------ */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function initials(name) {
  if (!name) return '—';
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/** Las fechas de SQLite llegan como "YYYY-MM-DD HH:MM:SS" en UTC. */
function parseUtc(value) {
  if (!value) return null;
  return new Date(`${String(value).replace(' ', 'T')}${value.includes('T') ? '' : 'Z'}`);
}

function formatDateTime(value) {
  const date = parseUtc(value);
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isOverdue(project) {
  if (!project.due_date || project.status === 'complete') return false;
  const today = new Date().toISOString().slice(0, 10);
  return project.due_date < today;
}

function toast(message, kind = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  $('#toasts').append(node);
  setTimeout(() => node.remove(), 4200);
}

/* ---------------------------------- API ---------------------------------- */

async function api(path, options = {}) {
  const init = { ...options };
  if (init.body && !(init.body instanceof FormData)) {
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    init.body = JSON.stringify(init.body);
  }
  const response = await fetch(`/api${path}`, init);
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.error || `Error ${response.status}`);
  return payload;
}

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value !== null && value !== undefined) search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/* ------------------------------ carga de datos ---------------------------- */

async function loadAll() {
  const [people, projects, stats] = await Promise.all([
    api('/people'),
    api(`/projects${queryString(state.filters)}`),
    api('/projects/stats'),
  ]);
  state.people = people;
  state.projects = projects;
  state.stats = stats;
  render();
}

async function refreshProjects() {
  const [projects, stats] = await Promise.all([
    api(`/projects${queryString(state.filters)}`),
    api('/projects/stats'),
  ]);
  state.projects = projects;
  state.stats = stats;
  render();
}

/* -------------------------------- render --------------------------------- */

function render() {
  renderIdentity();
  renderPeopleSelects();
  renderKpis();
  renderBoard();
  renderList();
  renderPeople();

  for (const view of ['board', 'list', 'people']) {
    $(`#view-${view}`).hidden = state.view !== view;
  }
  $('#toolbar').hidden = state.view === 'people';
  $$('.tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.view === state.view));
}

function renderIdentity() {
  const select = $('#identity-select');
  select.innerHTML =
    `<option value="">— sin identificar —</option>` +
    state.people
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
      .join('');
  select.value = state.identityId ? String(state.identityId) : '';
}

function renderPeopleSelects() {
  const options = state.people
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join('');

  const filter = $('#filter-assignee');
  filter.innerHTML =
    `<option value="">Todos los responsables</option><option value="none">Sin responsable</option>${options}`;
  filter.value = state.filters.assignee_id;

  $$('[data-people-select]').forEach((select) => {
    const current = select.value;
    select.innerHTML = `<option value="">Sin responsable</option>${options}`;
    select.value = current;
  });
}

function renderKpis() {
  const stats = state.stats;
  if (!stats) return;
  const cards = [
    { label: 'Proyectos', value: stats.total },
    { label: 'En progreso', value: stats.by_status.in_progress },
    { label: 'En espera', value: stats.by_status.hold },
    { label: 'Completados', value: stats.by_status.complete },
    { label: 'Avance promedio', value: `${stats.avg_progress}%` },
    { label: 'Vencidos', value: stats.overdue, warning: stats.overdue > 0 },
    { label: 'Evidencias', value: stats.evidence_total },
  ];
  $('#kpis').innerHTML = cards
    .map(
      (card) => `<article class="kpi${card.warning ? ' is-warning' : ''}">
        <span>${card.label}</span><strong>${card.value}</strong></article>`
    )
    .join('');
}

function progressBar(project) {
  const tone = project.status === 'complete' ? 'complete' : project.status === 'hold' ? 'hold' : '';
  return `<div class="progress">
      <div class="progress-track">
        <div class="progress-fill ${tone}" style="width:${project.progress}%"></div>
      </div>
      <span class="progress-value">${project.progress}%</span>
    </div>`;
}

function projectCard(project) {
  const overdue = isOverdue(project);
  return `<article class="card status-${project.status}" draggable="true" data-project="${project.id}">
      <div class="card-title">${escapeHtml(project.name)}</div>
      ${project.description ? `<p class="card-desc">${escapeHtml(project.description)}</p>` : ''}
      ${progressBar(project)}
      <div class="card-meta">
        <div class="card-meta-row">
          <span class="avatar" title="${escapeHtml(project.assignee_name || 'Sin responsable')}">${initials(project.assignee_name)}</span>
          <span>${escapeHtml(project.assignee_name || 'Sin responsable')}</span>
        </div>
        <div class="card-meta-row">
          ${project.evidence_count ? `<span class="chip evidence">${project.evidence_count} eviden.</span>` : ''}
          ${project.priority === 'alta' ? '<span class="chip alta">Alta</span>' : ''}
          ${project.due_date ? `<span class="chip${overdue ? ' overdue' : ''}">${formatDate(project.due_date)}</span>` : ''}
        </div>
      </div>
    </article>`;
}

function renderBoard() {
  const columns = STATUS_ORDER.map((status) => {
    const items = state.projects.filter((p) => p.status === status);
    const cards = items.length
      ? items.map(projectCard).join('')
      : '<p class="empty">Sin proyectos aqui</p>';
    return `<section class="column" data-status="${status}">
        <header class="column-head">
          <h3><span class="dot ${status}"></span>${STATUS_LABELS[status]}</h3>
          <span class="count">${items.length}</span>
        </header>
        <div class="column-body">${cards}</div>
      </section>`;
  }).join('');

  $('#view-board').innerHTML = `<div class="board">${columns}</div>`;
}

function renderList() {
  if (!state.projects.length) {
    $('#view-list').innerHTML = '<p class="empty">No hay proyectos que coincidan con el filtro.</p>';
    return;
  }

  const rows = state.projects
    .map(
      (project) => `<tr>
        <td><button type="button" class="link" data-project="${project.id}">${escapeHtml(project.name)}</button>
          ${project.description ? `<div class="card-desc" style="margin:2px 0 0">${escapeHtml(project.description)}</div>` : ''}
        </td>
        <td>
          <select class="inline-select" data-status-for="${project.id}">
            ${STATUS_ORDER.map(
              (status) =>
                `<option value="${status}"${status === project.status ? ' selected' : ''}>${STATUS_LABELS[status]}</option>`
            ).join('')}
          </select>
        </td>
        <td>
          <select class="inline-select" data-assignee-for="${project.id}">
            <option value="">Sin responsable</option>
            ${state.people
              .map(
                (person) =>
                  `<option value="${person.id}"${person.id === project.assignee_id ? ' selected' : ''}>${escapeHtml(person.name)}</option>`
              )
              .join('')}
          </select>
        </td>
        <td style="min-width:170px">${progressBar(project)}</td>
        <td>${project.evidence_count}</td>
        <td class="${isOverdue(project) ? 'overdue' : ''}">${project.due_date ? formatDate(project.due_date) : '—'}</td>
        <td>${formatDateTime(project.updated_at)}</td>
      </tr>`
    )
    .join('');

  $('#view-list').innerHTML = `<div class="table-wrap"><table>
      <thead><tr>
        <th>Proyecto</th><th>Estado</th><th>Responsable</th><th>Avance</th>
        <th>Evid.</th><th>Compromiso</th><th>Actualizado</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function renderPeople() {
  if (!state.people.length) {
    $('#view-people').innerHTML =
      '<p class="empty">Aun no hay personas registradas. Use “+ Persona” para agregar la primera.</p>';
    return;
  }

  $('#view-people').innerHTML = `<div class="people-grid">${state.people
    .map(
      (person) => `<article class="person-card">
        <header class="person-head">
          <span class="avatar lg">${initials(person.name)}</span>
          <div>
            <h3>${escapeHtml(person.name)}</h3>
            <p>${escapeHtml(person.role || 'Sin puesto')}${person.email ? ` · ${escapeHtml(person.email)}` : ''}</p>
          </div>
        </header>
        <div class="person-stats">
          <div><strong>${person.in_progress || 0}</strong><span>En progreso</span></div>
          <div><strong>${person.hold || 0}</strong><span>En espera</span></div>
          <div><strong>${person.complete || 0}</strong><span>Completados</span></div>
        </div>
        ${progressBar({ progress: person.avg_progress || 0, status: 'in_progress' })}
        <div class="card-meta">
          <span>${person.total_projects || 0} proyecto(s) asignado(s)</span>
          <button type="button" class="btn small ghost" data-filter-person="${person.id}">Ver proyectos</button>
        </div>
      </article>`
    )
    .join('')}</div>`;
}

/* ---------------------------- detalle de proyecto ------------------------- */

const projectDialog = $('#project-dialog');

async function openProject(id) {
  try {
    const project = await api(`/projects/${id}`);
    renderProjectDetail(project);
    if (!projectDialog.open) projectDialog.showModal();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function fileIcon(extension) {
  return `<span class="file-icon">${escapeHtml(extension).slice(0, 4)}</span>`;
}

function renderProjectDetail(project) {
  const peopleOptions = state.people
    .map(
      (person) =>
        `<option value="${person.id}"${person.id === project.assignee_id ? ' selected' : ''}>${escapeHtml(person.name)}</option>`
    )
    .join('');

  const evidence = project.attachments.length
    ? project.attachments
        .map(
          (item) => `<div class="evidence">
            ${fileIcon(item.extension)}
            <div class="meta">
              <b title="${escapeHtml(item.original_name)}">${escapeHtml(item.original_name)}</b>
              <small>${formatBytes(item.size_bytes)} · ${escapeHtml(item.uploader_name || 'anonimo')} · ${formatDateTime(item.created_at)}</small>
              ${item.note ? `<small>“${escapeHtml(item.note)}”</small>` : ''}
            </div>
            <div class="evidence-actions">
              <a class="btn small ghost" href="/api/attachments/${item.id}/file?inline=1" target="_blank" rel="noopener">Ver</a>
              <a class="btn small ghost" href="/api/attachments/${item.id}/file" download>Bajar</a>
              <button type="button" class="btn small danger" data-delete-attachment="${item.id}">×</button>
            </div>
          </div>`
        )
        .join('')
    : '<p class="empty">Sin evidencias adjuntas todavia.</p>';

  const timeline = project.activity.length
    ? project.activity
        .map(
          (entry) => `<li>${escapeHtml(entry.message)}
            <small>${escapeHtml(entry.person_name || 'Sistema')} · ${formatDateTime(entry.created_at)}</small></li>`
        )
        .join('')
    : '<li class="muted">Sin movimientos registrados.</li>';

  $('#project-dialog-body').innerHTML = `<div class="detail" data-project-id="${project.id}">
      <header class="detail-head">
        <div>
          <h2>${escapeHtml(project.name)}</h2>
          <p class="muted">Creado ${formatDateTime(project.created_at)} · Actualizado ${formatDateTime(project.updated_at)}</p>
        </div>
        <div class="card-meta-row">
          <button type="button" class="btn small danger" data-delete-project>Eliminar</button>
          <button type="button" class="btn small ghost" data-close-detail>Cerrar</button>
        </div>
      </header>

      <div class="detail-body">
        <div class="detail-col">
          <h4>Datos del proyecto</h4>
          <form id="detail-form" class="form" style="padding:0;gap:12px">
            <label class="field">
              <span>Nombre</span>
              <input class="input" name="name" required maxlength="160" value="${escapeHtml(project.name)}" />
            </label>
            <label class="field">
              <span>Descripcion</span>
              <textarea class="input" name="description" rows="4" maxlength="4000">${escapeHtml(project.description)}</textarea>
            </label>
            <div class="grid-2">
              <label class="field">
                <span>Estado</span>
                <select class="input" name="status">
                  ${STATUS_ORDER.map(
                    (status) =>
                      `<option value="${status}"${status === project.status ? ' selected' : ''}>${STATUS_LABELS[status]}</option>`
                  ).join('')}
                </select>
              </label>
              <label class="field">
                <span>Responsable</span>
                <select class="input" name="assignee_id"><option value="">Sin responsable</option>${peopleOptions}</select>
              </label>
              <label class="field">
                <span>Prioridad</span>
                <select class="input" name="priority">
                  ${['baja', 'media', 'alta']
                    .map(
                      (priority) =>
                        `<option value="${priority}"${priority === project.priority ? ' selected' : ''}>${priority[0].toUpperCase()}${priority.slice(1)}</option>`
                    )
                    .join('')}
                </select>
              </label>
              <label class="field">
                <span>Fecha compromiso</span>
                <input class="input" type="date" name="due_date" value="${project.due_date || ''}" />
              </label>
            </div>
            <label class="field">
              <span>Avance: <output id="detail-progress-out">${project.progress}</output>%</span>
              <input type="range" name="progress" min="0" max="100" step="5" value="${project.progress}" />
            </label>
            <p class="form-error" data-error hidden></p>
            <div class="form-actions">
              <button type="submit" class="btn primary">Guardar cambios</button>
            </div>
          </form>
        </div>

        <div class="detail-col">
          <h4>Evidencias de avance</h4>
          <form id="evidence-form" class="upload-box">
            <input type="file" name="file" required
                   accept="${state.config.allowed_extensions.map((ext) => `.${ext}`).join(',')}" />
            <input class="input" name="note" maxlength="1000" placeholder="Nota del avance (opcional)" />
            <label class="field">
              <span>Actualizar avance a: <output id="evidence-progress-out">${project.progress}</output>%</span>
              <input type="range" name="progress" min="0" max="100" step="5" value="${project.progress}" />
            </label>
            <div class="form-actions">
              <small style="margin-right:auto;color:var(--text-soft)">
                ${state.config.allowed_extensions.join(', ')} · max ${state.config.max_upload_mb} MB
              </small>
              <button type="submit" class="btn primary">Adjuntar evidencia</button>
            </div>
          </form>
          <div class="evidence-list">${evidence}</div>

          <h4>Bitacora</h4>
          <ul class="timeline">${timeline}</ul>
        </div>
      </div>
    </div>`;
}

/* -------------------------------- acciones -------------------------------- */

async function patchProject(id, changes) {
  await api(`/projects/${id}`, {
    method: 'PATCH',
    body: { ...changes, actor_id: state.identityId },
  });
  await refreshProjects();
}

async function submitDetailForm(form, projectId) {
  const data = Object.fromEntries(new FormData(form));
  const errorBox = $('[data-error]', form);
  errorBox.hidden = true;
  try {
    await patchProject(projectId, {
      name: data.name,
      description: data.description,
      status: data.status,
      assignee_id: data.assignee_id || null,
      priority: data.priority,
      due_date: data.due_date || null,
      progress: Number(data.progress),
    });
    toast('Proyecto actualizado.', 'success');
    await openProject(projectId);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
}

async function submitEvidence(form, projectId) {
  const formData = new FormData(form);
  if (state.identityId) formData.set('uploader_id', state.identityId);
  const submit = $('button[type="submit"]', form);
  submit.disabled = true;
  submit.textContent = 'Subiendo…';
  try {
    await api(`/projects/${projectId}/attachments`, { method: 'POST', body: formData });
    toast('Evidencia adjunta.', 'success');
    await refreshProjects();
    await openProject(projectId);
  } catch (err) {
    toast(err.message, 'error');
    submit.disabled = false;
    submit.textContent = 'Adjuntar evidencia';
  }
}

/* -------------------------------- eventos --------------------------------- */

function bindTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.view = tab.dataset.view;
      render();
    });
  });
}

function bindFilters() {
  let timer;
  $('#filter-q').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.filters.q = event.target.value.trim();
      refreshProjects().catch((err) => toast(err.message, 'error'));
    }, 250);
  });

  const bind = (selector, key) => {
    $(selector).addEventListener('change', (event) => {
      state.filters[key] = event.target.value;
      refreshProjects().catch((err) => toast(err.message, 'error'));
    });
  };
  bind('#filter-assignee', 'assignee_id');
  bind('#filter-status', 'status');
  bind('#filter-sort', 'sort');

  $('#btn-clear-filters').addEventListener('click', () => {
    state.filters = { q: '', assignee_id: '', status: '', sort: 'updated' };
    $('#filter-q').value = '';
    $('#filter-status').value = '';
    $('#filter-sort').value = 'updated';
    refreshProjects().catch((err) => toast(err.message, 'error'));
  });
}

function bindIdentity() {
  $('#identity-select').addEventListener('change', (event) => {
    state.identityId = event.target.value ? Number(event.target.value) : null;
    if (state.identityId) localStorage.setItem(IDENTITY_KEY, String(state.identityId));
    else localStorage.removeItem(IDENTITY_KEY);
  });
}

/** Un solo listener para tablero, lista y vista de personas. */
function bindViewDelegation() {
  document.addEventListener('click', (event) => {
    const card = event.target.closest('.card[data-project]');
    const link = event.target.closest('.link[data-project]');
    const target = link || card;
    if (target && !event.target.closest('.evidence-actions')) {
      openProject(Number(target.dataset.project));
      return;
    }

    const personBtn = event.target.closest('[data-filter-person]');
    if (personBtn) {
      state.filters.assignee_id = personBtn.dataset.filterPerson;
      state.view = 'board';
      $('#filter-assignee').value = personBtn.dataset.filterPerson;
      refreshProjects().catch((err) => toast(err.message, 'error'));
    }
  });

  document.addEventListener('change', async (event) => {
    const statusSelect = event.target.closest('[data-status-for]');
    if (statusSelect) {
      try {
        await patchProject(Number(statusSelect.dataset.statusFor), { status: statusSelect.value });
        toast('Estado actualizado.', 'success');
      } catch (err) {
        toast(err.message, 'error');
        await refreshProjects();
      }
      return;
    }

    const assigneeSelect = event.target.closest('[data-assignee-for]');
    if (assigneeSelect) {
      try {
        await patchProject(Number(assigneeSelect.dataset.assigneeFor), {
          assignee_id: assigneeSelect.value || null,
        });
        toast('Responsable actualizado.', 'success');
      } catch (err) {
        toast(err.message, 'error');
        await refreshProjects();
      }
    }
  });
}

/** Arrastrar tarjetas entre columnas cambia el estado del proyecto. */
function bindDragAndDrop() {
  const board = $('#view-board');
  let draggedId = null;

  board.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.card[data-project]');
    if (!card) return;
    draggedId = Number(card.dataset.project);
    card.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(draggedId));
  });

  board.addEventListener('dragend', (event) => {
    event.target.closest('.card')?.classList.remove('dragging');
    $$('.column', board).forEach((column) => column.classList.remove('is-drop'));
  });

  board.addEventListener('dragover', (event) => {
    const column = event.target.closest('.column[data-status]');
    if (!column) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    $$('.column', board).forEach((item) => item.classList.toggle('is-drop', item === column));
  });

  board.addEventListener('drop', async (event) => {
    const column = event.target.closest('.column[data-status]');
    if (!column || !draggedId) return;
    event.preventDefault();
    const status = column.dataset.status;
    const project = state.projects.find((item) => item.id === draggedId);
    draggedId = null;
    $$('.column', board).forEach((item) => item.classList.remove('is-drop'));
    if (!project || project.status === status) return;
    try {
      await patchProject(project.id, { status });
      toast(`“${project.name}” → ${STATUS_LABELS[status]}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function bindProjectDialog() {
  projectDialog.addEventListener('click', async (event) => {
    if (event.target.closest('[data-close-detail]')) {
      projectDialog.close();
      return;
    }

    const detail = $('.detail', projectDialog);
    const projectId = detail && Number(detail.dataset.projectId);

    const deleteAttachment = event.target.closest('[data-delete-attachment]');
    if (deleteAttachment) {
      if (!confirm('¿Eliminar esta evidencia?')) return;
      try {
        await api(`/attachments/${deleteAttachment.dataset.deleteAttachment}`, {
          method: 'DELETE',
          body: { actor_id: state.identityId },
        });
        toast('Evidencia eliminada.', 'success');
        await refreshProjects();
        await openProject(projectId);
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }

    if (event.target.closest('[data-delete-project]')) {
      if (!confirm('¿Eliminar el proyecto y todas sus evidencias? Esta accion no se puede deshacer.')) return;
      try {
        await api(`/projects/${projectId}`, { method: 'DELETE' });
        projectDialog.close();
        toast('Proyecto eliminado.', 'success');
        await refreshProjects();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  projectDialog.addEventListener('input', (event) => {
    if (event.target.name !== 'progress') return;
    const output = event.target.closest('#detail-form')
      ? $('#detail-progress-out')
      : $('#evidence-progress-out');
    if (output) output.textContent = event.target.value;
  });

  projectDialog.addEventListener('submit', (event) => {
    event.preventDefault();
    const detail = $('.detail', projectDialog);
    const projectId = Number(detail.dataset.projectId);
    if (event.target.id === 'detail-form') submitDetailForm(event.target, projectId);
    if (event.target.id === 'evidence-form') submitEvidence(event.target, projectId);
  });
}

function bindNewProject() {
  const dialog = $('#new-project-dialog');
  const form = $('#new-project-form');

  $('#btn-new-project').addEventListener('click', () => {
    form.reset();
    $('[data-error]', form).hidden = true;
    $('output[name="progress-out"]', form).textContent = '0';
    renderPeopleSelects();
    if (state.identityId) form.assignee_id.value = String(state.identityId);
    dialog.showModal();
  });

  form.addEventListener('input', (event) => {
    if (event.target.name === 'progress') {
      $('output[name="progress-out"]', form).textContent = event.target.value;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const errorBox = $('[data-error]', form);
    errorBox.hidden = true;
    try {
      const project = await api('/projects', {
        method: 'POST',
        body: {
          name: data.name,
          description: data.description,
          status: data.status,
          assignee_id: data.assignee_id || null,
          priority: data.priority,
          due_date: data.due_date || null,
          progress: Number(data.progress),
          actor_id: state.identityId,
        },
      });
      dialog.close();
      toast('Proyecto creado.', 'success');
      await refreshProjects();
      openProject(project.id);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    }
  });
}

function bindNewPerson() {
  const dialog = $('#new-person-dialog');
  const form = $('#new-person-form');

  $('#btn-new-person').addEventListener('click', () => {
    form.reset();
    $('[data-error]', form).hidden = true;
    dialog.showModal();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const errorBox = $('[data-error]', form);
    errorBox.hidden = true;
    try {
      const person = await api('/people', { method: 'POST', body: data });
      if (!state.identityId) {
        state.identityId = person.id;
        localStorage.setItem(IDENTITY_KEY, String(person.id));
      }
      dialog.close();
      toast(`${person.name} agregado.`, 'success');
      await loadAll();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    }
  });
}

function bindDialogCloseButtons() {
  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close]');
    if (close) close.closest('dialog')?.close();
  });
}

/* --------------------------------- arranque -------------------------------- */

async function init() {
  bindTabs();
  bindFilters();
  bindIdentity();
  bindViewDelegation();
  bindDragAndDrop();
  bindProjectDialog();
  bindNewProject();
  bindNewPerson();
  bindDialogCloseButtons();

  try {
    state.config = await api('/config');
    await loadAll();
  } catch (err) {
    toast(`No se pudo cargar la informacion: ${err.message}`, 'error');
  }
}

init();
