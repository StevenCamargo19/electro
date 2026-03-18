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

  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const blob = Utilities.newBlob(Utilities.base64Decode(fileData), mimeType, fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileUrl = file.getUrl();
  const fileId = file.getId();

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Electros');
  const fechaSubida = new Date().toISOString();
  const id = Utilities.getUuid();

  sheet.appendRow([
    id,
    cedulaPaciente,
    nombrePaciente,
    fechaElectro,
    fechaSubida,
    fileName,
    fileUrl,
    fileId,
    subidoPor,
    ''
  ]);

  return { success: true, message: 'Archivo subido correctamente', fileUrl };
}

// ============================================================
// OBTENER REGISTROS
// ============================================================
function handleGetRecords(data) {
  const { rol, username } = data;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Electros');
  const rows = sheet.getDataRange().getValues();

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === '') continue;

    const record = {
      id: row[0],
      cedulaPaciente: row[1],
      nombrePaciente: row[2],
      fechaElectro: row[3],
      fechaSubida: row[4],
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