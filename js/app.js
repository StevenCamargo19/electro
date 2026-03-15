// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN — Reemplaza con tu URL de Google Apps Script
// ═══════════════════════════════════════════════════════════════
const API_URL = 'https://script.google.com/macros/s/AKfycbzwlZtsizFao6OgOC-H8SUZyffPMmoRu9_t656ytqU9BD05Ayz-LWoD8JAV5yvJFCKS/exec';

// ═══════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════════
let currentUser = null;
let allRecords = [];
let currentRecord = null;

// Estado de ordenamiento — por defecto: fecha subida descendente
let sortField = 'fechaSubida';
let sortDir = 'desc';

// Estado de paginación
const PAGE_SIZE = 15;   // registros por página — ajusta según prefieras
let currentPage = 1;
let currentList = [];   // lista activa (filtrada + ordenada)

// ═══════════════════════════════════════════════════════════════
// UTILIDADES — Loading
// ═══════════════════════════════════════════════════════════════
function showLoading(msg = 'Cargando...') {
  const overlay = document.getElementById('loading-overlay');
  overlay.querySelector('.loading-text').textContent = msg;
  overlay.classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════
// UTILIDADES — Toasts
// ═══════════════════════════════════════════════════════════════
function toast(msg, type = 'info', duration = 3800) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ═══════════════════════════════════════════════════════════════
// UTILIDADES — Fechas
// ═══════════════════════════════════════════════════════════════
function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str);
  if (isNaN(d)) return str;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatDateTime(str) {
  if (!str) return '—';
  const d = new Date(str);
  if (isNaN(d)) return str;
  return d.toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ═══════════════════════════════════════════════════════════════
// API — Llamada al backend
// ═══════════════════════════════════════════════════════════════
async function apiCall(data) {
  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(data)
  });
  return res.json();
}

// ═══════════════════════════════════════════════════════════════
// AUTH — Login
// ═══════════════════════════════════════════════════════════════
async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;

  if (!username || !password) {
    toast('Ingresa usuario y contraseña', 'error');
    return;
  }

  showLoading('Verificando credenciales...');
  try {
    const res = await apiCall({ action: 'login', username, password });
    if (res.success) {
      currentUser = res.user;
      sessionStorage.setItem('cardioUser', JSON.stringify(currentUser));
      enterApp();
    } else {
      toast(res.message || 'Credenciales incorrectas', 'error');
    }
  } catch (e) {
    toast('Error de conexión. Verifica la URL del API.', 'error');
    console.error(e);
  } finally {
    hideLoading();
  }
}

// AUTH — Logout
function doLogout() {
  sessionStorage.removeItem('cardioUser');
  currentUser = null;
  allRecords = [];

  // Reiniciar animación ECG (solo si la función existe)
  try {
    if (window.restartEcgAnimation) {
      window.restartEcgAnimation();
    }
  } catch (e) {
    console.warn('No se pudo reiniciar la animación ECG:', e);
  }

  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

// ═══════════════════════════════════════════════════════════════
// PANTALLA APP
// ═══════════════════════════════════════════════════════════════
function enterApp() {
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');

  // Header
  document.getElementById('user-name-display').textContent = currentUser.nombre;
  document.getElementById('user-rol-display').textContent =
    currentUser.rol === 'medico' ? '🩺 Médico' : '🏥 Enfermero/a';

  const av = document.getElementById('user-avatar');
  av.textContent = currentUser.nombre.charAt(0).toUpperCase();
  av.className = 'user-avatar ' +
    (currentUser.rol === 'medico' ? 'avatar-medico' : 'avatar-enfermero');

  // Ocultar ambas vistas antes de decidir cuál mostrar
  document.getElementById('view-medico').style.display = 'none';
  document.getElementById('view-enfermero').style.display = 'none';

  if (currentUser.rol === 'medico') {
    document.getElementById('view-medico').style.display = 'block';
    loadRecords();
  } else if (currentUser.rol === 'enfermero') {
    document.getElementById('view-enfermero').style.display = 'block';
    document.getElementById('up-fecha').valueAsDate = new Date();
  } else {
    toast('Rol no reconocido. Contacta al administrador.', 'error');
    doLogout();
  }
}

// ═══════════════════════════════════════════════════════════════
// TABS — Enfermero
// ═══════════════════════════════════════════════════════════════
function showTab(tab, btnEl) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panelId = tab === 'upload' ? 'panel-upload' : 'panel-my-records';
  document.getElementById(panelId).classList.add('active');

  if (tab === 'my-records') loadRecords();
}

// ═══════════════════════════════════════════════════════════════
// SUBIDA DE ARCHIVO
// ═══════════════════════════════════════════════════════════════
function onFileSelected(input) {
  const file = input.files[0];
  if (!file) return;

  if (file.size > 10 * 1024 * 1024) {
    toast('El archivo supera el límite de 10 MB', 'error');
    input.value = '';
    return;
  }

  document.getElementById('file-name-display').textContent = file.name;
  document.getElementById('file-selected').style.display = 'flex';
}

function resetForm() {
  document.getElementById('up-cedula').value = '';
  document.getElementById('up-nombre').value = '';
  document.getElementById('up-fecha').valueAsDate = new Date();
  document.getElementById('up-file').value = '';
  document.getElementById('file-selected').style.display = 'none';
  document.getElementById('progress-wrap').style.display = 'none';
}

async function doUpload() {
  const cedula = document.getElementById('up-cedula').value.trim();
  const nombre = document.getElementById('up-nombre').value.trim();
  const fechaElectro = document.getElementById('up-fecha').value;
  const fileInput = document.getElementById('up-file');

  if (!cedula || !nombre || !fechaElectro || !fileInput.files[0]) {
    toast('Completa todos los campos y selecciona un archivo', 'error');
    return;
  }

  const file = fileInput.files[0];
  const btn = document.getElementById('btn-upload');
  btn.disabled = true;
  btn.textContent = 'Subiendo...';
  document.getElementById('progress-wrap').style.display = 'block';

  try {
    const base64 = await fileToBase64(file);
    const fileData = base64.split(',')[1];

    const res = await apiCall({
      action: 'uploadRecord',
      fileData,
      fileName: file.name,
      mimeType: file.type,
      cedulaPaciente: cedula,
      nombrePaciente: nombre,
      fechaElectro,
      subidoPor: currentUser.username
    });

    if (res.success) {
      toast('✅ Electro subido correctamente', 'success');
      resetForm();
    } else {
      toast(res.message || 'Error al subir el archivo', 'error');
    }
  } catch (e) {
    toast('Error de conexión', 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = '↑ Subir Electro';
    document.getElementById('progress-wrap').style.display = 'none';
  }
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════════════════════
// REGISTROS — Carga y renderizado
// ═══════════════════════════════════════════════════════════════
async function loadRecords() {
  try {
    const res = await apiCall({
      action: 'getRecords',
      rol: currentUser.rol,
      username: currentUser.username
    });

    if (res.success) {
      allRecords = res.records;
      renderRecords(allRecords);
      updateSortIndicators();
    } else {
      toast('Error al cargar registros', 'error');
    }
  } catch (e) {
    toast('Error de conexión', 'error');
    console.error(e);
  }
}

function renderRecords(records) {
  currentPage = 1;
  currentList = sortList(records);
  renderTable(currentList, false);
}

// ═══════════════════════════════════════════════════════════════
// ORDENAMIENTO
// ═══════════════════════════════════════════════════════════════
function sortList(records) {
  return [...records].sort((a, b) => {
    const da = new Date(a[sortField] || 0);
    const db = new Date(b[sortField] || 0);
    return sortDir === 'desc' ? db - da : da - db;
  });
}

function setSort(field) {
  if (sortField === field) {
    sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  } else {
    sortField = field;
    sortDir = 'desc';
  }
  currentPage = 1;
  currentList = sortList(currentList);
  renderTable(currentList, false);
  updateSortIndicators();
}

function updateSortIndicators() {
  // Actualiza los íconos de los encabezados
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const field = th.dataset.sort;
    const icon = th.querySelector('.sort-icon');
    if (!icon) return;
    if (field === sortField) {
      icon.textContent = sortDir === 'desc' ? ' ↓' : ' ↑';
      icon.style.opacity = '1';
    } else {
      icon.textContent = ' ↕';
      icon.style.opacity = '0.35';
    }
  });
}

function filterRecords(query) {
  const q = query.toLowerCase().trim();
  const filtered = !q
    ? allRecords
    : allRecords.filter(r =>
      String(r.nombrePaciente || '').toLowerCase().includes(q) ||
      String(r.cedulaPaciente || '').toLowerCase().includes(q) ||
      String(r.subidoPor || '').toLowerCase().includes(q)
    );
  currentPage = 1;
  currentList = sortList(filtered);
  renderTable(currentList, !q);
}

function renderTable(records, isFullList) {
  const isMedico = currentUser.rol === 'medico';
  const tbody = document.getElementById(isMedico ? 'med-table-body' : 'my-table-body');
  const cols = isMedico ? 8 : 7;

  // ── Actualizar encabezados con botones de orden ──
  const thead = tbody.closest('table').querySelector('thead tr');
  if (thead) {
    thead.querySelectorAll('th[data-sort]').forEach(th => {
      if (!th.querySelector('.sort-icon')) {
        const icon = document.createElement('span');
        icon.className = 'sort-icon';
        icon.textContent = ' ↕';
        icon.style.opacity = '0.35';
        th.appendChild(icon);
      }
      if (!th.dataset.sortBound) {
        th.dataset.sortBound = '1';
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        th.addEventListener('click', () => setSort(th.dataset.sort));
      }
    });
    updateSortIndicators();
  }

  // ── Paginador ──
  const totalRecords = records.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, totalRecords);
  const pageData = records.slice(start, end);

  // Contenedor del paginador (justo debajo del table-wrap)
  const tableWrap = tbody.closest('.table-wrap');
  let pagerEl = tableWrap.nextElementSibling;
  if (!pagerEl || !pagerEl.classList.contains('pagination-bar')) {
    pagerEl = document.createElement('div');
    pagerEl.className = 'pagination-bar';
    tableWrap.after(pagerEl);
  }

  if (!records.length) {
    tbody.innerHTML = `
      <tr><td colspan="${cols}">
        <div class="empty-state">
          <div class="empty-icon">${isFullList ? '📋' : '🔍'}</div>
          <div class="empty-title">${isFullList ? 'Sin registros' : 'Sin resultados'}</div>
          <div class="empty-desc">${isFullList
        ? (isMedico ? 'Aún no hay electros en el sistema.' : 'No has subido electros aún.')
        : 'No hay registros que coincidan con la búsqueda.'
      }</div>
        </div>
      </td></tr>`;
    pagerEl.innerHTML = '';
    return;
  }

  // ── Filas de la página actual ──
  tbody.innerHTML = pageData.map(r => {
    const realIndex = allRecords.indexOf(r);
    const hasObs = r.observacion && r.observacion.trim();
    const obsBadge = `<span class="obs-badge ${hasObs ? 'obs-yes' : 'obs-no'}">
                         ${hasObs ? '✓ Sí' : 'Pendiente'}
                       </span>`;
    const verBtn = `<a href="${r.fileUrl}" target="_blank">
                         <button class="btn btn-sm btn-teal-outline">🔗 Ver</button>
                       </a>`;
    const detBtn = `<button class="btn btn-sm btn-secondary" onclick="openModal(${realIndex})">
                         🔍 Detalle
                       </button>`;
    const revBtn = `<button class="btn btn-sm btn-green-outline" onclick="openModal(${realIndex})">
                         ✏️ Revisar
                       </button>`;

    if (isMedico) {
      return `<tr>
        <td><strong>${r.nombrePaciente}</strong></td>
        <td style="color:var(--text-2)">${r.cedulaPaciente}</td>
        <td>${formatDate(r.fechaElectro)}</td>
        <td>${formatDateTime(r.fechaSubida)}</td>
        <td>${r.subidoPor}</td>
        <td>${verBtn}</td>
        <td>${obsBadge}</td>
        <td>${revBtn}</td>
      </tr>`;
    } else {
      return `<tr>
        <td><strong>${r.nombrePaciente}</strong></td>
        <td style="color:var(--text-2)">${r.cedulaPaciente}</td>
        <td>${formatDate(r.fechaElectro)}</td>
        <td>${formatDateTime(r.fechaSubida)}</td>
        <td>${verBtn}</td>
        <td>${obsBadge}</td>
        <td>${detBtn}</td>
      </tr>`;
    }
  }).join('');

  // ── Renderizar barra de paginación ──
  const info = `Mostrando ${start + 1}–${end} de ${totalRecords} registros`;

  // Genera botones de página (máximo 5 visibles alrededor de la actual)
  let pageButtons = '';
  const delta = 2;
  const rangeStart = Math.max(1, currentPage - delta);
  const rangeEnd = Math.min(totalPages, currentPage + delta);

  if (rangeStart > 1) {
    pageButtons += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
    if (rangeStart > 2) pageButtons += `<span class="page-ellipsis">…</span>`;
  }
  for (let i = rangeStart; i <= rangeEnd; i++) {
    pageButtons += `<button class="page-btn ${i === currentPage ? 'active' : ''}"
                      onclick="goToPage(${i})">${i}</button>`;
  }
  if (rangeEnd < totalPages) {
    if (rangeEnd < totalPages - 1) pageButtons += `<span class="page-ellipsis">…</span>`;
    pageButtons += `<button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }

  pagerEl.innerHTML = `
    <span class="page-info">${info}</span>
    <div class="page-controls">
      <button class="page-btn" onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>‹</button>
      ${pageButtons}
      <button class="page-btn" onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>›</button>
    </div>`;
}

function goToPage(page) {
  const totalPages = Math.ceil(currentList.length / PAGE_SIZE);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderTable(currentList, false);
  // Scroll suave al inicio de la tabla
  document.querySelector('.table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ═══════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════
function openModal(index) {
  currentRecord = allRecords[index];
  const r = currentRecord;
  const isMedico = currentUser.rol === 'medico';

  document.getElementById('modal-title').textContent = r.nombrePaciente;

  document.getElementById('modal-details').innerHTML = `
    <div>
      <div class="detail-label">Cédula</div>
      <div class="detail-value">${r.cedulaPaciente}</div>
    </div>
    <div>
      <div class="detail-label">Fecha del Electro</div>
      <div class="detail-value">${formatDate(r.fechaElectro)}</div>
    </div>
    <div>
      <div class="detail-label">Fecha de Subida</div>
      <div class="detail-value">${formatDateTime(r.fechaSubida)}</div>
    </div>
    <div>
      <div class="detail-label">Subido por</div>
      <div class="detail-value">${r.subidoPor}</div>
    </div>
    <div style="grid-column:1/-1">
      <div class="detail-label">Archivo</div>
      <div class="detail-value">
        <a href="${r.fileUrl}" target="_blank" style="color:var(--teal)">
          📄 ${r.fileName}
        </a>
      </div>
    </div>`;

  const obsContent = document.getElementById('modal-obs-content');
  if (isMedico) {
    obsContent.innerHTML = `
      <textarea class="obs-textarea" id="obs-input"
        placeholder="Escriba aquí su observación médica...">${r.observacion || ''}</textarea>`;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveObservation()">💾 Guardar Observación</button>`;
  } else {
    obsContent.innerHTML = r.observacion
      ? `<div class="obs-display">${r.observacion}</div>`
      : `<p class="obs-empty">El médico aún no ha dejado observación para este electro.</p>`;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
      <a href="${r.fileUrl}" target="_blank">
        <button class="btn btn-primary">🔗 Abrir Archivo</button>
      </a>`;
  }

  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

// Cerrar al hacer clic en el fondo
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });
});

async function saveObservation() {
  const obs = document.getElementById('obs-input').value.trim();
  if (!obs) {
    toast('Escribe una observación antes de guardar', 'error');
    return;
  }

  showLoading('Guardando observación...');
  try {
    const res = await apiCall({
      action: 'saveObservation',
      rowIndex: currentRecord.rowIndex,
      observacion: obs
    });
    if (res.success) {
      currentRecord.observacion = obs;
      toast('✅ Observación guardada correctamente', 'success');
      closeModal();
      renderRecords(allRecords);
    } else {
      toast('Error al guardar la observación', 'error');
    }
  } catch (e) {
    toast('Error de conexión', 'error');
  } finally {
    hideLoading();
  }
}

// ═══════════════════════════════════════════════════════════════
// DRAG & DROP
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const dz = document.getElementById('drop-zone');
  if (!dz) return;

  dz.addEventListener('dragover', e => {
    e.preventDefault();
    dz.classList.add('dragging');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragging'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (file) {
      document.getElementById('up-file').files = e.dataTransfer.files;
      onFileSelected(document.getElementById('up-file'));
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// INICIO — sesión guardada + atajos de teclado
// ═══════════════════════════════════════════════════════════════
window.addEventListener('load', () => {
  hideLoading();
  const saved = sessionStorage.getItem('cardioUser');
  if (saved) {
    currentUser = JSON.parse(saved);
    enterApp();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-pass').addEventListener('keypress', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('login-user').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('login-pass').focus();
  });
});