// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN — Reemplaza con tu URL de Google Apps Script
// ═══════════════════════════════════════════════════════════════
const API_URL = 'https://script.google.com/macros/s/AKfycbwY_qVR1m8bX4ocfw8wpvCmxXEnUOy2pfEJcIK-TI5aWzF8AeZzmTPztDnOqCUpnpTBuw/exec';

// ═══════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════════
let currentUser = null;
let allRecords = [];
let currentRecord = null;

// Supervisor: Chart instances
let chartBar = null;
let chartDonut = null;
let chartEnfermeros = null;

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
  const rolLabels = {
    medico: '🩺 Médico',
    admin: '⚙️ Administrador',
    supervisor: '📊 Supervisor',
    enfermero: '🏥 Enfermero/a'
  };
  document.getElementById('user-rol-display').textContent = rolLabels[currentUser.rol] || currentUser.rol;

  const av = document.getElementById('user-avatar');
  av.textContent = currentUser.nombre.charAt(0).toUpperCase();
  const avatarClasses = {
    medico: 'avatar-medico',
    admin: 'avatar-admin',
    supervisor: 'avatar-supervisor',
    enfermero: 'avatar-enfermero'
  };
  av.className = 'user-avatar ' + (avatarClasses[currentUser.rol] || 'avatar-enfermero');

  // Ocultar todas las vistas antes de decidir cuál mostrar
  document.getElementById('view-medico').style.display = 'none';
  document.getElementById('view-enfermero').style.display = 'none';
  document.getElementById('view-admin').style.display = 'none';
  document.getElementById('view-supervisor').style.display = 'none';

  if (currentUser.rol === 'admin') {
    document.getElementById('view-admin').style.display = 'block';
    loadUsers();
  } else if (currentUser.rol === 'medico') {
    document.getElementById('view-medico').style.display = 'block';
    loadRecords();
  } else if (currentUser.rol === 'supervisor') {
    document.getElementById('view-supervisor').style.display = 'block';
    loadSupervisorData();
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
  document.querySelectorAll('#view-enfermero .tab-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');

  document.querySelectorAll('#view-enfermero .panel').forEach(p => p.classList.remove('active'));

  if (tab === 'upload') {
    document.getElementById('panel-upload').classList.add('active');
  } else if (tab === 'my-records') {
    document.getElementById('panel-my-records').classList.add('active');
    loadRecords();
  } else if (tab === 'encuestas') {
    document.getElementById('panel-encuestas-enf').classList.add('active');
    loadEnfSurveys();
  }
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
  const isSupervisor = currentUser.rol === 'supervisor';

  let searchEl, filtroEl;
  if (isSupervisor) {
    searchEl = document.getElementById('search-sup');
    filtroEl = document.getElementById('filtro-general-sup');
  } else if (isMedico) {
    searchEl = document.getElementById('search-med');
    filtroEl = document.getElementById('filtro-general-med');
  } else {
    searchEl = document.getElementById('search-enf');
    filtroEl = document.getElementById('filtro-general-enf');
  }

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

  // Filtros adicionales del supervisor: rango de fechas y enfermero
  if (isSupervisor) {
    const desde = document.getElementById('sup-fecha-desde')?.value;
    const hasta = document.getElementById('sup-fecha-hasta')?.value;
    if (desde) {
      const desdeDate = new Date(desde + 'T00:00:00');
      filtered = filtered.filter(r => parseDateForSort(r.fechaElectro) >= desdeDate);
    }
    if (hasta) {
      const hastaDate = new Date(hasta + 'T23:59:59');
      filtered = filtered.filter(r => parseDateForSort(r.fechaElectro) <= hastaDate);
    }
    const enfFilter = document.getElementById('filtro-enfermero-sup')?.value || 'todos';
    if (enfFilter !== 'todos') {
      filtered = filtered.filter(r => r.subidoPor === enfFilter);
    }
  }

  currentPage = 1;
  currentList = sortList(filtered);
  renderTable(currentList, !q && filtro === 'todos');

  // Actualizar resumen del reporte (supervisor)
  if (isSupervisor) {
    renderReportSummary(filtered);
  }
}

function renderTable(records, isFullList) {
  const isMedico = currentUser.rol === 'medico';
  const isSupervisor = currentUser.rol === 'supervisor';

  let tbody, cols;
  if (isSupervisor) {
    tbody = document.getElementById('sup-table-body');
    cols = 9;
  } else if (isMedico) {
    tbody = document.getElementById('med-table-body');
    cols = 9;
  } else {
    tbody = document.getElementById('my-table-body');
    cols = 8;
  }

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
    } else if (isSupervisor) {
      return `<tr>
        <td><strong>${r.nombrePaciente}</strong></td>
        <td style="color:var(--text-2)">${r.cedulaPaciente}</td>
        <td>${formatDate(r.fechaElectro)}</td>
        <td>${formatDateTime(r.fechaSubida)}</td>
        <td>${r.subidoPor}</td>
        <td>${verBtn}</td>
        <td>${aprobadoBadge}</td>
        <td>${obsBadge}</td>
        <td>${detBtn}</td>
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
    } else if (u.rol === 'supervisor') {
      rolLabel = '📊 Supervisor';
      rolClass = 'rol-badge rol-supervisor';
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

// ═══════════════════════════════════════════════════════════════
// SUPERVISOR — Tab navigation
// ═════════════════════════════════════════════════════════════==
function showSupervisorTab(tab, btnEl) {
  // Toggle tab buttons
  document.querySelectorAll('#view-supervisor .tab-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');

  // Toggle panels
  document.getElementById('panel-dashboard').classList.remove('active');
  document.getElementById('panel-reportes').classList.remove('active');
  document.getElementById('panel-encuestas-sup').classList.remove('active');

  if (tab === 'dashboard') {
    document.getElementById('panel-dashboard').classList.add('active');
  } else if (tab === 'reportes') {
    document.getElementById('panel-reportes').classList.add('active');
    renderRecords(allRecords);
    renderReportSummary(allRecords);
  } else if (tab === 'encuestas') {
    document.getElementById('panel-encuestas-sup').classList.add('active');
    loadSurveys();
  }
}


// ═══════════════════════════════════════════════════════════════
// SUPERVISOR — Cargar datos
// ═════════════════════════════════════════════════════════======
async function loadSupervisorData() {
  showLoading('Cargando dashboard...');
  try {
    const [recRes, survRes] = await Promise.all([
      apiCall({ action: 'getRecords', rol: currentUser.rol, username: currentUser.username }),
      apiCall({ action: 'getSurveys', rol: currentUser.rol, username: currentUser.username })
    ]);

    if (recRes.success) {
      allRecords = recRes.records;
      renderDashboard(allRecords);
      populateEnfermeroFilter(allRecords);
    }

    if (survRes.success) {
      renderSurveysTable(survRes.surveys);
    }
  } catch (e) {
    toast('Error de conexión', 'error');
    console.error(e);
  } finally {
    hideLoading();
  }
}

// ═══════════════════════════════════════════════════════════════
// SUPERVISOR — Dashboard KPIs
// ═══════════════════════════════════════════════════════════════
function renderDashboard(records) {
  // Determinar rango de fechas para filtrar
  const desdeInput = document.getElementById('dash-fecha-desde')?.value;
  const hastaInput = document.getElementById('dash-fecha-hasta')?.value;

  let filteredRecords = records;

  if (desdeInput && hastaInput) {
    const desdeDate = new Date(desdeInput + 'T00:00:00');
    const hastaDate = new Date(hastaInput + 'T23:59:59');
    filteredRecords = records.filter(r => {
      const rd = parseDateForSort(r.fechaElectro);
      return rd >= desdeDate && rd <= hastaDate;
    });
  } else {
    // Sin filtro: usar últimos 7 días
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
    filteredRecords = records.filter(r => {
      const rd = parseDateForSort(r.fechaElectro);
      return rd >= startDate && rd <= endDate;
    });
  }

  const total = filteredRecords.length;
  const aprobados = filteredRecords.filter(r => r.aprobado === 'Aprobado').length;
  const rechazados = filteredRecords.filter(r => r.aprobado === 'No Aprobado').length;
  const pendientes = total - aprobados - rechazados;

  const pctAprobados = total ? Math.round((aprobados / total) * 100) : 0;
  const pctRechazados = total ? Math.round((rechazados / total) * 100) : 0;
  const pctPendientes = total ? Math.round((pendientes / total) * 100) : 0;

  const kpiGrid = document.getElementById('kpi-grid');
  kpiGrid.innerHTML = `
    <div class="kpi-card kpi-total">
      <div class="kpi-icon">📋</div>
      <div class="kpi-value">${total}</div>
      <div class="kpi-label">Total ECG</div>
    </div>
    <div class="kpi-card kpi-aprobados">
      <div class="kpi-icon">✅</div>
      <div class="kpi-value">${aprobados} <span class="kpi-pct">${pctAprobados}%</span></div>
      <div class="kpi-label">Aprobados</div>
    </div>
    <div class="kpi-card kpi-rechazados">
      <div class="kpi-icon">❌</div>
      <div class="kpi-value">${rechazados} <span class="kpi-pct">${pctRechazados}%</span></div>
      <div class="kpi-label">No Aprobados</div>
    </div>
    <div class="kpi-card kpi-pendientes">
      <div class="kpi-icon">⏳</div>
      <div class="kpi-value">${pendientes} <span class="kpi-pct">${pctPendientes}%</span></div>
      <div class="kpi-label">Pendientes</div>
    </div>`;

  renderCharts(filteredRecords);
}

function filterDashboard() {
  // renderDashboard ya hace el filtrado internamente por fechaElectro
  renderDashboard(allRecords);
}

function clearDashboardFilter() {
  document.getElementById('dash-fecha-desde').value = '';
  document.getElementById('dash-fecha-hasta').value = '';
  renderDashboard(allRecords);
}

function renderCharts(records) {
  // Destroy previous chart instances
  if (chartBar) { chartBar.destroy(); chartBar = null; }
  if (chartDonut) { chartDonut.destroy(); chartDonut = null; }
  if (chartEnfermeros) { chartEnfermeros.destroy(); chartEnfermeros = null; }

  // Determinar rango de fechas para el gráfico
  const desdeInput = document.getElementById('dash-fecha-desde')?.value;
  const hastaInput = document.getElementById('dash-fecha-hasta')?.value;
  let startDate, endDate, daysRange, chartTitle;

  if (desdeInput && hastaInput) {
    startDate = new Date(desdeInput + 'T00:00:00');
    endDate = new Date(hastaInput + 'T23:59:59');
    daysRange = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    const [y1, m1, d1] = desdeInput.split('-');
    const [y2, m2, d2] = hastaInput.split('-');
    chartTitle = `📈 ECG subidos (${d1}/${m1} - ${d2}/${m2})`;
  } else {
    endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
    daysRange = 7;
    chartTitle = '📈 ECG subidos por día (últimos 7 días)';
  }

  // Bar Chart: ECG subidos por día
  const labels = [];
  const counts = [];
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  for (let i = 0; i < daysRange; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    const nextD = new Date(d);
    nextD.setDate(nextD.getDate() + 1);

    labels.push(`${dayNames[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`);

    counts.push(records.filter(r => {
      const rd = parseDateForSort(r.fechaElectro);
      return rd >= d && rd < nextD;
    }).length);
  }

  const barCtx = document.getElementById('chart-bar');
  if (barCtx) {
    chartBar = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'ECG subidos',
          data: counts,
          backgroundColor: 'rgba(123, 31, 162, 0.7)',
          borderColor: '#7b1fa2',
          borderWidth: 1,
          borderRadius: 6,
          maxBarThickness: 40
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } },
          x: { ticks: {} }
        }
      }
    });
  }

  // Actualizar título
  const chartBarTitle = document.getElementById('chart-bar-title');
  if (chartBarTitle) chartBarTitle.textContent = chartTitle;

  // Donut Chart: Distribución de estados
  const aprobados = records.filter(r => r.aprobado === 'Aprobado').length;
  const rechazados = records.filter(r => r.aprobado === 'No Aprobado').length;
  const pendientes = records.length - aprobados - rechazados;

  const donutCtx = document.getElementById('chart-donut');
  if (donutCtx) {
    chartDonut = new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels: ['Aprobados', 'No Aprobados', 'Pendientes'],
        datasets: [{
          data: [aprobados, rechazados, pendientes],
          backgroundColor: ['#66bb6a', '#ef5350', '#ffa726'],
          borderColor: '#fff',
          borderWidth: 3
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%' }
    });
  }

  // Horizontal Bar: ECG por enfermero
  const enfermeroMap = {};
  records.forEach(r => {
    const enf = r.subidoPor || 'Desconocido';
    enfermeroMap[enf] = (enfermeroMap[enf] || 0) + 1;
  });
  const sortedEnf = Object.entries(enfermeroMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const enfLabels = sortedEnf.map(e => e[0]);
  const enfCounts = sortedEnf.map(e => e[1]);

  const enfCtx = document.getElementById('chart-enfermeros');
  if (enfCtx) {
    chartEnfermeros = new Chart(enfCtx, {
      type: 'bar',
      indexAxis: 'y',
      data: {
        labels: enfLabels,
        datasets: [{ label: 'ECG', data: enfCounts, backgroundColor: '#0097a7cc' }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}

// ═══════════════════════════════════════════════════════
// SUPERVISOR — Poblar dropdown de enfermeros
// ═══════════════════════════════════════════════════════
function populateEnfermeroFilter(records) {
  const select = document.getElementById('filtro-enfermero-sup');
  if (!select) return;

  const enfermeros = [...new Set(records.map(r => r.subidoPor).filter(Boolean))].sort();

  // Mantener valor actual si existe
  const currentVal = select.value;
  select.innerHTML = '<option value="todos">Todos los enfermeros</option>';
  enfermeros.forEach(enf => {
    select.innerHTML += `<option value="${enf}" ${currentVal === enf ? 'selected' : ''}>${enf}</option>`;
  });
}

// ═══════════════════════════════════════════════════════════════
// SUPERVISOR — Resumen del reporte
// ═══════════════════════════════════════════════════════════════
function renderReportSummary(records) {
  const container = document.getElementById('sup-report-summary');
  if (!container) return;

  if (!records.length) {
    container.innerHTML = '';
    return;
  }

  const total = records.length;
  const aprobados = records.filter(r => r.aprobado === 'Aprobado').length;
  const rechazados = records.filter(r => r.aprobado === 'No Aprobado').length;
  const pendientes = total - aprobados - rechazados;

  container.innerHTML = `
    <div class="report-summary">
      <span class="report-summary-item">📊 <strong>${total}</strong> registros encontrados</span>
      <span class="report-summary-divider"></span>
      <span class="report-summary-item">✅ ${aprobados} aprobados</span>
      <span class="report-summary-divider"></span>
      <span class="report-summary-item">❌ ${rechazados} rechazados</span>
      <span class="report-summary-divider"></span>
      <span class="report-summary-item">⏳ ${pendientes} pendientes</span>
</div>`;
}

// ═══════════════════════════════════════════════════════
// SUPERVISOR — Cargar datos (continuación)
// ═════════════════════════════════════════════════════==
function populateEnfermeroFilter(records) {
  const select = document.getElementById('filtro-enfermero-sup');
  if (!select) return;

  const enfermeros = [...new Set(records.map(r => r.subidoPor).filter(Boolean))].sort();
  select.innerHTML = '<option value="todos">Todos los enfermeros</option>' +
    enfermeros.map(e => `<option value="${e}">${e}</option>`).join('');
}

let currentSurvey = null;
let surveyQuestions = [];
let currentSurveyRespData = [];
let currentSurveyRespId = null;
let currentSurveyForReport = null;
let filteredResponses = [];
let dateFilterFrom = null;
let dateFilterTo = null;

// ═══════════════════════════════════════════════════════════════
// SUPERVISOR — Encuestas
// ═══════════════════════════════════════════════════════
function loadSurveys() {
  apiCall({ action: 'getSurveys', rol: currentUser.rol, username: currentUser.username })
    .then(res => {
      if (res.success) renderSurveysTable(res.surveys);
      else toast('Error al cargar encuestas', 'error');
    });
}

function renderSurveysTable(surveys) {
  const tbody = document.getElementById('surveys-table-body');
  if (!tbody) return;

  if (!surveys.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-row">No hay encuestas creadas</td></tr>';
    return;
  }

  tbody.innerHTML = surveys.map(s => {
    const activa = s.activa ? 'SI' : 'NO';
    return `<tr>
      <td><strong>${s.titulo}</strong></td>
      <td>${s.creadaPor}</td>
      <td>${s.fechaCreacion}</td>
      <td><span class="obs-badge ${s.activa ? 'obs-yes' : 'obs-no'}">${s.activa ? 'Activa' : 'Inactiva'}</span></td>
      <td>${s.totalRespuestas}</td>
      <td>
        <button type="button" class="btn btn-sm btn-teal-outline" data-action="edit" data-id="${s.id}">✏️ Editar</button>
        <button type="button" class="btn btn-sm btn-secondary" data-action="responses" data-id="${s.id}">📋 Respuestas</button>
        <button type="button" class="btn btn-sm btn-danger-outline" data-action="delete" data-id="${s.id}">🗑️ Eliminar</button>
      </td>
    </tr>`;
  }).join('');

  // Add event listeners to buttons
  tbody.querySelectorAll('button[data-action]').forEach(btn => {
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      const action = e.target.dataset.action;
      const id = e.target.dataset.id;
      if (action === 'edit') editSurvey(id);
      else if (action === 'responses') viewSurveyResponses(id);
      else if (action === 'delete') showConfirmModal('¿Estás seguro de eliminar esta encuesta? Se perderán todas las respuestas.', () => doDeleteDirect(id));
    };
  });
}

function showConfirmModal(message, onConfirm) {
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-ok-btn').onclick = function () {
    closeConfirmModal();
    onConfirm();
  };
  document.getElementById('confirm-modal').style.display = 'flex';
  document.getElementById('confirm-modal').classList.add('open');
}

function closeConfirmModal() {
  document.getElementById('confirm-modal').style.display = 'none';
  document.getElementById('confirm-modal').classList.remove('open');
}

function doDeleteDirect(id) {
  showLoading('Eliminando...');

  fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'deleteSurvey', id: id })
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        toast('✅ Encuesta eliminada', 'success');
        loadSurveys();
      } else {
        toast(res.message || 'Error al eliminar', 'error');
      }
    })
    .catch(err => {
      toast('Error de conexión', 'error');
    })
    .finally(() => {
      hideLoading();
    });
}

function confirmDeleteSurvey(id) {
  if (!confirm('¿Estás seguro de eliminar esta encuesta? Se perderán todas las respuestas.')) return;

  showLoading('Eliminando...');
  try {
    const res = apiCall({ action: 'deleteSurvey', id });
    res.then(r => {
      if (r.success) {
        toast('✅ Encuesta eliminada', 'success');
        loadSurveys();
      } else {
        toast(r.message || 'Error al eliminar', 'error');
      }
    });
  } catch (e) {
    console.error('Delete error:', e);
    toast('Error de conexión', 'error');
  } finally {
    hideLoading();
  }
}

function showCreateSurvey() {
  currentSurvey = null;
  surveyQuestions = [];
  document.getElementById('survey-titulo').value = '';
  document.getElementById('survey-desc').value = '';
  document.getElementById('survey-questions-builder').innerHTML = '';
  addQuestion();
  document.getElementById('sup-surveys-list').style.display = 'none';
  document.getElementById('sup-survey-form').style.display = 'block';
}

function addQuestion() {
  const idx = surveyQuestions.length;
  surveyQuestions.push({ tipo: 'texto', pregunta: '', opciones: [] });
  renderQuestionsBuilder();
}

function removeQuestion(idx) {
  surveyQuestions.splice(idx, 1);
  renderQuestionsBuilder();
}

function renderQuestionsBuilder() {
  const container = document.getElementById('survey-questions-builder');
  container.innerHTML = surveyQuestions.map((q, i) => `
    <div class="question-card">
      <button class="question-delete" onclick="removeQuestion(${i})">✕</button>
      <div class="question-card-header">
        <span class="question-number">${i + 1}</span>
        <input class="form-input" type="text" placeholder="Escribe la pregunta"
          value="${q.pregunta}" onchange="updateQuestion(${i}, 'pregunta', this.value)">
      </div>
      <div class="question-card-body">
        <select class="form-input" style="width:200px" onchange="updateQuestionType(${i}, this.value)">
          <option value="texto" ${q.tipo === 'texto' ? 'selected' : ''}>Texto</option>
          <option value="radio" ${q.tipo === 'radio' ? 'selected' : ''}>Opción múltiple (una)</option>
          <option value="checkbox" ${q.tipo === 'checkbox' ? 'selected' : ''}>Opción múltiple (varias)</option>
          <option value="numero" ${q.tipo === 'numero' ? 'selected' : ''}>Número</option>
          <option value="textarea" ${q.tipo === 'textarea' ? 'selected' : ''}>Texto largo</option>
        </select>
        ${(q.tipo === 'radio' || q.tipo === 'checkbox') ? `
          <div class="options-builder">
            <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;font-weight:600;margin-bottom:6px;">Opciones</div>
            ${(q.opciones || []).map((opt, oi) => `
              <div class="option-item">
                <input class="form-input" type="text" value="${opt}"
                  onchange="updateOptionValue(${i}, ${oi}, this.value)" placeholder="Opción">
                <button class="btn btn-sm btn-danger-outline" onclick="removeOption(${i}, ${oi})">✕</button>
              </div>
            `).join('')}
            <button class="btn btn-sm btn-teal-outline" onclick="addOption(${i})">➕ Agregar opción</button>
          </div>
        ` : ''}
      </div>
      <div class="question-validation" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;">
          <input type="checkbox" ${q.obligatoria ? 'checked' : ''} onchange="updateQuestion(${i}, 'obligatoria', this.checked)">
          Obligatoria
        </label>
        ${q.tipo === 'numero' ? `
          <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
            <input type="number" class="form-input" style="width:80px" placeholder="Mín" value="${q.valorMin === undefined ? '' : q.valorMin}" 
              onchange="updateQuestion(${i}, 'valorMin', this.value !== '' ? parseFloat(this.value) : undefined)">
            <span style="color:var(--text-2)">-</span>
            <input type="number" class="form-input" style="width:80px" placeholder="Máx" value="${q.valorMax === undefined ? '' : q.valorMax}" 
              onchange="updateQuestion(${i}, 'valorMax', this.value !== '' ? parseFloat(this.value) : undefined)">
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function updateQuestionType(idx, value) {
  surveyQuestions[idx].tipo = value;
  if (value === 'radio' || value === 'checkbox') {
    surveyQuestions[idx].opciones = surveyQuestions[idx].opciones || [''];
  } else {
    surveyQuestions[idx].opciones = null;
  }
  renderQuestionsBuilder();
}

function addOption(qIdx) {
  surveyQuestions[qIdx].opciones.push('');
  renderQuestionsBuilder();
}

function removeOption(qIdx, oIdx) {
  surveyQuestions[qIdx].opciones.splice(oIdx, 1);
  renderQuestionsBuilder();
}

function updateOptionValue(qIdx, oIdx, value) {
  surveyQuestions[qIdx].opciones[oIdx] = value;
}

function updateQuestion(idx, field, value) {
  surveyQuestions[idx][field] = value;
}

async function saveSurvey() {
  const titulo = document.getElementById('survey-titulo').value.trim();
  const descripcion = document.getElementById('survey-desc').value.trim();

  if (!titulo) {
    toast('El título es obligatorio', 'error');
    return;
  }

  const validQuestions = surveyQuestions.filter(q => q.pregunta.trim());
  if (!validQuestions.length) {
    toast('Agrega al menos una pregunta', 'error');
    return;
  }

  showLoading('Guardando...');
  try {
    let res;
    if (currentSurvey) {
      res = await apiCall({
        action: 'updateSurvey',
        id: currentSurvey.id,
        titulo,
        descripcion,
        preguntas: validQuestions
      });
    } else {
      res = await apiCall({
        action: 'createSurvey',
        titulo,
        descripcion,
        preguntas: validQuestions,
        creadaPor: currentUser.username
      });
    }

    if (res.success) {
      toast('✅ Encuesta guardada correctamente', 'success');
      backToSurveyAdmin();
      loadSurveys();
    } else {
      toast(res.message || 'Error al guardar', 'error');
    }
  } catch (e) {
    toast('Error de conexión', 'error');
  } finally {
    hideLoading();
  }
}

function editSurvey(id) {
  apiCall({ action: 'getSurveys', rol: currentUser.rol, username: currentUser.username })
    .then(res => {
      if (!res.success) return;
      const s = res.surveys.find(x => x.id === id);
      if (!s) return;

      currentSurvey = s;
      surveyQuestions = s.preguntas || [];
      document.getElementById('survey-titulo').value = s.titulo;
      document.getElementById('survey-desc').value = s.descripcion || '';
      renderQuestionsBuilder();
      document.getElementById('sup-surveys-list').style.display = 'none';
      document.getElementById('sup-survey-form').style.display = 'block';
    });
}

async function confirmDeleteSurvey(id) {
  if (!confirm('¿Estás seguro de eliminar esta encuesta? Se perderán todas las respuestas.')) return;

  showLoading('Eliminando...');
  try {
    console.log('Sending delete request for ID:', id);
    const res = await apiCall({ action: 'deleteSurvey', id: id });
    console.log('Delete response:', res);
    alert('Debug: ' + JSON.stringify(res.debug || []));
    if (res.success) {
      toast('✅ Encuesta eliminada', 'success');
      loadSurveys();
    } else {
      toast(res.message || 'Error al eliminar', 'error');
    }
  } catch (e) {
    console.error('Delete error:', e);
    alert('Error: ' + e.message);
    toast('Error de conexión', 'error');
  } finally {
    hideLoading();
  }
}

function viewSurveyResponses(id) {
  apiCall({ action: 'getSurveys', rol: currentUser.rol, username: currentUser.username })
    .then(res => {
      if (!res.success) return;
      const s = res.surveys.find(x => x.id === id);
      if (!s) return;

      document.getElementById('responses-survey-title').textContent = s.titulo;
      document.getElementById('responses-survey-desc').textContent = s.descripcion || '';
      document.getElementById('sup-surveys-list').style.display = 'none';
      document.getElementById('sup-survey-form').style.display = 'none';
      document.getElementById('sup-survey-responses').style.display = 'block';

      currentSurveyRespId = id;
      loadSurveyResponses(id, s);
    });
}

async function loadSurveyResponses(id, survey) {
  currentSurveyRespId = id;
  currentSurveyForReport = survey;
  dateFilterFrom = null;
  dateFilterTo = null;
  document.getElementById('filter-date-from').value = '';
  document.getElementById('filter-date-to').value = '';
  document.getElementById('responses-table-body').innerHTML = '<tr><td colspan="3" class="loading-row">Cargando respuestas...</td></tr>';

  try {
    const res = await apiCall({ action: 'getSurveyResponses', encuestaId: id });
    if (res.success && currentSurveyRespId === id) {
      currentSurveyRespData = res.responses || [];
      filteredResponses = [...currentSurveyRespData];
      renderResponsesTable(filteredResponses, survey);
      switchTab('responses-list');
    }
  } catch (e) {
    if (currentSurveyRespId === id) {
      toast('Error de conexión', 'error');
    }
  }
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.style.color = isActive ? 'var(--teal)' : 'var(--text-2)';
    btn.style.borderBottom = isActive ? '2px solid var(--teal)' : '2px solid transparent';
    btn.style.marginBottom = '-2px';
  });

  document.querySelectorAll('.tab-content').forEach(content => {
    content.style.display = 'none';
  });

  document.getElementById('tab-' + tabName).style.display = 'block';

  if (tabName === 'responses-report' && currentSurveyForReport) {
    renderSurveyReport(filteredResponses, currentSurveyForReport);
  }
}

function applyDateFilter() {
  const fromStr = document.getElementById('filter-date-from').value;
  const toStr = document.getElementById('filter-date-to').value;

  dateFilterFrom = fromStr ? new Date(fromStr + 'T00:00:00') : null;
  dateFilterTo = toStr ? new Date(toStr + 'T23:59:59') : null;

  filteredResponses = currentSurveyRespData.filter(r => {
    const respDate = parseDate(r.fechaRespuesta);
    if (!respDate) return true;

    if (dateFilterFrom && respDate < dateFilterFrom) return false;
    if (dateFilterTo && respDate > dateFilterTo) return false;

    return true;
  });

  renderResponsesTable(filteredResponses, currentSurveyForReport);
}

function clearDateFilter() {
  document.getElementById('filter-date-from').value = '';
  document.getElementById('filter-date-to').value = '';
  dateFilterFrom = null;
  dateFilterTo = null;
  filteredResponses = [...currentSurveyRespData];
  renderResponsesTable(filteredResponses, currentSurveyForReport);
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Formato: dd/MM/yyyy hh:mm:ss a
  const parts = dateStr.split(' ');
  if (parts.length < 2) return null;

  const dateParts = parts[0].split('/');
  if (dateParts.length !== 3) return null;

  const timeParts = parts[1].split(':');
  const hour = parseInt(timeParts[0]) || 0;
  const minute = parseInt(timeParts[1]) || 0;
  const second = parseInt(timeParts[2]) || 0;
  const ampm = parts[2] ? parts[2].toLowerCase() : '';

  let hour24 = hour;
  if (ampm === 'pm' && hour !== 12) hour24 = hour + 12;
  if (ampm === 'am' && hour === 12) hour24 = 0;

  return new Date(dateParts[2], dateParts[1] - 1, dateParts[0], hour24, minute, second);
}

function renderResponsesTable(responses, survey) {
  const tbody = document.getElementById('responses-table-body');
  const summary = document.getElementById('responses-summary');
  const report = document.getElementById('survey-report');

  if (!responses.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="loading-row">No hay respuestas aún</td></tr>';
    summary.innerHTML = '';
    report.innerHTML = '';
    return;
  }

  summary.innerHTML = `<div class="report-summary">
    <span class="report-summary-item">📊 <strong>${responses.length}</strong> respuestas</span>
  </div>`;

  tbody.innerHTML = responses.map(r => `
    <tr>
      <td>${r.respondidoPor}</td>
      <td>${r.fechaRespuesta}</td>
      <td><button class="btn btn-sm btn-secondary" onclick="viewResponseDetail('${r.id}')">🔍 Ver</button></td>
    </tr>
  `).join('');

  renderSurveyReport(responses, survey);
}

function renderSurveyReport(responses, survey) {
  const report = document.getElementById('survey-report');
  if (!survey || !survey.preguntas || !responses.length) {
    report.innerHTML = '';
    return;
  }

  let html = '<div class="survey-report-container" style="margin-top:20px">';
  html += '<h4 style="margin-bottom:16px">📈 Reporte de la Encuesta</h4>';

  survey.preguntas.forEach((pregunta, idx) => {
    const respuestasPregunta = responses
      .map(r => {
        let respuestasArray = [];
        if (r.respuestas) {
          respuestasArray = Array.isArray(r.respuestas) ? r.respuestas : JSON.parse(r.respuestas);
        }
        return respuestasArray.find(item => item.pregunta === pregunta.pregunta);
      })
      .filter(r => r && r.respuesta);

    html += '<div class="report-question" style="margin-bottom:20px;padding:16px;background:var(--bg-2);border-radius:8px">';
    html += `<div style="font-weight:600;margin-bottom:12px">${idx + 1}. ${pregunta.pregunta}</div>`;

    if (!respuestasPregunta.length) {
      html += '<div style="color:var(--text-2);font-size:13px">Sin respuestas</div>';
    } else {
      switch (pregunta.tipo) {
        case 'radio':
        case 'checkbox':
          const conteo = {};
          respuestasPregunta.forEach(r => {
            const vals = Array.isArray(r.respuesta) ? r.respuesta : [r.respuesta];
            vals.forEach(v => {
              conteo[v] = (conteo[v] || 0) + 1;
            });
          });
          html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
          Object.entries(conteo).forEach(([opcion, count]) => {
            const pct = ((count / respuestasPregunta.length) * 100).toFixed(1);
            html += `<div style="padding:8px 12px;background:var(--bg-1);border-radius:6px;font-size:13px">
              <strong>${opcion}</strong>: ${count} (${pct}%)
            </div>`;
          });
          html += '</div>';
          break;

        case 'numero':
          const nums = respuestasPregunta.map(r => parseFloat(r.respuesta)).filter(n => !isNaN(n));
          if (nums.length) {
            const min = Math.min(...nums);
            const max = Math.max(...nums);
            const avg = (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2);
            html += `<div style="display:flex;gap:16px;font-size:13px">
              <span>Min: <strong>${min}</strong></span>
              <span>Max: <strong>${max}</strong></span>
              <span>Promedio: <strong>${avg}</strong></span>
            </div>`;
          }
          break;

        case 'texto':
        case 'textarea':
          html += `<div style="font-size:13px;color:var(--text-2)">
            ${respuestasPregunta.length} respuesta(s) de texto
          </div>`;
          break;
      }
    }

    html += '</div>';
  });

  html += '</div>';
  report.innerHTML = html;
}

function viewResponseDetail(id) {
  const response = currentSurveyRespData.find(r => r.id === id);

  if (!response) {
    toast('Respuesta no encontrada', 'error');
    return;
  }
  
  let html = `<div style="max-width:500px;padding:20px">
    <h3 style="margin-bottom:16px">📋 Respuesta de ${response.respondidoPor}</h3>
    <p style="color:var(--text-2);margin-bottom:16px">📅 ${response.fechaRespuesta}</p>`;
  
  if (response.respuestas && Array.isArray(response.respuestas)) {
    response.respuestas.forEach((resp, i) => {
      html += `<div style="margin-bottom:12px;padding:12px;background:var(--bg-2);border-radius:8px">
        <div style="font-weight:600;margin-bottom:4px">${i + 1}. ${resp.pregunta}</div>
        <div style="color:var(--text-2)">${resp.respuesta || '(sin respuesta)'}</div>
      </div>`;
    });
  } else if (response.respuestas) {
    const respuestas = JSON.parse(response.respuestas);
    if (Array.isArray(respuestas)) {
      respuestas.forEach((resp, i) => {
        html += `<div style="margin-bottom:12px;padding:12px;background:var(--bg-2);border-radius:8px">
          <div style="font-weight:600;margin-bottom:4px">${i + 1}. ${resp.pregunta}</div>
          <div style="color:var(--text-2)">${resp.respuesta || '(sin respuesta)'}</div>
        </div>`;
      });
    }
  }
  
  //html += `<button class="btn btn-secondary" onclick="closeModal()" style="margin-top:16px">Cerrar</button></div>`;
  
  showModal(html);
}

function showModal(content) {
  let modal = document.getElementById('modal-overlay');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h4 class="modal-title" id="modal-title">Detalle</h4>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  const body = modal.querySelector('.modal-body');
  body.innerHTML = content;
  modal.classList.add('open');
}

function backToSurveyAdmin() {
  currentSurvey = null;
  surveyQuestions = [];
  currentSurveyRespData = [];
  currentSurveyRespId = null;
  currentSurveyForReport = null;
  filteredResponses = [];
  dateFilterFrom = null;
  dateFilterTo = null;
  document.getElementById('sup-survey-form').style.display = 'none';
  document.getElementById('sup-survey-responses').style.display = 'none';
  document.getElementById('sup-surveys-list').style.display = 'block';
  loadSurveys();
}

// ═══════════════════════════════════════════════════════════════
// ENFERMERO — Encuestas
// ═══════════════════════════════════════════════════════════════
let currentEnfSurvey = null;
let enfSurveyResponses = {};

function loadEnfSurveys() {
  const container = document.getElementById('enf-surveys-cards');
  container.innerHTML = '<div class="surveys-empty"><div class="empty-icon">⏳</div><div class="empty-title">Cargando encuestas...</div></div>';

  apiCall({ action: 'getSurveys', rol: currentUser.rol, username: currentUser.username })
    .then(res => {
      if (res.success) renderEnfSurveysList(res.surveys);
      else {
        container.innerHTML = '<div class="surveys-empty"><div class="empty-icon">❌</div><div class="empty-title">Error al cargar encuestas</div></div>';
        toast('Error al cargar encuestas', 'error');
      }
    })
    .catch(() => {
      container.innerHTML = '<div class="surveys-empty"><div class="empty-icon">❌</div><div class="empty-title">Error de conexión</div></div>';
    });
}

function renderEnfSurveysList(surveys) {
  const container = document.getElementById('enf-surveys-cards');
  if (!container) return;

  const activeSurveys = surveys.filter(s => s.activa);

  if (!activeSurveys.length) {
    container.innerHTML = '<div class="surveys-empty"><div class="empty-icon">📝</div><div class="empty-title">No hay encuestas disponibles</div><div class="empty-desc">Actualmente no hay encuestas activas.</div></div>';
    return;
  }

  // Ordenar de más reciente a más antigua
  activeSurveys.sort((a, b) => {
    const dateA = parseDate(a.fechaCreacion) || new Date(0);
    const dateB = parseDate(b.fechaCreacion) || new Date(0);
    return dateB - dateA;
  });

  container.innerHTML = activeSurveys.map(s => {
    const badgeClass = s.respuestaHoy ? 'survey-completed' : 'survey-pending';
    const badgeText = s.respuestaHoy ? 'Respondida hoy' : 'Pendiente';
    return `
    <div class="survey-card">
      <div class="survey-card-header">
        <h4>${s.titulo}</h4>
        <span class="survey-badge ${badgeClass}">${badgeText}</span>
      </div>
      <p class="survey-desc">${s.descripcion || ''}</p>
      <div class="survey-meta">Creada: ${s.fechaCreacion}</div>
      ${s.respuestaHoy ?
        '<button class="btn btn-secondary" disabled style="opacity:0.6;cursor:not-allowed">✅ Ya respondida hoy</button>' :
        `<button class="btn btn-primary" onclick="openEnfSurveyForm('${s.id}')">📝 Responder Encuesta</button>`
      }
    </div>
  `}).join('');
}

function openEnfSurveyForm(id) {
  apiCall({ action: 'getSurveys', rol: currentUser.rol, username: currentUser.username })
    .then(res => {
      if (!res.success) return;
      const s = res.surveys.find(x => x.id === id);
      if (!s) return;

      currentEnfSurvey = s;
      enfSurveyResponses = {};

      document.getElementById('enf-survey-title').textContent = s.titulo;
      document.getElementById('enf-survey-desc').textContent = s.descripcion || '';

      renderEnfSurveyQuestions(s.preguntas);

      document.getElementById('enf-surveys-list').style.display = 'none';
      document.getElementById('enf-survey-form').style.display = 'block';
    });
}

function renderEnfSurveyQuestions(preguntas) {
  const container = document.getElementById('enf-survey-questions');
  if (!preguntas || !preguntas.length) {
    container.innerHTML = '<p>No hay preguntas en esta encuesta.</p>';
    return;
  }

  container.innerHTML = preguntas.map((p, i) => `
    <div class="survey-question">
      <label class="survey-question-label">
        ${i + 1}. ${p.pregunta}
        ${(p.obligatoria === true || p.obligatoria === 'true') ? '<span class="required-mark">*</span>' : ''}
      </label>
      ${renderEnfQuestionInput(p, i)}
    </div>
  `).join('');
}

function renderEnfQuestionInput(pregunta, idx) {
  const name = 'pregunta_' + idx;
  const respuestas = currentEnfSurvey.preguntas;

  // Texto con opciones = radio buttons
  if (pregunta.tipo === 'texto' && pregunta.opciones && pregunta.opciones.length > 0) {
    const opts = pregunta.opciones || [];
    return `<div class="survey-radio-group">
      ${opts.map((o, oi) => `
        <label>
          <input type="radio" name="${name}" value="${o}" onchange="setEnfResponse(${idx}, this.value)">
          ${o}
        </label>
      `).join('')}
    </div>`;
  }

  if (pregunta.tipo === 'texto') {
    return `<input type="text" class="form-input" name="${name}" onchange="setEnfResponse(${idx}, this.value)">`;
  }

  if (pregunta.tipo === 'numero') {
    return `<input type="number" class="form-input" name="${name}" onchange="setEnfResponse(${idx}, this.value)">`;
  }

  if (pregunta.tipo === 'textarea') {
    return `<textarea class="form-input" name="${name}" rows="3" onchange="setEnfResponse(${idx}, this.value)"></textarea>`;
  }

  if (pregunta.tipo === 'radio') {
    const opts = pregunta.opciones || [];
    return `<div class="survey-radio-group">
      ${opts.map((o, oi) => `
        <label>
          <input type="radio" name="${name}" value="${o}" onchange="setEnfResponse(${idx}, this.value)">
          ${o}
        </label>
      `).join('')}
    </div>`;
  }

  if (pregunta.tipo === 'checkbox') {
    const opts = pregunta.opciones || [];
    return `<div class="survey-checkbox-group">
      ${opts.map((o, oi) => `
        <label>
          <input type="checkbox" name="${name}_${oi}" value="${o}" onchange="setEnfCheckboxResponse(${idx}, '${name}')">
          ${o}
        </label>
      `).join('')}
    </div>`;
  }

  return `<input type="text" class="form-input" name="${name}" onchange="setEnfResponse(${idx}, this.value)">`;
}

function setEnfResponse(idx, value) {
  enfSurveyResponses[idx] = value;
}

function setEnfCheckboxResponse(idx, name) {
  const checkboxes = document.querySelectorAll(`input[name^="${name}"]:checked`);
  const values = Array.from(checkboxes).map(cb => cb.value);
  enfSurveyResponses[idx] = values;
}

async function submitEnfSurveyResponse() {
  const preguntas = currentEnfSurvey.preguntas;

  const respostas = [];
  let incomplete = false;

  for (let i = 0; i < preguntas.length; i++) {
    const p = preguntas[i];
    const esObligatoria = p.obligatoria === true || p.obligatoria === 'true';
    const valor = enfSurveyResponses[i];

    if (esObligatoria && p.tipo === 'checkbox') {
      const checked = document.querySelectorAll(`input[name^="pregunta_${i}_"]:checked`);
      if (checked.length === 0) {
        incomplete = true;
        continue;
      }
      respostas.push({ pregunta: p.pregunta, respuesta: Array.from(checked).map(cb => cb.value).join(', ') });
      continue;
    }

    if (esObligatoria && (!valor || !valor.trim())) {
      incomplete = true;
      continue;
    }

if (p.tipo === 'numero' && (p.valorMin !== undefined || p.valorMax !== undefined)) {
      const num = valor === '' || !valor ? 0 : parseFloat(valor);
      if (p.valorMin !== undefined && num < Number(p.valorMin)) {
        toast(`En "${p.pregunta}" debe ser mayor o igual a ${p.valorMin}`, 'error');
        incomplete = true;
        continue;
      }
      if (p.valorMax !== undefined && num > Number(p.valorMax)) {
        toast(`En "${p.pregunta}" debe ser menor o igual a ${p.valorMax}`, 'error');
        incomplete = true;
        continue;
      }
    }

    if (p.tipo === 'checkbox') {
      const checked = document.querySelectorAll(`input[name^="pregunta_${i}_"]:checked`);
      respostas.push({ pregunta: p.pregunta, respuesta: Array.from(checked).map(cb => cb.value).join(', ') });
    } else if (p.tipo === 'numero') {
      respostas.push({ pregunta: p.pregunta, respuesta: valor === '' || !valor ? '0' : valor });
    } else {
      respostas.push({ pregunta: p.pregunta, respuesta: valor || '' });
    }
  }

  if (incomplete) {
    toast('Responde todas las preguntas obligatorias', 'error');
    return;
  }

  showLoading('Enviando...');
  try {
    const res = await apiCall({
      action: 'submitSurveyResponse',
      encuestaId: currentEnfSurvey.id,
      respondidoPor: currentUser.username,
      respuestas: respostas
    });

    if (res.success) {
      toast('✅ Respuesta enviada correctamente', 'success');
      backToEnfSurveysList();
    } else {
      toast(res.message || 'Error al enviar', 'error');
    }
  } catch (e) {
    toast('Error de conexión', 'error');
  } finally {
    hideLoading();
}
}

function backToEnfSurveysList() {
  currentEnfSurvey = null;
  enfSurveyResponses = {};
  document.getElementById('enf-survey-form').style.display = 'none';
  document.getElementById('enf-surveys-list').style.display = 'block';
  loadEnfSurveys();
}