// Lectura y escritura en las hojas de cálculo.

function libro_() {
  return SpreadsheetApp.openById(prop_('HOJA_ID'));
}

function hoja_(nombre) {
  return libro_().getSheetByName(nombre) || crearHoja_(nombre);
}

// Crea una pestaña nueva (de las añadidas después de "configurar") con su cabecera y formatos.
function crearHoja_(nombre) {
  const columnas = HOJAS[nombre];
  if (!columnas) return null;
  const hoja = libro_().insertSheet(nombre);
  hoja.getRange(1, 1, 1, columnas.length).setValues([columnas]).setFontWeight('bold').setBackground('#FBF7F2');
  hoja.setFrozenRows(1);
  columnas.forEach((col, i) => {
    const rango = hoja.getRange(2, i + 1, hoja.getMaxRows() - 1, 1);
    if (COLUMNAS_TEXTO.includes(col)) rango.setNumberFormat('@');
    else if (COLUMNAS_EUROS.includes(col)) rango.setNumberFormat('#,##0.00 €');
    else if (col === 'fecha') rango.setNumberFormat('dd/mm/yyyy');
    else if (col === 'creado_en' || col === 'modificado_en') rango.setNumberFormat('dd/mm/yyyy hh:mm');
  });
  return hoja;
}

function leer_(nombre) {
  const valores = hoja_(nombre).getDataRange().getValues();
  const cabecera = valores.shift() || [];
  const filas = [];
  valores.forEach((fila, i) => {
    if (fila[0] === '' || fila[0] === null) return;
    const o = { _fila: i + 2 };
    cabecera.forEach((col, j) => { o[col] = normalizar_(fila[j]); });
    filas.push(o);
  });
  return filas;
}

function normalizar_(v) {
  if (v instanceof Date) {
    const conHora = v.getHours() || v.getMinutes();
    return Utilities.formatDate(v, ZONA, conHora ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd');
  }
  return v;
}

function celda_(col, v) {
  if (v === undefined || v === null) return '';
  if (col === 'fecha' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [a, m, d] = v.split('-').map(Number);
    return new Date(a, m - 1, d);
  }
  if (COLUMNAS_TEXTO.includes(col)) return String(v);
  return v;
}

function fila_(nombre, obj) {
  return HOJAS[nombre].map(col => celda_(col, obj[col]));
}

function insertar_(nombre, obj) {
  hoja_(nombre).appendRow(fila_(nombre, obj));
  return obj;
}

function buscar_(nombre, id) {
  return leer_(nombre).find(f => String(f.id) === String(id)) || null;
}

function actualizar_(nombre, id, cambios) {
  const actual = buscar_(nombre, id);
  if (!actual) throw new Error('No se ha encontrado el registro.');
  const nuevo = Object.assign({}, actual, cambios);
  hoja_(nombre).getRange(actual._fila, 1, 1, HOJAS[nombre].length).setValues([fila_(nombre, nuevo)]);
  return nuevo;
}

function borrarFila_(nombre, id) {
  const actual = buscar_(nombre, id);
  if (actual) hoja_(nombre).deleteRow(actual._fila);
}

function conBloqueo_(fn) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(20000);
  try {
    return fn();
  } finally {
    bloqueo.releaseLock();
  }
}

function nuevoId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function hoyISO_() {
  return Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
}

function r2_(n) {
  return Math.round(Number(n) * 100) / 100;
}

function numero_(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return isNaN(n) ? '' : r2_(n);
}

function esVerdad_(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1' || v === 'sí';
}
