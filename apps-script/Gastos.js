// Gastos, proveedores y archivos de Drive.

const TIPOS_ARCHIVO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const CAMPOS_EDITABLES = ['fecha', 'proveedor_id', 'categoria', 'num_factura', 'base', 'iva_pct',
  'iva_importe', 'retencion', 'total', 'nota'];

function limpiarGasto_(g) {
  const r = {};
  HOJAS.Gastos.forEach(c => { if (c !== 'ocr_texto') r[c] = normalizar_(g[c]); });
  return r;
}

function limpiarProveedor_(p) {
  return { id: p.id, nombre: p.nombre, nif: p.nif, categoria_habitual: p.categoria_habitual, activo: esVerdad_(p.activo) };
}

// Lista de categorías de la hoja "Categorias". Si la hoja no existe, la crea con las iniciales.
function categorias_() {
  const libro = libro_();
  let hoja = libro.getSheetByName('Categorias');
  if (!hoja) {
    hoja = libro.insertSheet('Categorias');
    hoja.getRange(1, 1, 1, HOJAS.Categorias.length).setValues([HOJAS.Categorias]).setFontWeight('bold').setBackground('#FBF7F2');
    hoja.setFrozenRows(1);
  }
  if (hoja.getLastRow() < 2) {
    const ahora = new Date();
    hoja.getRange(2, 1, CATEGORIAS.length, 4).setValues(CATEGORIAS.map(c => [c.nombre, c.grupo, true, ahora]));
  }
  return leer_('Categorias')
    .filter(c => esVerdad_(c.activo))
    .map(c => ({ nombre: String(c.nombre), grupo: GRUPOS.includes(c.grupo) ? c.grupo : 'varios' }));
}

function categoriaValida_(c) {
  return categorias_().some(x => x.nombre === c);
}

function guardarCategoria_(u, p) {
  let nombre = String(p.nombre || '').trim().replace(/\s+/g, ' ');
  if (!nombre) throw new Error('Escribe el nombre de la categoría.');
  if (nombre.length > 30) throw new Error('El nombre es demasiado largo (máximo 30 letras).');
  nombre = nombre[0].toUpperCase() + nombre.slice(1);
  const grupo = GRUPOS.includes(p.grupo) ? p.grupo : 'varios';
  return conBloqueo_(() => {
    const existente = categorias_().find(c => normTexto_(c.nombre) === normTexto_(nombre));
    if (existente) return { categoria: existente, yaExistia: true };
    insertar_('Categorias', { nombre, grupo, activo: true, creado_en: new Date() });
    return { categoria: { nombre, grupo } };
  });
}

// Carpeta Facturas/AAAA/AAAA-MM
function carpetaMes_(fechaIso) {
  const raiz = DriveApp.getFolderById(prop_('FACTURAS_ID'));
  const anio = fechaIso.slice(0, 4), mes = fechaIso.slice(0, 7);
  const sub = (padre, nombre) => {
    const it = padre.getFoldersByName(nombre);
    return it.hasNext() ? it.next() : padre.createFolder(nombre);
  };
  return sub(sub(raiz, anio), mes);
}

function guardarArchivo_(a, nombreBase, fechaIso) {
  const ext = TIPOS_ARCHIVO[a && a.mime];
  if (!ext) throw new Error('Tipo de archivo no admitido. Usa una foto o un PDF.');
  if (!a.base64 || a.base64.length > 20 * 1024 * 1024) throw new Error('El archivo es demasiado grande (máximo 15 MB).');
  const blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime, nombreBase + '.' + ext);
  return carpetaMes_(fechaIso || hoyISO_()).createFile(blob);
}

// Carpeta Facturas/AAAA/AAAA-MM/Proveedor (sin proveedor, la del mes).
function carpetaFactura_(fechaIso, proveedorNombre) {
  const mes = carpetaMes_(fechaIso);
  const nombre = String(proveedorNombre || '').replace(/[\\\/:*?"<>|]+/g, '-').trim().slice(0, 60);
  if (!nombre) return mes;
  const it = mes.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : mes.createFolder(nombre);
}

// Cada archivo vive en la carpeta de su mes y su proveedor (así se puede compartir el mes con la gestoría).
function moverArchivo_(archivoId, fechaIso, proveedorNombre) {
  try {
    DriveApp.getFileById(archivoId).moveTo(carpetaFactura_(fechaIso, proveedorNombre));
  } catch (e) {
    console.error(e);
  }
}

// Sin separadores ni ceros de relleno: "A-V2026-00004637175" = "A-V2026-4637175".
const normNumFactura_ = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, '');

// Busca un gasto que sea la misma factura: mismo nº y (mismo proveedor, NIF o total),
// o mismo proveedor, fecha y total.
function buscarDuplicado_(g, gastos) {
  const num = normNumFactura_(g.num_factura);
  const total = Number(g.total) || 0;
  const mismoProv = x => (g.proveedor_id && String(x.proveedor_id) === String(g.proveedor_id)) ||
    (g.nif && normNif_(x.nif) === normNif_(g.nif));
  return gastos.find(x => x.id !== g.id && x.estado !== 'anulado' && (
    (num && normNumFactura_(x.num_factura) === num && (mismoProv(x) || (total && Number(x.total) === total))) ||
    (total && mismoProv(x) && x.fecha === g.fecha && Number(x.total) === total)
  )) || null;
}

// Lee un archivo ya guardado en Drive y prepara el gasto "por revisar" (sin guardarlo).
// Si el proveedor es nuevo y tiene un NIF válido, lo da de alta.
// "pistas" (opcional) trae lo que ya se sabe por otro lado: {nombre, categoria, abono}.
function prepararGasto_(archivo, creadoPor, origen, nota, pistas) {
  pistas = pistas || {};
  const texto = leerArchivo_(archivo);
  const proveedores = leer_('Proveedores').filter(x => esVerdad_(x.activo));
  const d = analizarFactura_(texto, proveedores);
  // La categoría indicada manda sobre la adivinada por palabras (no sobre la de un proveedor ya conocido).
  if (pistas.categoria && (!d.proveedor || !d.categoria)) d.categoria = pistas.categoria;
  // En los PDF que llegan por correo, el nombre del archivo suele llevar el nº de factura y es más fiable que la lectura.
  const numArchivo = pistas.archivo ? numDesdeNombre_(pistas.archivo) : '';
  if (numArchivo && (numArchivo.length >= 6 || !d.num_factura)) d.num_factura = numArchivo;
  // Sin NIF fiable (ni nombre conocido) no se crea, para no llenar la lista de nombres mal leídos.
  let prov = d.proveedor || null;
  let proveedorNuevo = false;
  const nifOk = d.nif && nifValido_(d.nif);
  if (!prov && (nifOk || pistas.nombre)) {
    prov = conBloqueo_(() => {
      const todos = leer_('Proveedores');
      const existente = (nifOk && todos.find(x => normNif_(x.nif) === d.nif)) ||
        (pistas.nombre && todos.find(x => normTexto_(x.nombre) === normTexto_(pistas.nombre)));
      if (existente) {
        return esVerdad_(existente.activo) ? existente : actualizar_('Proveedores', existente.id, { activo: true });
      }
      proveedorNuevo = true;
      return insertar_('Proveedores', {
        id: nuevoId_(), nombre: pistas.nombre || d.nombreSugerido || 'Proveedor ' + d.nif, nif: nifOk ? d.nif : '',
        categoria_habitual: d.categoria || '', activo: true, creado_en: new Date()
      });
    });
  }
  if (prov && prov.categoria_habitual && (!d.proveedor || !d.categoria)) d.categoria = prov.categoria_habitual;
  if (pistas.abono) {
    ['base', 'iva_importe', 'retencion', 'total'].forEach(k => { if (d[k]) d[k] = -Math.abs(d[k]); });
    Object.values(d.desglose || {}).forEach(x => { x.base = -Math.abs(x.base); x.iva = -Math.abs(x.iva); });
  }
  const ahora = new Date();
  const gasto = {
    id: nuevoId_(),
    fecha: d.fecha || hoyISO_(),
    proveedor_id: prov ? prov.id : '',
    proveedor_nombre: prov ? prov.nombre : '',
    nif: prov ? prov.nif : (d.nif || ''),
    categoria: d.categoria || '',
    num_factura: d.num_factura || '',
    base: numero_(d.base),
    iva_pct: d.iva_pct === undefined ? '' : d.iva_pct,
    iva_importe: numero_(d.iva_importe),
    retencion: numero_(d.retencion) || 0,
    total: numero_(d.total),
    estado: 'por_revisar',
    archivo_url: archivo.getUrl(),
    archivo_id: archivo.getId(),
    origen,
    nota: nota || '',
    recurrente_id: '',
    creado_por: creadoPor,
    creado_en: ahora,
    modificado_en: ahora,
    ocr_texto: texto.slice(0, 45000)
  };
  // Base e IVA de cada tipo, tal como vienen en la factura.
  TIPOS_DESGLOSE.forEach(t => {
    const x = d.desglose && d.desglose[t];
    gasto['base_' + t] = x ? x.base : '';
    gasto['iva_' + t] = x ? x.iva : '';
  });
  return { gasto, texto, d, prov, proveedorNuevo, duplicado: buscarDuplicado_(gasto, leer_('Gastos')) };
}

function leerArchivo_(archivo) {
  try {
    return ocr_(archivo);
  } catch (e) {
    console.error('OCR: ' + (e && e.stack || e));
    return '';
  }
}

// Sube una factura: la guarda en Drive, la lee y crea el gasto "por revisar" con lo que encuentre.
// Si ya existe la misma factura, se avisa para que el usuario la descarte.
function subir_(u, p) {
  const archivo = guardarArchivo_(p.archivo, hoyISO_() + ' ' + nuevoId_());
  const origen = ['foto', 'galeria', 'pdf'].includes(p.origen) ? p.origen : 'foto';
  const r = prepararGasto_(archivo, u.id, origen, '');
  const g = r.gasto;
  moverArchivo_(g.archivo_id, g.fecha, g.proveedor_nombre);
  conBloqueo_(() => insertar_('Gastos', g));
  const dup = r.duplicado;
  return {
    gasto: limpiarGasto_(g),
    leido: !!r.texto,
    proveedor: r.prov ? limpiarProveedor_(r.prov) : null,
    proveedorNuevo: r.proveedorNuevo,
    duplicado: dup ? { id: dup.id, fecha: normalizar_(dup.fecha), total: dup.total, origen: dup.origen, num_factura: dup.num_factura } : null,
    sugerencia: { nombre: r.d.nombreSugerido || '', nif: r.prov ? '' : (r.d.nif || '') }
  };
}

function gastoPermitido_(u, id) {
  const g = buscar_('Gastos', id);
  if (!g || g.estado === 'anulado') throw new Error('Ese gasto ya no existe.');
  if (u.rol !== 'dueno' && String(g.creado_por) !== String(u.id)) throw new Error('No puedes cambiar este gasto.');
  return g;
}

// Adjunta un archivo a un gasto que no lo tenía (por ejemplo, el recibo del alquiler).
function adjuntar_(u, p) {
  const g = gastoPermitido_(u, p.id);
  const archivo = guardarArchivo_(p.archivo, hoyISO_() + ' ' + g.id, g.fecha);
  const texto = leerArchivo_(archivo);
  const d = analizarFactura_(texto, []);
  const cambios = { archivo_url: archivo.getUrl(), archivo_id: archivo.getId(), modificado_en: new Date(), ocr_texto: texto.slice(0, 45000) };
  if (!g.num_factura && d.num_factura) cambios.num_factura = d.num_factura;
  if (g.archivo_id) {
    try { DriveApp.getFileById(g.archivo_id).setTrashed(true); } catch (e) { console.error(e); }
  }
  const r = conBloqueo_(() => actualizar_('Gastos', g.id, cambios));
  return { gasto: limpiarGasto_(r) };
}

function guardarGasto_(u, p) {
  const d = p.gasto || {};
  const cambios = {};
  CAMPOS_EDITABLES.forEach(c => { if (d[c] !== undefined) cambios[c] = d[c]; });
  ['base', 'iva_importe', 'retencion', 'total'].forEach(c => { if (c in cambios) cambios[c] = numero_(cambios[c]); });
  if ('iva_pct' in cambios && cambios.iva_pct !== '') cambios.iva_pct = Number(cambios.iva_pct);
  cambios.estado = d.estado === 'por_revisar' ? 'por_revisar' : 'confirmado';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cambios.fecha || '')) throw new Error('Falta la fecha.');
  if (!categoriaValida_(cambios.categoria)) throw new Error('Elige una categoría.');
  if (cambios.total === '' || cambios.total === undefined) throw new Error('Falta el total.');

  const prov = cambios.proveedor_id ? buscar_('Proveedores', cambios.proveedor_id) : null;
  cambios.proveedor_nombre = prov ? prov.nombre : '';
  cambios.nif = prov ? prov.nif : '';
  cambios.modificado_en = new Date();

  return conBloqueo_(() => {
    let g;
    if (d.id) {
      gastoPermitido_(u, d.id);
      g = actualizar_('Gastos', d.id, cambios);
    } else {
      g = insertar_('Gastos', Object.assign({
        id: nuevoId_(), origen: 'manual', archivo_url: '', archivo_id: '', recurrente_id: '',
        creado_por: u.id, creado_en: new Date(), ocr_texto: ''
      }, cambios));
    }
    if (g.estado === 'confirmado' && g.archivo_id) ordenarArchivo_(g);
    // La primera factura confirmada de un proveedor fija su categoría habitual.
    let provActualizado = null;
    if (g.estado === 'confirmado' && prov && prov.categoria_habitual !== g.categoria) {
      const tieneOtras = leer_('Gastos').some(x => x.id !== g.id && String(x.proveedor_id) === String(prov.id) && x.estado === 'confirmado');
      if (!tieneOtras) provActualizado = actualizar_('Proveedores', prov.id, { categoria_habitual: g.categoria });
    }
    return { gasto: limpiarGasto_(g), proveedor: provActualizado ? limpiarProveedor_(provActualizado) : null };
  });
}

// Pone al archivo un nombre claro y lo mueve a la carpeta del mes de la factura.
function ordenarArchivo_(g) {
  try {
    const archivo = DriveApp.getFileById(g.archivo_id);
    const ext = (archivo.getName().match(/\.\w+$/) || [''])[0];
    const nombre = [g.fecha, g.proveedor_nombre || g.categoria, g.num_factura].filter(Boolean).join(' ')
      .replace(/[\\\/:*?"<>|]+/g, '-').slice(0, 120);
    archivo.setName(nombre + ext);
    archivo.moveTo(carpetaFactura_(g.fecha, g.proveedor_nombre));
  } catch (e) {
    console.error(e);
  }
}

// "Repetir foto": borra un gasto que aún está por revisar y manda su archivo a la papelera.
function descartar_(u, p) {
  const g = gastoPermitido_(u, p.id);
  if (g.estado !== 'por_revisar' || !['foto', 'galeria', 'pdf', 'correo'].includes(g.origen)) throw new Error('Este gasto no se puede descartar.');
  conBloqueo_(() => borrarFila_('Gastos', g.id));
  if (g.archivo_id) {
    try { DriveApp.getFileById(g.archivo_id).setTrashed(true); } catch (e) { console.error(e); }
  }
  return {};
}

// Anular no borra nada: el gasto deja de contar pero sigue en la hoja.
// Su archivo pasa a la carpeta "Anuladas" para que no se comparta con la gestoría.
function anular_(u, p) {
  soloDueno_(u);
  const g = conBloqueo_(() => actualizar_('Gastos', p.id, { estado: 'anulado', modificado_en: new Date() }));
  if (g.archivo_id) {
    try {
      const raiz = DriveApp.getFolderById(prop_('CARPETA_ID'));
      const it = raiz.getFoldersByName('Anuladas');
      DriveApp.getFileById(g.archivo_id).moveTo(it.hasNext() ? it.next() : raiz.createFolder('Anuladas'));
    } catch (e) {
      console.error(e);
    }
  }
  return {};
}

function guardarProveedor_(u, p) {
  const d = p.proveedor || {};
  const nombre = String(d.nombre || '').trim();
  if (!nombre) throw new Error('Falta el nombre del proveedor.');
  const nif = normNif_(d.nif);
  if (d.categoria_habitual && !categoriaValida_(d.categoria_habitual)) throw new Error('Categoría no válida.');
  return conBloqueo_(() => {
    const todos = leer_('Proveedores');
    if (nif && todos.some(x => normNif_(x.nif) === nif && String(x.id) !== String(d.id || ''))) {
      throw new Error('Ya hay un proveedor con ese NIF.');
    }
    const cambios = { nombre, nif, categoria_habitual: d.categoria_habitual || '', activo: d.activo !== false };
    let r;
    if (d.id) {
      // Los empleados pueden corregir nombre, NIF y categoría, pero no dar de baja.
      if (u.rol !== 'dueno') delete cambios.activo;
      r = actualizar_('Proveedores', d.id, cambios);
    } else {
      r = insertar_('Proveedores', Object.assign({ id: nuevoId_(), creado_en: new Date() }, cambios));
    }
    return { proveedor: limpiarProveedor_(r) };
  });
}
