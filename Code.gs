// ============================================================
// CONFIGURACIÓN
// ============================================================
const SPREADSHEET_ID = '1vmls53Rcv9gth1kOlwcPlRLziVCL94W1X3uGNqTq2-Y';
const DRIVE_FOLDER_ID = '14nmoC5OWBL_k2VH_xowqmhxuZuYbj604';

// ============================================================
// PUNTO DE ENTRADA PRINCIPAL
// ============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    let result;
    switch (action) {
      case 'login':
        result = handleLogin(data);
        break;
      case 'uploadRecord':
        result = handleUploadRecord(data);
        break;
      case 'getRecords':
        result = handleGetRecords(data);
        break;
      case 'saveObservation':
        result = handleSaveObservation(data);
        break;
      case 'saveAprobado':
        result = handleSaveAprobado(data);
        break;
      case 'uploadChunk':
        result = handleUploadChunk(data);
        break;
      // ── Acciones de administración de usuarios ──
      case 'getUsers':
        result = handleGetUsers(data);
        break;
      case 'addUser':
        result = handleAddUser(data);
        break;
      case 'updateUser':
        result = handleUpdateUser(data);
        break;
      case 'toggleUserStatus':
        result = handleToggleUserStatus(data);
        break;
      // ── Acciones de encuestas ──
      case 'createSurvey':
        result = handleCreateSurvey(data);
        break;
      case 'getSurveys':
        result = handleGetSurveys(data);
        break;
      case 'submitSurveyResponse':
        result = handleSubmitSurveyResponse(data);
        break;
      case 'getSurveyResponses':
        result = handleGetSurveyResponses(data);
        break;
      case 'toggleSurvey':
        result = handleToggleSurvey(data);
        break;
      case 'deleteSurvey':
        result = handleDeleteSurvey(data);
        break;
      case 'updateSurvey':
        result = handleUpdateSurvey(data);
        break;
      default:
        result = { success: false, message: 'Acción no reconocida' };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'API activa' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// LOGIN
// ============================================================
function handleLogin(data) {
  const { username, password } = data;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Usuarios');
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === username && row[1] === password) {
      // Verificar estado activo (columna E, índice 4)
      // Si la columna no existe o está vacía, se trata como activo (retrocompatibilidad)
      const activo = (row[4] === undefined || row[4] === '' || String(row[4]).toUpperCase() === 'SI');
      if (!activo) {
        return { success: false, message: 'Tu cuenta está desactivada. Contacta al administrador.' };
      }
      return {
        success: true,
        user: {
          username: row[0],
          nombre: row[2],
          rol: row[3]
        }
      };
    }
  }
  return { success: false, message: 'Usuario o contraseña incorrectos' };
}

// ============================================================
// SUBIR ARCHIVO + REGISTRAR EN SHEETS
// ============================================================
function handleUploadRecord(data) {
  const { fileData, fileName, mimeType, cedulaPaciente, nombrePaciente, fechaElectro, subidoPor, aprobado } = data;

  // Validar que sea PDF
  if (mimeType && mimeType !== 'application/pdf') {
    return { success: false, message: 'Solo se permiten archivos PDF' };
  }

  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const blob = Utilities.newBlob(Utilities.base64Decode(fileData), mimeType, fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileUrl = file.getUrl();
  const fileId = file.getId();

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Electros');
  const tz = 'America/Bogota';

  // Guardar fechas como strings formateados para evitar problemas de zona horaria
  const now = new Date();
  const fechaSubidaStr = Utilities.formatDate(now, tz, 'dd/MM/yyyy hh:mm:ss a');
  const id = Utilities.getUuid();

  // fechaElectro ya viene como "YYYY-MM-DD" del frontend, la guardamos como string visible
  // Formateamos a DD/MM/YYYY para consistencia visual
  let fechaElectroStr;
  if (fechaElectro && typeof fechaElectro === 'string' && fechaElectro.includes('-')) {
    const parts = fechaElectro.split('-');
    fechaElectroStr = parts[2] + '/' + parts[1] + '/' + parts[0];
  } else {
    fechaElectroStr = fechaElectro;
  }

  sheet.appendRow([
    id,
    cedulaPaciente,
    nombrePaciente,
    fechaElectroStr,
    fechaSubidaStr,
    fileName,
    fileUrl,
    fileId,
    subidoPor,
    '',
    aprobado || ''
  ]);

  return { success: true, message: 'Archivo subido correctamente', fileUrl };
}

// ============================================================
// SUBIR ARCHIVO EN CHUNKS
// ============================================================
function handleUploadChunk(data) {
  const { uploadId, chunkIndex, totalChunks, chunkData, aprobado } = data;
  const cache = CacheService.getScriptCache();
  const cacheKey = 'upload_' + uploadId + '_' + chunkIndex;

  // CacheService tiene límite de 100KB por clave
  // Los chunks de 750KB necesitan dividirse en sub-claves
  const SUB_SIZE = 90000; // ~90KB por sub-clave (seguro bajo el límite)
  const subChunks = Math.ceil(chunkData.length / SUB_SIZE);

  for (let s = 0; s < subChunks; s++) {
    const subKey = cacheKey + '_s' + s;
    const subData = chunkData.slice(s * SUB_SIZE, (s + 1) * SUB_SIZE);
    cache.put(subKey, subData, 600); // TTL: 10 minutos
  }
  // Guardar meta del chunk: cuántas sub-claves tiene
  cache.put(cacheKey + '_meta', String(subChunks), 600);

  // Si NO es el último chunk, retornamos progreso
  if (chunkIndex < totalChunks - 1) {
    return { success: true, progress: chunkIndex + 1 };
  }

  // Último chunk: ensamblar todo
  const { fileName, mimeType, cedulaPaciente, nombrePaciente, fechaElectro, subidoPor } = data;

  // Validar que sea PDF
  if (mimeType && mimeType !== 'application/pdf') {
    return { success: false, message: 'Solo se permiten archivos PDF' };
  }

  let fullBase64 = '';
  for (let i = 0; i < totalChunks; i++) {
    const metaKey = 'upload_' + uploadId + '_' + i + '_meta';
    const subCount = parseInt(cache.get(metaKey) || '1', 10);
    for (let s = 0; s < subCount; s++) {
      const subKey = 'upload_' + uploadId + '_' + i + '_s' + s;
      const part = cache.get(subKey);
      if (!part) {
        return { success: false, message: 'Fragmento ' + i + ' expirado o perdido. Intenta de nuevo.' };
      }
      fullBase64 += part;
      cache.remove(subKey);
    }
    cache.remove(metaKey);
  }

  // Crear archivo en Drive
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const blob = Utilities.newBlob(
    Utilities.base64Decode(fullBase64),
    mimeType || 'application/pdf',
    fileName
  );
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileUrl = file.getUrl();
  const fileId = file.getId();

  // Registrar en Sheets
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Electros');
  const tz = 'America/Bogota';

  // Guardar fechas como strings formateados para evitar problemas de zona horaria
  const now = new Date();
  const fechaSubidaStr = Utilities.formatDate(now, tz, 'dd/MM/yyyy hh:mm:ss a');
  const id = Utilities.getUuid();

  // fechaElectro ya viene como "YYYY-MM-DD" del frontend, la guardamos como string visible
  // Formateamos a DD/MM/YYYY para consistencia visual
  let fechaElectroStr;
  if (fechaElectro && typeof fechaElectro === 'string' && fechaElectro.includes('-')) {
    const parts = fechaElectro.split('-');
    fechaElectroStr = parts[2] + '/' + parts[1] + '/' + parts[0];
  } else {
    fechaElectroStr = fechaElectro;
  }

  sheet.appendRow([
    id,
    cedulaPaciente,
    nombrePaciente,
    fechaElectroStr,
    fechaSubidaStr,
    fileName,
    fileUrl,
    fileId,
    subidoPor,
    '',
    aprobado || ''
  ]);

  return { success: true, complete: true, message: 'Archivo subido correctamente', fileUrl };
}

// ============================================================
// OBTENER REGISTROS
// ============================================================
function handleGetRecords(data) {
  const { rol, username } = data;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Electros');
  const rows = sheet.getDataRange().getValues();

  const tz = 'America/Bogota';
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === '') continue;

    // Las fechas ahora son strings, pero mantenemos compatibilidad con registros antiguos
    let fechaElectro = row[3];
    if (fechaElectro instanceof Date) {
      fechaElectro = Utilities.formatDate(fechaElectro, tz, 'dd/MM/yyyy');
    }
    // Si es string pero viene en formato YYYY-MM-DD (registros antiguos), convertir
    if (typeof fechaElectro === 'string' && fechaElectro.includes('-')) {
      const parts = fechaElectro.split('-');
      fechaElectro = parts[2] + '/' + parts[1] + '/' + parts[0];
    }

    let fechaSubida = row[4];
    if (fechaSubida instanceof Date) {
      fechaSubida = Utilities.formatDate(fechaSubida, tz, 'dd/MM/yyyy HH:mm:ss');
    }

    const record = {
      id: row[0],
      cedulaPaciente: row[1],
      nombrePaciente: row[2],
      fechaElectro: fechaElectro,
      fechaSubida: fechaSubida,
      fileName: row[5],
      fileUrl: row[6],
      fileId: row[7],
      subidoPor: row[8],
      observacion: row[9],
      aprobado: row[10] || '',
      rowIndex: i + 1
    };

    if (rol === 'medico' || rol === 'supervisor' || (rol === 'enfermero' && record.subidoPor === username)) {
      records.push(record);
    }
  }

  return { success: true, records };
}

// ============================================================
// GUARDAR OBSERVACIÓN DEL MÉDICO
// ============================================================
function handleSaveObservation(data) {
  const { rowIndex, observacion } = data;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Electros');
  sheet.getRange(rowIndex, 10).setValue(observacion);
  return { success: true, message: 'Observación guardada' };
}

// ============================================================
// GUARDAR ESTADO DE APROBADO
// ============================================================
function handleSaveAprobado(data) {
  const { rowIndex, aprobado } = data;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Electros');
  sheet.getRange(rowIndex, 11).setValue(aprobado);
  return { success: true, message: 'Estado guardado' };
}

// ============================================================
// ADMINISTRACIÓN DE USUARIOS
// ============================================================

// ── Obtener todos los usuarios (solo admin) ──
function handleGetUsers(data) {
  const { requestedBy } = data;
  // Verificar que quien solicita es admin
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Usuarios');
  const rows = sheet.getDataRange().getValues();

  let isAdmin = false;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === requestedBy && rows[i][3] === 'admin') {
      isAdmin = true;
      break;
    }
  }
  if (!isAdmin) {
    return { success: false, message: 'No tienes permisos para esta acción' };
  }

  const users = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === '') continue;
    users.push({
      username: row[0],
      password: row[1],
      nombre: row[2],
      rol: row[3],
      activo: (row[4] === undefined || row[4] === '' || String(row[4]).toUpperCase() === 'SI') ? 'SI' : 'NO',
      rowIndex: i + 1
    });
  }

  return { success: true, users };
}

// ── Agregar nuevo usuario ──
function handleAddUser(data) {
  const { requestedBy, username, password, nombre, rol } = data;

  // Verificar permisos de admin
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Usuarios');
  const rows = sheet.getDataRange().getValues();

  let isAdmin = false;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === requestedBy && rows[i][3] === 'admin') {
      isAdmin = true;
      break;
    }
  }
  if (!isAdmin) {
    return { success: false, message: 'No tienes permisos para esta acción' };
  }

  // Validaciones
  if (!username || !password || !nombre || !rol) {
    return { success: false, message: 'Todos los campos son obligatorios' };
  }

  if (password.length < 4) {
    return { success: false, message: 'La contraseña debe tener al menos 4 caracteres' };
  }

  if (rol !== 'enfermero' && rol !== 'medico' && rol !== 'admin' && rol !== 'supervisor') {
    return { success: false, message: 'El rol debe ser enfermero, medico, admin o supervisor' };
  }

  // Verificar que no exista el username
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === String(username).toLowerCase()) {
      return { success: false, message: 'Ya existe un usuario con ese nombre de usuario' };
    }
  }

  // Agregar usuario
  sheet.appendRow([username, password, nombre, rol, 'SI']);

  return { success: true, message: 'Usuario creado correctamente' };
}

// ── Actualizar usuario existente ──
function handleUpdateUser(data) {
  const { requestedBy, rowIndex, password, nombre, rol } = data;

  // Verificar permisos de admin
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Usuarios');
  const rows = sheet.getDataRange().getValues();

  let isAdmin = false;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === requestedBy && rows[i][3] === 'admin') {
      isAdmin = true;
      break;
    }
  }
  if (!isAdmin) {
    return { success: false, message: 'No tienes permisos para esta acción' };
  }

  // Validaciones
  if (!nombre || !rol) {
    return { success: false, message: 'Nombre y rol son obligatorios' };
  }

  if (password && password.length < 4) {
    return { success: false, message: 'La contraseña debe tener al menos 4 caracteres' };
  }

  if (rol !== 'enfermero' && rol !== 'medico' && rol !== 'admin' && rol !== 'supervisor') {
    return { success: false, message: 'Rol no válido' };
  }

  // Actualizar nombre y rol
  sheet.getRange(rowIndex, 3).setValue(nombre);
  sheet.getRange(rowIndex, 4).setValue(rol);

  // Actualizar contraseña solo si se proporcionó una nueva
  if (password && password.trim() !== '') {
    sheet.getRange(rowIndex, 2).setValue(password);
  }

  return { success: true, message: 'Usuario actualizado correctamente' };
}

// ── Activar/Desactivar usuario ──
function handleToggleUserStatus(data) {
  const { requestedBy, rowIndex, newStatus } = data;

  // Verificar permisos de admin
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Usuarios');
  const rows = sheet.getDataRange().getValues();

  let isAdmin = false;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === requestedBy && rows[i][3] === 'admin') {
      isAdmin = true;
      break;
    }
  }
  if (!isAdmin) {
    return { success: false, message: 'No tienes permisos para esta acción' };
  }

  // Verificar que no se desactive a sí mismo
  const targetUsername = rows[rowIndex - 1][0];
  if (targetUsername === requestedBy && newStatus === 'NO') {
    return { success: false, message: 'No puedes desactivar tu propia cuenta' };
  }

  // Actualizar estado
  sheet.getRange(rowIndex, 5).setValue(newStatus);

  const statusMsg = newStatus === 'SI' ? 'activado' : 'desactivado';
  return { success: true, message: 'Usuario ' + statusMsg + ' correctamente' };
}

// ============================================================
// INICIALIZACIÓN DE HOJAS Y USUARIOS
// ⚠️ EJECUTAR ESTA FUNCIÓN MANUALMENTE UNA SOLA VEZ
// antes de hacer la primera implementación (Deploy):
// Selecciona "inicializarHojas" en el menú de funciones
// y presiona el botón ▶ Ejecutar.
// ============================================================
function inicializarHojas() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // --- Hoja Usuarios ---
  let usuariosSheet = ss.getSheetByName('Usuarios');
  if (!usuariosSheet) {
    usuariosSheet = ss.insertSheet('Usuarios');
  }
  usuariosSheet.clearContents();
  usuariosSheet.getRange(1, 1, 1, 5).setValues([
    ['usuario', 'password', 'nombre', 'rol', 'activo']
  ]).setFontWeight('bold');
  usuariosSheet.getRange(2, 1, 1, 5).setValues([
    ['admin', 'Previsalud2023++', 'Administrador', 'admin', 'SI']
  ]);

  // --- Hoja Electros ---
  let electrosSheet = ss.getSheetByName('Electros');
  if (!electrosSheet) {
    electrosSheet = ss.insertSheet('Electros');
  }
  electrosSheet.getRange(1, 1, 1, 11).setValues([[
    'id', 'cedulaPaciente', 'nombrePaciente', 'fechaElectro',
    'fechaSubida', 'fileName', 'fileUrl', 'fileId', 'subidoPor', 'observacion', 'aprobado'
  ]]).setFontWeight('bold');

  Logger.log('✅ Hojas inicializadas correctamente');
}

// ============================================================
// ENCUESTAS
// ============================================================

function ensureSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sheet;
}

function handleCreateSurvey(data) {
  var titulo = data.titulo;
  var descripcion = data.descripcion || '';
  var preguntas = data.preguntas;
  var creadaPor = data.creadaPor;

  if (!titulo || !preguntas || !creadaPor) {
    return { success: false, message: 'Campos obligatorios faltantes' };
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ensureSheet(ss, 'Encuestas', ['id','titulo','descripcion','preguntas','creadaPor','fechaCreacion','activa']);

  var tz = 'America/Bogota';
  var id = Utilities.getUuid();
  var fechaCreacion = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy hh:mm:ss a');

  sheet.appendRow([id, titulo, descripcion, JSON.stringify(preguntas), creadaPor, fechaCreacion, 'SI']);

  return { success: true, message: 'Encuesta creada correctamente' };
}

function handleGetSurveys(data) {
  var rol = data.rol;
  var username = data.username;
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Encuestas');

  if (!sheet) return { success: true, surveys: [] };

  var rows = sheet.getDataRange().getValues();
  var respSheet = ss.getSheetByName('Respuestas');
  var respRows = respSheet ? respSheet.getDataRange().getValues() : [];

  var surveys = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (row[0] === '') continue;

    var activa = row[6] === 'SI';

    // Enfermeros solo ven encuestas activas
    if (rol === 'enfermero' && !activa) continue;

    var fechaStr = row[5];
    if (fechaStr instanceof Date) {
      fechaStr = Utilities.formatDate(fechaStr, 'America/Bogota', 'dd/MM/yyyy hh:mm:ss a');
    }

    var totalResp = 0;
    var respuestaHoy = false;
    var tz = 'America/Bogota';
    var hoy = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');
    
    for (var j = 1; j < respRows.length; j++) {
      if (respRows[j][1] === row[0]) {
        totalResp++;
        if (respRows[j][2] === username) {
          var fechaResp = respRows[j][3];
          if (fechaResp instanceof Date) {
            fechaResp = Utilities.formatDate(fechaResp, tz, 'dd/MM/yyyy hh:mm:ss a');
          }
          if (fechaResp && fechaResp.substring(0, 10) === hoy) {
            respuestaHoy = true;
          }
        }
      }
    }

    surveys.push({
      id: row[0],
      titulo: row[1],
      descripcion: row[2],
      preguntas: JSON.parse(row[3] || '[]'),
      creadaPor: row[4],
      fechaCreacion: fechaStr,
      activa: activa,
      totalRespuestas: totalResp,
      respuestaHoy: respuestaHoy,
      rowIndex: i + 1
    });
  }

  return { success: true, surveys: surveys };
}

function handleSubmitSurveyResponse(data) {
  var encuestaId = data.encuestaId;
  var respondidoPor = data.respondidoPor;
  var respuestas = data.respuestas;

  if (!encuestaId || !respondidoPor || !respuestas) {
    return { success: false, message: 'Datos incompletos' };
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ensureSheet(ss, 'Respuestas', ['id','encuestaId','respondidoPor','fechaRespuesta','respuestas']);

  // Verificar si ya respondio hoy
  var tz = 'America/Bogota';
  var hoy = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][1] === encuestaId && rows[i][2] === respondidoPor) {
      var fechaResp = rows[i][3];
      if (fechaResp instanceof Date) {
        fechaResp = Utilities.formatDate(fechaResp, tz, 'dd/MM/yyyy hh:mm:ss a');
      }
      if (fechaResp && fechaResp.substring(0, 10) === hoy) {
        return { success: false, message: 'Ya respondiste esta encuesta hoy' };
      }
    }
  }

  var tz = 'America/Bogota';
  var id = Utilities.getUuid();
  var fecha = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy hh:mm:ss a');

  sheet.appendRow([id, encuestaId, respondidoPor, fecha, JSON.stringify(respuestas)]);

  return { success: true, message: 'Respuesta enviada correctamente' };
}

function handleGetSurveyResponses(data) {
  var encuestaId = data.encuestaId;
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Respuestas');

  if (!sheet) return { success: true, responses: [] };

  var rows = sheet.getDataRange().getValues();
  var responses = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (row[1] !== encuestaId) continue;

    var fechaStr = row[3];
    if (fechaStr instanceof Date) {
      fechaStr = Utilities.formatDate(fechaStr, 'America/Bogota', 'dd/MM/yyyy hh:mm:ss a');
    }

    responses.push({
      id: row[0],
      encuestaId: row[1],
      respondidoPor: row[2],
      fechaRespuesta: fechaStr,
      respuestas: JSON.parse(row[4] || '[]')
    });
  }

  return { success: true, responses: responses };
}

function handleToggleSurvey(data) {
  var rowIndex = data.rowIndex;
  var activa = data.activa;

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Encuestas');
  sheet.getRange(rowIndex, 7).setValue(activa ? 'SI' : 'NO');

  return { success: true, message: activa ? 'Encuesta activada' : 'Encuesta desactivada' };
}

function handleDeleteSurvey(data) {
  var id = data.id;
  var debugLog = [];
  
  debugLog.push('handleDeleteSurvey called with id: ' + id);
  
  if (!id) return { success: false, message: 'ID no proporcionado', debug: debugLog };
  
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Encuestas');

  if (!sheet) {
    debugLog.push('ERROR: Sheet Encuestas not found');
    return { success: false, message: 'Hoja no encontrada', debug: debugLog };
  }

  var rows = sheet.getDataRange().getValues();
  debugLog.push('Total rows in Encuestas: ' + rows.length);
  debugLog.push('Looking for ID: ' + id);
  
  for (var i = 1; i < rows.length; i++) {
    var rowId = String(rows[i][0]);
    debugLog.push('Row ' + i + ': "' + rowId + '" === "' + id + '" = ' + (rowId === id));
    if (rowId === id) {
      debugLog.push('FOUND! Deleting row ' + (i + 1));
      sheet.deleteRow(i + 1);
      return { success: true, message: 'Encuesta eliminada', debug: debugLog };
    }
  }

  debugLog.push('NOT FOUND - ID does not match any row');
  return { success: false, message: 'Encuesta no encontrada', debug: debugLog };
}

function handleUpdateSurvey(data) {
  var id = data.id;
  var titulo = data.titulo;
  var descripcion = data.descripcion || '';
  var preguntas = data.preguntas;

  if (!id || !titulo || !preguntas) {
    return { success: false, message: 'Campos obligatorios faltantes' };
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Encuestas');
  var rows = sheet.getDataRange().getValues();

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      sheet.getRange(i + 1, 2).setValue(titulo);
      sheet.getRange(i + 1, 3).setValue(descripcion);
      sheet.getRange(i + 1, 4).setValue(JSON.stringify(preguntas));
      return { success: true, message: 'Encuesta actualizada' };
    }
  }

  return { success: false, message: 'Encuesta no encontrada' };
}