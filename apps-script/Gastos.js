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

function categoriaValida_(c) {
  return CATEGORIAS.some(x => x.nombre === c);
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

function guardarArchivo_(a, nombreBase) {
  const ext = TIPOS_ARCHIVO[a && a.mime];
  if (!ext) throw new Error('Tipo de archivo no admitido. Usa una foto o un PDF.');
  if (!a.base64 || a.base64.length > 20 * 1024 * 1024) throw new Error('El archivo es demasiado grande (máximo 15 MB).');
  const blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime, nombreBase + '.' + ext);
  return carpetaMes_(hoyISO_()).createFile(blob);
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
function subir_(u, p) {
  const id = nuevoId_();
  const archivo = guardarArchivo_(p.archivo, hoyISO_() + ' ' + id);
  const texto = leerArchivo_(archivo);
  const proveedores = leer_('Proveedores').filter(x => esVerdad_(x.activo));
  const d = analizarFactura_(texto, proveedores);
  // Proveedor nuevo con NIF válido: se da de alta solo. Sin NIF fiable no se crea,
  // para no llenar la lista de nombres mal leídos (el usuario lo crea con un toque).
  let prov = d.proveedor || null;
  let proveedorNuevo = false;
  if (!prov && d.nif && nifValido_(d.nif)) {
    prov = conBloqueo_(() => {
      const existente = leer_('Proveedores').find(x => normNif_(x.nif) === d.nif);
      if (existente) {
        return esVerdad_(existente.activo) ? existente : actualizar_('Proveedores', existente.id, { activo: true });
      }
      proveedorNuevo = true;
      return insertar_('Proveedores', {
        id: nuevoId_(), nombre: d.nombreSugerido || 'Proveedor ' + d.nif, nif: d.nif,
        categoria_habitual: d.categoria || '', activo: true, creado_en: new Date()
      });
    });
    if (!d.categoria && prov.categoria_habitual) d.categoria = prov.categoria_habitual;
  }
  const ahora = new Date();
  const gasto = {
    id,
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
    origen: ['foto', 'galeria', 'pdf'].includes(p.origen) ? p.origen : 'foto',
    nota: '',
    recurrente_id: '',
    creado_por: u.id,
    creado_en: ahora,
    modificado_en: ahora,
    ocr_texto: texto.slice(0, 45000)
  };
  conBloqueo_(() => insertar_('Gastos', gasto));
  return {
    gasto: limpiarGasto_(gasto),
    leido: !!texto,
    proveedor: prov ? limpiarProveedor_(prov) : null,
    proveedorNuevo,
    sugerencia: { nombre: d.nombreSugerido || '', nif: prov ? '' : (d.nif || '') }
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
  const archivo = guardarArchivo_(p.archivo, hoyISO_() + ' ' + g.id);
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
    archivo.moveTo(carpetaMes_(g.fecha));
  } catch (e) {
    console.error(e);
  }
}

// "Repetir foto": borra un gasto que aún está por revisar y manda su archivo a la papelera.
function descartar_(u, p) {
  const g = gastoPermitido_(u, p.id);
  if (g.estado !== 'por_revisar' || g.origen === 'recurrente') throw new Error('Este gasto no se puede descartar.');
  conBloqueo_(() => borrarFila_('Gastos', g.id));
  if (g.archivo_id) {
    try { DriveApp.getFileById(g.archivo_id).setTrashed(true); } catch (e) { console.error(e); }
  }
  return {};
}

// Anular no borra nada: el gasto deja de contar pero sigue en la hoja.
function anular_(u, p) {
  soloDueno_(u);
  conBloqueo_(() => actualizar_('Gastos', p.id, { estado: 'anulado', modificado_en: new Date() }));
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
