// ============================================================
// CONFIGURACIÓN
// ============================================================
const SPREADSHEET_ID = '1NeEDvg9VM1lMqwTw8KP8dXJb9XaUtJ8XeAT3jWT48mw';
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
      case 'uploadChunk':
        result = handleUploadChunk(data);
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
  const { fileData, fileName, mimeType, cedulaPaciente, nombrePaciente, fechaElectro, subidoPor } = data;

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
    ''
  ]);

  return { success: true, message: 'Archivo subido correctamente', fileUrl };
}

// ============================================================
// SUBIR ARCHIVO EN CHUNKS
// ============================================================
function handleUploadChunk(data) {
  const { uploadId, chunkIndex, totalChunks, chunkData } = data;
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
    ''
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
      rowIndex: i + 1
    };

    if (rol === 'medico' || (rol === 'enfermero' && record.subidoPor === username)) {
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
  usuariosSheet.getRange(1, 1, 1, 4).setValues([
    ['usuario', 'password', 'nombre', 'rol']
  ]).setFontWeight('bold');
  usuariosSheet.getRange(2, 1, 2, 4).setValues([
    ['enfermero', 'enfermero', 'Enfermero', 'enfermero'],
    ['medico',    'medico',    'Medico',    'medico'   ]
  ]);

  // --- Hoja Electros ---
  let electrosSheet = ss.getSheetByName('Electros');
  if (!electrosSheet) {
    electrosSheet = ss.insertSheet('Electros');
  }
  electrosSheet.getRange(1, 1, 1, 10).setValues([[
    'id', 'cedulaPaciente', 'nombrePaciente', 'fechaElectro',
    'fechaSubida', 'fileName', 'fileUrl', 'fileId', 'subidoPor', 'observacion'
  ]]).setFontWeight('bold');

  Logger.log('✅ Hojas inicializadas correctamente');
}