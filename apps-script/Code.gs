/**
 * Meal Kiosk v2 — бэкенд (Google Apps Script + Sheets)
 *
 * Установка (один раз на заведение):
 *  1. Новая Google Таблица → Расширения → Apps Script
 *  2. Вставьте этот файл целиком, сохраните
 *  3. Выполните setupSheets → разрешите доступ
 *  4. Развернуть → Новое развертывание → Веб-приложение
 *       Запуск от имени: Я | Доступ: Все
 *  5. Скопируйте URL (.../exec) в мастер настройки админки
 *
 * Версия API: 2.0
 */

var SHEET_EMPLOYEES = 'Employees';
var SHEET_MEALS     = 'Meals';
var SHEET_LOGS      = 'Logs';
var SHEET_SETTINGS  = 'Settings';

/** Защита от двойного нажатия (секунды), не «час ожидания». */
var DUP_GUARD_SECONDS = 12;
var PHOTO_FOLDER_NAME = 'MealKioskPhotos';

var EMPLOYEE_HEADERS = [
  'employeeId', 'fullName', 'staffId', 'department', 'position',
  'photo', 'faceDescriptor', 'active', 'createdAt', 'updatedAt'
];

var MEAL_HEADERS = [
  'mealId', 'timestamp', 'date', 'time', 'employeeId', 'employeeName',
  'staffId', 'department', 'mealType', 'price', 'siteName', 'operator',
  'matchScore', 'photo', 'verified', 'note'
];

var LOG_HEADERS = [
  'eventId', 'timestamp', 'type', 'employeeId', 'employeeName',
  'status', 'message', 'photo', 'matchScore'
];

var SETTINGS_HEADERS = ['key', 'value', 'updatedAt'];

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    switch (action) {
      case 'ping':
        return respond({
          ok: true,
          message: 'pong',
          version: '2.0',
          dupGuardSeconds: DUP_GUARD_SECONDS
        });
      case 'listEmployees':
        return respond({ ok: true, items: listEmployees() });
      case 'listMeals':
        return respond({ ok: true, items: listMeals(Number(e.parameter.limit) || 1000) });
      case 'getSettings':
        return respond({ ok: true, settings: getPublicSettings() });
      default:
        return respond({ ok: false, status: 'error', message: 'Неизвестное действие: ' + action });
    }
  } catch (err) {
    return respond({ ok: false, status: 'error', message: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    var body = JSON.parse(e.postData.contents);
    switch (action) {
      case 'saveEmployee': return respond(saveEmployee(body));
      case 'saveMeal':     return respond(saveMeal(body));
      case 'logEvent':     return respond(logEvent(body));
      case 'saveSettings': return respond(saveSettings(body));
      case 'verifyPin':    return respond(verifyPin(body));
      case 'setPin':       return respond(setPin(body));
      default:
        return respond({ ok: false, status: 'error', message: 'Неизвестное действие: ' + action });
    }
  } catch (err) {
    return respond({ ok: false, status: 'error', message: String(err.message || err) });
  }
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function getOrCreateSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  if (name === SHEET_MEALS) {
    ensureHeaders_(sheet, headers);
    ensureTextColumns_(sheet, headers, ['date', 'time', 'price', 'note']);
  }
  if (name === SHEET_SETTINGS || name === SHEET_EMPLOYEES || name === SHEET_LOGS) {
    ensureHeaders_(sheet, headers);
  }
  return sheet;
}

function ensureHeaders_(sheet, headers) {
  var data = sheet.getDataRange().getValues();
  if (!data.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return;
  }
  var current = data[0].map(String);
  if (current[0] === headers[0] && current.length === headers.length) return;
  // Дописываем недостающие колонки справа
  for (var i = 0; i < headers.length; i++) {
    if (current.indexOf(headers[i]) < 0) {
      var col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(headers[i]).setFontWeight('bold');
      current.push(headers[i]);
    }
  }
}

function ensureTextColumns_(sheet, headers, colNames) {
  var maxRows = Math.max(sheet.getMaxRows(), 2);
  colNames.forEach(function (colName) {
    var idx = headers.indexOf(colName);
    if (idx < 0) return;
    sheet.getRange(2, idx + 1, maxRows - 1, 1).setNumberFormat('@');
  });
}

function sheetToObjects_(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(String);
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row.some(function (cell) { return cell !== '' && cell !== null; })) continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = normalizeCell_(row[j]);
    rows.push(obj);
  }
  return rows;
}

function normalizeCell_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return v;
}

function findRowById_(sheet, idCol, id) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  var headers = data[0].map(String);
  var col = headers.indexOf(idCol);
  if (col < 0) return 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][col]) === String(id)) return i + 1;
  }
  return 0;
}

function objectToRow_(headers, obj) {
  return headers.map(function (h) {
    return obj[h] !== undefined && obj[h] !== null ? obj[h] : '';
  });
}

function nowIso_() { return new Date().toISOString(); }

function sha256_(text) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return raw.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/* ─── Employees ─── */

function listEmployees() {
  var sheet = getOrCreateSheet_(SHEET_EMPLOYEES, EMPLOYEE_HEADERS);
  return sheetToObjects_(sheet).filter(function (e) {
    return e.active !== false && e.active !== 'false' && String(e.active).toLowerCase() !== 'нет';
  }).map(function (e) {
    e.photo = normalizePhotoUrl_(e.photo);
    return e;
  });
}

function saveEmployee(body) {
  if (!body || !body.fullName) {
    return { ok: false, status: 'error', message: 'Укажите ФИО сотрудника' };
  }

  var sheet = getOrCreateSheet_(SHEET_EMPLOYEES, EMPLOYEE_HEADERS);
  var id = body.employeeId || Utilities.getUuid();
  var now = nowIso_();
  var rowNum = findRowById_(sheet, 'employeeId', id);
  var existing = rowNum
    ? sheetToObjects_(sheet).find(function (e) { return String(e.employeeId) === String(id); })
    : null;

  var record = {
    employeeId: id,
    fullName: String(body.fullName).trim().slice(0, 120),
    staffId: String(body.staffId || '').slice(0, 40),
    department: String(body.department || '').slice(0, 80),
    position: String(body.position || '').slice(0, 80),
    photo: preparePhoto_(body.photo || (existing && existing.photo) || '', 'emp_' + id + '.jpg'),
    faceDescriptor: body.faceDescriptor || (existing && existing.faceDescriptor) || '',
    active: body.active !== false,
    createdAt: (existing && existing.createdAt) || now,
    updatedAt: now
  };

  var row = objectToRow_(EMPLOYEE_HEADERS, record);
  if (rowNum) sheet.getRange(rowNum, 1, 1, EMPLOYEE_HEADERS.length).setValues([row]);
  else sheet.appendRow(row);

  logEvent_({
    type: rowNum ? 'employee_update' : 'employee_create',
    employeeId: id,
    employeeName: record.fullName,
    status: 'ok',
    message: rowNum ? 'Сотрудник обновлён' : 'Сотрудник создан'
  });

  return { ok: true, employeeId: id, employee: record };
}

/* ─── Meals ─── */

function listMeals(limit) {
  var sheet = getOrCreateSheet_(SHEET_MEALS, MEAL_HEADERS);
  var items = sheetToObjects_(sheet).map(function (m) {
    if (m.photo) m.photo = normalizePhotoUrl_(m.photo);
    return m;
  });
  items.sort(function (a, b) {
    return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
  });
  return items.slice(0, limit || 1000);
}

/**
 * Фиксация питания в любое время.
 * mealType: Завтрак | Обед | Ужин | Специальное
 * Для «Специальное» обязательны note (что приготовили) и price.
 */
function saveMeal(body) {
  if (!body || !body.employeeId || !body.mealType) {
    return { ok: false, status: 'error', message: 'Неполные данные' };
  }

  var mealType = String(body.mealType).trim();
  var allowed = { 'Завтрак': 1, 'Обед': 1, 'Ужин': 1, 'Специальное': 1 };
  if (!allowed[mealType]) {
    return { ok: false, status: 'error', message: 'Неизвестный тип питания' };
  }

  var note = String(body.note || '').trim();
  var price = body.price;
  if (price === '' || price === null || price === undefined) price = '';
  else {
    price = Number(price);
    if (isNaN(price) || price < 0) {
      return { ok: false, status: 'error', message: 'Некорректная цена' };
    }
  }

  if (mealType === 'Специальное') {
    if (!note) return { ok: false, status: 'error', message: 'Укажите, что приготовили' };
    if (price === '') return { ok: false, status: 'error', message: 'Укажите цену специального блюда' };
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) {
    return { ok: false, status: 'error', message: 'Сервер занят, повторите' };
  }

  try {
    var sheet = getOrCreateSheet_(SHEET_MEALS, MEAL_HEADERS);
    var meals = sheetToObjects_(sheet);
    var now = new Date();
    var nowMs = now.getTime();
    var guardMs = DUP_GUARD_SECONDS * 1000;

    // Анти-двойной тап
    for (var i = 0; i < meals.length; i++) {
      if (String(meals[i].employeeId) !== String(body.employeeId)) continue;
      var t = Date.parse(meals[i].timestamp);
      if (!isNaN(t) && (nowMs - t) < guardMs) {
        return {
          ok: false,
          status: 'duplicate',
          message: 'Уже зафиксировано только что. Подождите секунду.'
        };
      }
    }

    // Цена стандартного типа — из настроек, если клиент не передал
    if (price === '' && mealType !== 'Специальное') {
      var s = getSettingsRaw_();
      var map = { 'Завтрак': s.priceBr, 'Обед': s.priceLu, 'Ужин': s.priceDi };
      if (map[mealType] !== undefined && map[mealType] !== '') {
        var p = Number(map[mealType]);
        if (!isNaN(p)) price = p;
      }
    }

    var record = {
      mealId: body.mealId || Utilities.getUuid(),
      timestamp: nowIso_(),
      date: Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      time: Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm:ss'),
      employeeId: body.employeeId,
      employeeName: body.employeeName || '',
      staffId: body.staffId || '',
      department: body.department || '',
      mealType: mealType,
      price: price === '' ? '' : String(price),
      siteName: body.siteName || '',
      operator: body.operator || '',
      matchScore: body.matchScore !== undefined ? body.matchScore : '',
      photo: preparePhoto_(body.photo || '', 'meal_' + Utilities.getUuid() + '.jpg'),
      verified: body.verified !== false,
      note: note
    };

    sheet.appendRow(objectToRow_(MEAL_HEADERS, record));

    logEvent_({
      type: 'meal',
      employeeId: record.employeeId,
      employeeName: record.employeeName,
      status: 'ok',
      message: mealType + (note ? (': ' + note) : ''),
      photo: record.photo,
      matchScore: record.matchScore
    });

    return { ok: true, mealId: record.mealId, meal: record };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* ─── Settings / PIN ─── */

function getSettingsRaw_() {
  var sheet = getOrCreateSheet_(SHEET_SETTINGS, SETTINGS_HEADERS);
  var out = {};
  sheetToObjects_(sheet).forEach(function (r) { out[r.key] = r.value; });
  return out;
}

function getPublicSettings() {
  var s = getSettingsRaw_();
  return {
    siteName: s.siteName || '',
    operator: s.operator || '',
    timezone: s.timezone || 'Asia/Almaty',
    priceBr: s.priceBr || '',
    priceLu: s.priceLu || '',
    priceDi: s.priceDi || '',
    setupDone: s.setupDone === 'true' || s.setupDone === true,
    hasPin: !!(s.pinHash && String(s.pinHash).length > 10)
  };
}

function upsertSetting_(key, value) {
  var sheet = getOrCreateSheet_(SHEET_SETTINGS, SETTINGS_HEADERS);
  var now = nowIso_();
  var rowNum = findRowById_(sheet, 'key', key);
  var row = objectToRow_(SETTINGS_HEADERS, { key: key, value: value, updatedAt: now });
  if (rowNum) sheet.getRange(rowNum, 1, 1, SETTINGS_HEADERS.length).setValues([row]);
  else sheet.appendRow(row);
}

function saveSettings(body) {
  if (!body) return { ok: false, status: 'error', message: 'Нет данных' };

  // Смена настроек — только с верным PIN (кроме первого онбординга)
  var raw = getSettingsRaw_();
  var pinConfigured = !!(raw.pinHash && String(raw.pinHash).length > 10);
  if (pinConfigured) {
    if (!body.pin || sha256_(String(body.pin)) !== String(raw.pinHash)) {
      return { ok: false, status: 'auth', message: 'Неверный PIN' };
    }
  }

  var keys = ['siteName', 'operator', 'timezone', 'priceBr', 'priceLu', 'priceDi', 'setupDone'];
  keys.forEach(function (k) {
    if (body[k] !== undefined) upsertSetting_(k, String(body[k]));
  });

  return { ok: true, settings: getPublicSettings() };
}

function setPin(body) {
  if (!body || !body.newPin) {
    return { ok: false, status: 'error', message: 'Укажите новый PIN' };
  }
  var pin = String(body.newPin).replace(/\D/g, '');
  if (pin.length < 4 || pin.length > 8) {
    return { ok: false, status: 'error', message: 'PIN: 4–8 цифр' };
  }

  var raw = getSettingsRaw_();
  var pinConfigured = !!(raw.pinHash && String(raw.pinHash).length > 10);
  if (pinConfigured) {
    if (!body.currentPin || sha256_(String(body.currentPin)) !== String(raw.pinHash)) {
      return { ok: false, status: 'auth', message: 'Неверный текущий PIN' };
    }
  }

  upsertSetting_('pinHash', sha256_(pin));
  upsertSetting_('setupDone', 'true');
  return { ok: true, message: 'PIN сохранён' };
}

function verifyPin(body) {
  var raw = getSettingsRaw_();
  if (!raw.pinHash) {
    return { ok: false, status: 'error', message: 'PIN ещё не задан — пройдите настройку' };
  }
  var ok = body && body.pin && sha256_(String(body.pin)) === String(raw.pinHash);
  return ok
    ? { ok: true, status: 'ok' }
    : { ok: false, status: 'auth', message: 'Неверный PIN' };
}

/* ─── Logs / Photos ─── */

function logEvent(body) { logEvent_(body || {}); return { ok: true }; }

function logEvent_(body) {
  try {
    var sheet = getOrCreateSheet_(SHEET_LOGS, LOG_HEADERS);
    sheet.appendRow(objectToRow_(LOG_HEADERS, {
      eventId: Utilities.getUuid(),
      timestamp: nowIso_(),
      type: body.type || 'info',
      employeeId: body.employeeId || '',
      employeeName: body.employeeName || '',
      status: body.status || '',
      message: body.message || '',
      photo: truncatePhoto_(body.photo || ''),
      matchScore: body.matchScore !== undefined ? body.matchScore : ''
    }));
  } catch (e) {}
}

function extractDriveFileId_(url) {
  if (!url) return '';
  var s = String(url).trim();
  var match = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  match = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : '';
}

function driveImageUrl_(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';
}

function normalizePhotoUrl_(photo) {
  if (!photo) return '';
  var s = String(photo).trim();
  if (!s) return '';
  if (s.indexOf('data:image') === 0) return s;
  var fileId = extractDriveFileId_(s);
  if (fileId) return driveImageUrl_(fileId);
  if (s.indexOf('http') === 0) return s;
  return s;
}

function getPhotoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('photoFolderId');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  var folders = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('photoFolderId', folder.getId());
  return folder;
}

function savePhotoToDrive_(base64Data, fileName) {
  var parts = String(base64Data).split(',');
  if (parts.length < 2) throw new Error('Invalid image data');
  var mimeMatch = parts[0].match(/data:(.*?);/);
  var mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  var bytes = Utilities.base64Decode(parts[1]);
  var blob = Utilities.newBlob(bytes, mime, fileName || ('photo_' + Date.now() + '.jpg'));
  var file = getPhotoFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return driveImageUrl_(file.getId());
}

function preparePhoto_(photo, fileName) {
  if (!photo) return '';
  var s = String(photo).trim();
  if (!s) return '';
  if (s.indexOf('data:image') === 0) {
    try { return savePhotoToDrive_(s, fileName); }
    catch (e) { return truncatePhoto_(s); }
  }
  return normalizePhotoUrl_(s);
}

function truncatePhoto_(photo) {
  if (!photo) return '';
  var s = String(photo).trim();
  if (s.indexOf('http') === 0 || s.indexOf('drive.google') >= 0) return normalizePhotoUrl_(s);
  if (s.indexOf('data:image') === 0) return s.length <= 45000 ? s : s.slice(0, 45000);
  return s.length <= 45000 ? s : s.slice(0, 45000);
}

/** Один раз из редактора Apps Script. */
function setupSheets() {
  getOrCreateSheet_(SHEET_EMPLOYEES, EMPLOYEE_HEADERS);
  getOrCreateSheet_(SHEET_MEALS, MEAL_HEADERS);
  getOrCreateSheet_(SHEET_LOGS, LOG_HEADERS);
  getOrCreateSheet_(SHEET_SETTINGS, SETTINGS_HEADERS);
  // Часовой пояс скрипта — в настройках проекта Apps Script
  Logger.log('mc-v2: листы Employees, Meals, Logs, Settings готовы.');
}
