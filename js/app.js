// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN — Reemplaza con tu URL de Google Apps Script
// ═══════════════════════════════════════════════════════════════
const API_URL = 'https://script.google.com/macros/s/AKfycbzrclzYxBgrzsRtV_KwXoJUvLuNwDo0c6InmoGPFD0ditSKTioQEXtGQ-7GxlkUahwG/exec';

// ═══════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════════
let currentUser = null;
let allRecords = [];
let currentRecord = null;

// Admin: lista de usuarios
let allUsers = [];
let currentUserList = [];
let userPage = 1;
let editingUserIndex = -1; // -1 = crear, >= 0 = editar

// Estado de ordenamiento — por defecto: fecha subida descendente
let sortField = 'fechaSubida';
let sortDir = 'desc';

// Estado de paginación
const PAGE_SIZE = 15;   // registros por página — ajusta según prefieras
const CHUNK_SIZE = 750000; // ~750 KB por chunk de base64
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
  const s = String(str);
  // Si ya viene en formato DD/MM/YYYY, usarlo directamente
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    return s;
  }
  // Detectar formato YYYY-MM-DD y parsear como hora local (no UTC)
  const parts = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = parts
    ? new Date(parseInt(parts[1]), parseInt(parts[2]) - 1, parseInt(parts[3]))
    : new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatDateTime(str) {
  if (!str) return '—';
  const s = String(str);
  // Si ya viene en formato DD/MM/YYYY hh:mm:ss a (con AM/PM), usarlo directamente
  if (/^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} [ap]\.m\.$/i.test(s)) {
    const [datePart, timePart] = s.split(' ');
    const [day, month, year] = datePart.split('/');
    const [time, meridiem] = timePart.split(' ');
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year} ${time} ${meridiem.toLowerCase()}`;
  }
  // Si viene en formato 24h sin AM/PM
  if (/^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2}$/.test(s)) {
    const [datePart, timePart] = s.split(' ');
    const [day, month, year] = datePart.split('/');
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year} ${timePart}`;
  }
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// Parsear fechas en formato DD/MM/YYYY o DD/MM/YYYY hh:mm:ss a para ordenamiento
function parseDateForSort(str) {
  if (!str) return new Date(0);
  const s = String(str);

  // Formato: DD/MM/YYYY hh:mm:ss AM/PM (ej: 18/03/2026 11:11:24 AM)
  const match12 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM|A\.M\.|P\.M\.|am|pm|a\.m\.|p\.m\.)$/i);
  if (match12) {
    const [, day, month, year, hour, min, sec, meridiem] = match12;
    let h = parseInt(hour);
    const merid = meridiem.toUpperCase().replace(/\./g, '');
    if (merid === 'PM' && h !== 12) h += 12;
    if (merid === 'AM' && h === 12) h = 0;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, parseInt(min), parseInt(sec));
  }

  // Formato: DD/MM/YYYY HH:mm:ss (24h)
  const match24 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (match24) {
    const [, day, month, year, hour, min, sec] = match24;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec));
  }

  // Formato: DD/MM/YYYY (solo fecha)
  const matchDate = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (matchDate) {
    const [, day, month, year] = matchDate;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  // Fallback: intentar parsear directamente
  const d = new Date(s);
  return isNaN(d) ? new Date(0) : d;
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
    currentUser.rol === 'medico' ? '🩺 Médico' :
    currentUser.rol === 'admin' ? '⚙️ Administrador' : '🏥 Enfermero/a';

  const av = document.getElementById('user-avatar');
  av.textContent = currentUser.nombre.charAt(0).toUpperCase();
  av.className = 'user-avatar ' +
    (currentUser.rol === 'medico' ? 'avatar-medico' :
     currentUser.rol === 'admin' ? 'avatar-admin' : 'avatar-enfermero');

  // Ocultar todas las vistas antes de decidir cuál mostrar
  document.getElementById('view-medico').style.display = 'none';
  document.getElementById('view-enfermero').style.display = 'none';
  document.getElementById('view-admin').style.display = 'none';

  if (currentUser.rol === 'admin') {
    document.getElementById('view-admin').style.display = 'block';
    loadUsers();
  } else if (currentUser.rol === 'medico') {
    document.getElementById('view-medico').style.display = 'block';
    loadRecords();
  } else if (currentUser.rol === 'enfermero') {
    document.getElementById('view-enfermero').style.display = 'block';
    document.getElementById('up-fecha').value = new Date().toLocaleDateString('en-CA');
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
function isPdfFile(file) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function onFileSelected(input) {
  const file = input.files[0];
  if (!file) return;

  if (!isPdfFile(file)) {
    toast('Solo se permiten archivos PDF', 'error');
    input.value = '';
    return;
  }

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
  document.getElementById('up-fecha').value = new Date().toLocaleDateString('en-CA');
  document.getElementById('up-file').value = '';
  document.getElementById('file-selected').style.display = 'none';
  document.getElementById('progress-wrap').style.display = 'none';
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('progress-text').textContent = '0%';
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

  if (!isPdfFile(file)) {
    toast('Solo se permiten archivos PDF', 'error');
    return;
  }

  const btn = document.getElementById('btn-upload');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  btn.disabled = true;
  btn.textContent = 'Subiendo...';
  document.getElementById('progress-wrap').style.display = 'block';
  progressBar.style.width = '0%';
  progressText.textContent = '0%';

  try {
    const base64 = await fileToBase64(file);
    const fileData = base64.split(',')[1];

    // Dividir en chunks
    const totalChunks = Math.ceil(fileData.length / CHUNK_SIZE);
    const uploadId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    for (let i = 0; i < totalChunks; i++) {
      const chunkData = fileData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const isLast = (i === totalChunks - 1);

      const payload = {
        action: 'uploadChunk',
        uploadId,
        chunkIndex: i,
        totalChunks,
        chunkData
      };

      // En el último chunk incluimos los metadatos
      if (isLast) {
        payload.fileName = file.name;
        payload.mimeType = file.type || 'application/pdf';
        payload.cedulaPaciente = cedula;
        payload.nombrePaciente = nombre;
        payload.fechaElectro = fechaElectro;
        payload.subidoPor = currentUser.username;
      }

      const res = await apiCall(payload);

      if (!res.success) {
        toast(res.message || `Error al subir fragmento ${i + 1}`, 'error');
        return;
      }

      // Actualizar barra de progreso
      const pct = Math.round(((i + 1) / totalChunks) * 100);
      progressBar.style.width = pct + '%';
      progressText.textContent = pct + '%';

      // Si el último chunk retorna la URL, la subida fue exitosa
      if (isLast && res.complete) {
        toast('✅ Electro subido correctamente', 'success');
        resetForm();
      }
    }
  } catch (e) {
    toast('Error de conexión. Intenta de nuevo.', 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = '↑ Subir Electro';
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
    const da = parseDateForSort(a[sortField] || 0);
    const db = parseDateForSort(b[sortField] || 0);
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

function filterRecords() {
  const isMedico = currentUser.rol === 'medico';
  const searchEl = document.getElementById(isMedico ? 'search-med' : 'search-enf');
  const filtroEl = document.getElementById(isMedico ? 'filtro-general-med' : 'filtro-general-enf');

  const q = (searchEl?.value || '').toLowerCase().trim();
  const filtro = filtroEl?.value || 'todos';

  let filtered = allRecords;

  // Filtro de texto
  if (q) {
    filtered = filtered.filter(r =>
      String(r.nombrePaciente || '').toLowerCase().includes(q) ||
      String(r.cedulaPaciente || '').toLowerCase().includes(q) ||
      String(r.subidoPor || '').toLowerCase().includes(q)
    );
  }

  // Filtro combinado (estado u observación)
  if (filtro === 'aprobados') {
    filtered = filtered.filter(r => r.aprobado === 'Aprobado');
  } else if (filtro === 'no-aprobados') {
    filtered = filtered.filter(r => r.aprobado === 'No Aprobado');
  } else if (filtro === 'sin-estado') {
    filtered = filtered.filter(r => !r.aprobado || r.aprobado === '');
  } else if (filtro === 'con-observacion') {
    filtered = filtered.filter(r => r.observacion && r.observacion.trim());
  } else if (filtro === 'sin-observacion') {
    filtered = filtered.filter(r => !r.observacion || !r.observacion.trim());
  }

  currentPage = 1;
  currentList = sortList(filtered);
  renderTable(currentList, !q && filtro === 'todos');
}

function renderTable(records, isFullList) {
  const isMedico = currentUser.rol === 'medico';
  const tbody = document.getElementById(isMedico ? 'med-table-body' : 'my-table-body');
  const cols = isMedico ? 9 : 8;

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

    // Badge de aprobado
    let aprobadoBadge;
    if (r.aprobado === 'Aprobado') {
      aprobadoBadge = '<span class="aprobado-badge aprobado-yes">✓ Aprobado</span>';
    } else if (r.aprobado === 'No Aprobado') {
      aprobadoBadge = '<span class="aprobado-badge aprobado-no">✕ No Aprobado</span>';
    } else {
      aprobadoBadge = '<span class="aprobado-badge aprobado-pending">Sin registrar</span>';
    }

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
        <td>${aprobadoBadge}</td>
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
        <td>${aprobadoBadge}</td>
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

  // Información esencial compacta
  document.getElementById('modal-details').innerHTML = `
    <div>
      <div class="detail-label">Cédula</div>
      <div class="detail-value">${r.cedulaPaciente}</div>
    </div>
    <div>
      <div class="detail-label">Fecha Electro</div>
      <div class="detail-value">${formatDate(r.fechaElectro)}</div>
    </div>
    <div style="grid-column:1/-1">
      <div class="detail-label">Archivo</div>
      <div class="detail-value">
        <a href="${r.fileUrl}" target="_blank" style="color:var(--teal)">
          📄 ${r.fileName}
        </a>
      </div>
    </div>`;

  // Contenido de aprobado
  const aprobadoContent = document.getElementById('modal-aprobado-content');
  const aprobadoSection = document.getElementById('aprobado-section');

  if (isMedico) {
    aprobadoSection.style.display = 'block';
    let aprobadoDisplay = '';
    if (r.aprobado === 'Aprobado') {
      aprobadoDisplay = '<span class="aprobado-badge aprobado-yes" style="margin-bottom:8px;display:inline-block">✓ Aprobado</span>';
    } else if (r.aprobado === 'No Aprobado') {
      aprobadoDisplay = '<span class="aprobado-badge aprobado-no" style="margin-bottom:8px;display:inline-block">✕ No Aprobado</span>';
    } else {
      aprobadoDisplay = '<span class="aprobado-badge aprobado-pending" style="margin-bottom:8px;display:inline-block">Sin registrar</span>';
    }
    aprobadoContent.innerHTML = `
      <div style="margin-bottom:8px;color:var(--text-2);font-size:13px;">Estado:</div>
      ${aprobadoDisplay}
      <select class="form-input" id="modal-aprobado-select" style="max-width:280px;">
        <option value="">-- Seleccione estado --</option>
        <option value="Aprobado" ${r.aprobado === 'Aprobado' ? 'selected' : ''}>✓ Aprobado</option>
        <option value="No Aprobado" ${r.aprobado === 'No Aprobado' ? 'selected' : ''}>✕ No Aprobado</option>
      </select>`;
  } else {
    aprobadoSection.style.display = 'block';
    let aprobadoDisplay = 'Sin registrar';
    if (r.aprobado === 'Aprobado') {
      aprobadoDisplay = '<span class="aprobado-badge aprobado-yes">✓ Aprobado</span>';
    } else if (r.aprobado === 'No Aprobado') {
      aprobadoDisplay = '<span class="aprobado-badge aprobado-no">✕ No Aprobado</span>';
    } else {
      aprobadoDisplay = '<span class="aprobado-badge aprobado-pending">Sin registrar</span>';
    }
    aprobadoContent.innerHTML = aprobadoDisplay;
  }

  const obsContent = document.getElementById('modal-obs-content');
  if (isMedico) {
    obsContent.innerHTML = `
      <textarea class="obs-textarea" id="obs-input"
        placeholder="Escriba una observación (obligatorio si marca No Aprobado)">${r.observacion || ''}</textarea>`;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveObservation()">💾 Guardar</button>`;
  } else {
    obsContent.innerHTML = r.observacion
      ? `<div class="obs-display">${r.observacion}</div>`
      : `<p class="obs-empty">El médico aún no ha dejado observación.</p>`;
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
  document.getElementById('user-modal-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeUserModal();
  });
});

async function saveObservation() {
  const obs = document.getElementById('obs-input').value.trim();
  const aprobadoSelect = document.getElementById('modal-aprobado-select');
  const aprobado = aprobadoSelect?.value || '';

  // Estado es obligatorio
  if (!aprobado) {
    toast('Seleccione el estado del electro', 'error');
    return;
  }

  // Si es No Aprobado, la observación es obligatoria
  if (aprobado === 'No Aprobado' && !obs) {
    toast('Debe escribir una observación al marcar como No Aprobado', 'error');
    return;
  }

  showLoading('Guardando...');
  try {
    // Guardar observación (se guarda vacío para borrar la anterior si existe)
    const resObs = await apiCall({
      action: 'saveObservation',
      rowIndex: currentRecord.rowIndex,
      observacion: obs
    });

    // Guardar aprobado
    const resAprobado = await apiCall({
      action: 'saveAprobado',
      rowIndex: currentRecord.rowIndex,
      aprobado: aprobado
    });

    if (resObs.success && resAprobado.success) {
      currentRecord.observacion = obs;
      currentRecord.aprobado = aprobado;
      toast('✅ Estado guardado correctamente', 'success');
      closeModal();
      renderRecords(allRecords);
    } else {
      toast('Error al guardar', 'error');
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
      if (!isPdfFile(file)) {
        toast('Solo se permiten archivos PDF', 'error');
        return;
      }
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

// ═══════════════════════════════════════════════════════════════
// ADMIN — Gestión de Usuarios
// ═══════════════════════════════════════════════════════════════
async function loadUsers() {
  try {
    const res = await apiCall({
      action: 'getUsers',
      requestedBy: currentUser.username
    });
    if (res.success) {
      allUsers = res.users;
      filterUsers();
    } else {
      toast(res.message || 'Error al cargar usuarios', 'error');
    }
  } catch (e) {
    toast('Error de conexión', 'error');
    console.error(e);
  }
}

function filterUsers() {
  const q = (document.getElementById('search-user')?.value || '').toLowerCase().trim();
  const filtroEstado = document.getElementById('filtro-estado-user')?.value || 'todos';
  const filtroRol = document.getElementById('filtro-rol-user')?.value || 'todos';

  let filtered = allUsers;

  if (q) {
    filtered = filtered.filter(u =>
      String(u.username || '').toLowerCase().includes(q) ||
      String(u.nombre || '').toLowerCase().includes(q)
    );
  }

  if (filtroEstado === 'activos') {
    filtered = filtered.filter(u => u.activo === 'SI');
  } else if (filtroEstado === 'inactivos') {
    filtered = filtered.filter(u => u.activo === 'NO');
  }

  if (filtroRol !== 'todos') {
    filtered = filtered.filter(u => u.rol === filtroRol);
  }

  userPage = 1;
  currentUserList = filtered;
  renderUsersTable();
}

function renderUsersTable() {
  const tbody = document.getElementById('users-table-body');
  const totalRecords = currentUserList.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
  if (userPage > totalPages) userPage = totalPages;

  const start = (userPage - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, totalRecords);
  const pageData = currentUserList.slice(start, end);

  // Paginador
  const tableWrap = tbody.closest('.table-wrap');
  let pagerEl = tableWrap.nextElementSibling;
  if (!pagerEl || !pagerEl.classList.contains('pagination-bar')) {
    pagerEl = document.createElement('div');
    pagerEl.className = 'pagination-bar';
    tableWrap.after(pagerEl);
  }

  if (!totalRecords) {
    tbody.innerHTML = `
      <tr><td colspan="5">
        <div class="empty-state">
          <div class="empty-icon">👤</div>
          <div class="empty-title">Sin usuarios</div>
          <div class="empty-desc">No se encontraron usuarios que coincidan con la búsqueda.</div>
        </div>
      </td></tr>`;
    pagerEl.innerHTML = '';
    return;
  }

  tbody.innerHTML = pageData.map(u => {
    const realIndex = allUsers.indexOf(u);

    // Badge de rol
    let rolLabel, rolClass;
    if (u.rol === 'medico') {
      rolLabel = '🩺 Médico';
      rolClass = 'rol-badge rol-medico';
    } else if (u.rol === 'admin') {
      rolLabel = '⚙️ Admin';
      rolClass = 'rol-badge rol-admin';
    } else {
      rolLabel = '🏥 Enfermero/a';
      rolClass = 'rol-badge rol-enfermero';
    }

    // Badge de estado
    const isActive = u.activo === 'SI';
    const statusBadge = isActive
      ? '<span class="status-badge status-active">● Activo</span>'
      : '<span class="status-badge status-inactive">● Inactivo</span>';

    // Botón de toggle (no mostrar desactivar para sí mismo)
    const isSelf = u.username === currentUser.username;
    let toggleBtn;
    if (isSelf) {
      toggleBtn = '<button class="btn btn-sm btn-danger-outline" disabled>⏸ Desactivar</button>';
    } else if (isActive) {
      toggleBtn = `<button class="btn btn-sm btn-danger-outline" onclick="toggleUserStatus(${realIndex}, 'NO')">⏸ Desactivar</button>`;
    } else {
      toggleBtn = `<button class="btn btn-sm btn-success-outline" onclick="toggleUserStatus(${realIndex}, 'SI')">▶ Activar</button>`;
    }

    // Botón de editar
    const editBtn = `<button class="btn btn-sm btn-teal-outline" onclick="openUserModal('edit', ${realIndex})">✏️ Editar</button>`;

    return `<tr class="${!isActive ? 'row-inactive' : ''}">
      <td><strong>${u.username}</strong></td>
      <td>${u.nombre}</td>
      <td><span class="${rolClass}">${rolLabel}</span></td>
      <td>${statusBadge}</td>
      <td>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          ${editBtn}
          ${toggleBtn}
        </div>
      </td>
    </tr>`;
  }).join('');

  // Barra de paginación
  const info = `Mostrando ${start + 1}–${end} de ${totalRecords} usuarios`;
  let pageButtons = '';
  const delta = 2;
  const rangeStart = Math.max(1, userPage - delta);
  const rangeEnd = Math.min(totalPages, userPage + delta);

  if (rangeStart > 1) {
    pageButtons += `<button class="page-btn" onclick="goToUserPage(1)">1</button>`;
    if (rangeStart > 2) pageButtons += `<span class="page-ellipsis">…</span>`;
  }
  for (let i = rangeStart; i <= rangeEnd; i++) {
    pageButtons += `<button class="page-btn ${i === userPage ? 'active' : ''}" onclick="goToUserPage(${i})">${i}</button>`;
  }
  if (rangeEnd < totalPages) {
    if (rangeEnd < totalPages - 1) pageButtons += `<span class="page-ellipsis">…</span>`;
    pageButtons += `<button class="page-btn" onclick="goToUserPage(${totalPages})">${totalPages}</button>`;
  }

  pagerEl.innerHTML = `
    <span class="page-info">${info}</span>
    <div class="page-controls">
      <button class="page-btn" onclick="goToUserPage(${userPage - 1})" ${userPage === 1 ? 'disabled' : ''}>‹</button>
      ${pageButtons}
      <button class="page-btn" onclick="goToUserPage(${userPage + 1})" ${userPage === totalPages ? 'disabled' : ''}>›</button>
    </div>`;
}

function goToUserPage(page) {
  const totalPages = Math.ceil(currentUserList.length / PAGE_SIZE);
  if (page < 1 || page > totalPages) return;
  userPage = page;
  renderUsersTable();
}

// ── Modal de usuario ──
function openUserModal(mode, index) {
  editingUserIndex = (mode === 'edit' && index !== undefined) ? index : -1;
  const isEdit = editingUserIndex >= 0;
  const modal = document.getElementById('user-modal-overlay');

  document.getElementById('user-modal-title').textContent = isEdit ? 'Editar Usuario' : 'Nuevo Usuario';

  const usernameInput = document.getElementById('user-username');
  const nombreInput = document.getElementById('user-nombre');
  const passwordInput = document.getElementById('user-password');
  const rolInput = document.getElementById('user-rol');
  const passwordHint = document.getElementById('user-password-hint');

  if (isEdit) {
    const u = allUsers[index];
    usernameInput.value = u.username;
    usernameInput.disabled = true; // No se puede cambiar el username
    nombreInput.value = u.nombre;
    passwordInput.value = '';
    passwordInput.placeholder = 'Dejar vacío para no cambiar';
    passwordHint.style.display = 'block';
    rolInput.value = u.rol;
  } else {
    usernameInput.value = '';
    usernameInput.disabled = false;
    nombreInput.value = '';
    passwordInput.value = '';
    passwordInput.placeholder = 'Mínimo 4 caracteres';
    passwordHint.style.display = 'none';
    rolInput.value = '';
  }

  modal.classList.add('open');
}

function closeUserModal() {
  document.getElementById('user-modal-overlay').classList.remove('open');
  editingUserIndex = -1;
}

async function saveUser() {
  const isEdit = editingUserIndex >= 0;
  const username = document.getElementById('user-username').value.trim();
  const nombre = document.getElementById('user-nombre').value.trim();
  const password = document.getElementById('user-password').value;
  const rol = document.getElementById('user-rol').value;

  // Validaciones
  if (!isEdit && !username) {
    toast('El usuario es obligatorio', 'error');
    return;
  }
  if (!nombre) {
    toast('El nombre es obligatorio', 'error');
    return;
  }
  if (!rol) {
    toast('Selecciona un rol', 'error');
    return;
  }
  if (!isEdit && !password) {
    toast('La contraseña es obligatoria', 'error');
    return;
  }
  if (password && password.length < 4) {
    toast('La contraseña debe tener al menos 4 caracteres', 'error');
    return;
  }

  showLoading(isEdit ? 'Actualizando usuario...' : 'Creando usuario...');

  try {
    let res;
    if (isEdit) {
      res = await apiCall({
        action: 'updateUser',
        requestedBy: currentUser.username,
        rowIndex: allUsers[editingUserIndex].rowIndex,
        password: password || '',
        nombre,
        rol
      });
    } else {
      res = await apiCall({
        action: 'addUser',
        requestedBy: currentUser.username,
        username,
        password,
        nombre,
        rol
      });
    }

    if (res.success) {
      toast(`✅ ${res.message}`, 'success');
      closeUserModal();
      await loadUsers();
    } else {
      toast(res.message || 'Error al guardar', 'error');
    }
  } catch (e) {
    toast('Error de conexión', 'error');
    console.error(e);
  } finally {
    hideLoading();
  }
}

async function toggleUserStatus(index, newStatus) {
  const u = allUsers[index];
  const action = newStatus === 'NO' ? 'desactivar' : 'activar';

  if (!confirm(`¿Estás seguro de ${action} al usuario "${u.username}"?`)) return;

  showLoading(newStatus === 'NO' ? 'Desactivando...' : 'Activando...');
  try {
    const res = await apiCall({
      action: 'toggleUserStatus',
      requestedBy: currentUser.username,
      rowIndex: u.rowIndex,
      newStatus
    });

    if (res.success) {
      toast(`✅ ${res.message}`, 'success');
      await loadUsers();
    } else {
      toast(res.message || 'Error al cambiar estado', 'error');
    }
  } catch (e) {
    toast('Error de conexión', 'error');
    console.error(e);
  } finally {
    hideLoading();
  }
}