// Cierres Z de la caja registradora: el ticket Z de cada día con las ventas y su IVA (archivo interno; no se envía a la gestoría).
// Se guardan en Drive en "Cierres Z/AAAA/AAAA-MM". No se borran: si uno está mal, se anula.

function carpetaZ_(fechaIso) {
  const raiz = DriveApp.getFolderById(prop_('CARPETA_ID'));
  const sub = (padre, nombre) => {
    const it = padre.getFoldersByName(nombre);
    return it.hasNext() ? it.next() : padre.createFolder(nombre);
  };
  return sub(sub(sub(raiz, 'Cierres Z'), fechaIso.slice(0, 4)), fechaIso.slice(0, 7));
}

function limpiarZ_(z) {
  const r = {};
  HOJAS.CierresZ.forEach(k => { if (k !== 'ocr_texto') r[k] = normalizar_(z[k]); });
  return r;
}

function zVisibles_(u) {
  return leer_('CierresZ')
    .filter(z => z.estado !== 'anulado' && (u.rol === 'dueno' || String(z.creado_por) === String(u.id)))
    .map(limpiarZ_);
}

// Guarda el archivo del ticket Z y lee lo que pueda. El cierre Z se crea al pulsar "Guardar".
function subirZ_(u, p) {
  const a = p.archivo || {};
  const ext = TIPOS_ARCHIVO[a.mime];
  if (!ext) throw new Error('Tipo de archivo no admitido. Usa una foto o un PDF.');
  if (!a.base64 || a.base64.length > 20 * 1024 * 1024) throw new Error('El archivo es demasiado grande (máximo 15 MB).');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(p.fecha || '') ? p.fecha : hoyISO_();
  const blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime, 'Cierre Z ' + fecha + ' ' + nuevoId_() + '.' + ext);
  const archivo = carpetaZ_(fecha).createFile(blob);
  const texto = leerArchivo_(archivo);
  return {
    archivo_id: archivo.getId(),
    archivo_url: archivo.getUrl(),
    leido: !!texto,
    lectura: analizarZ_(texto),
    ocr_texto: texto.slice(0, 5000)
  };
}

function analizarZ_(texto) {
  if (!texto) return {};
  const lineas = texto.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
  const r = {};
  const f = buscarFecha_(lineas);
  if (f) r.fecha = f;
  // "Z Nº 0045", "INFORME Z: 45", "CIERRE Z 045", "Nº Z 45"
  const m = texto.match(/(?:\bZ\s*(?:n[º°o]\.?|num(?:ero)?\.?|#)?\s*[:.]?\s*(\d{1,7})\b)|(?:n[º°o]\.?\s*(?:de\s*)?Z\s*[:.]?\s*(\d{1,7})\b)/i);
  if (m) r.num_z = String(Number(m[1] || m[2]));
  const imp = buscarImportes_(lineas);
  const fuerte = importesConEtiqueta_(lineas, /total\s*(?:de\s*)?ventas?|venta\s*total|total\s*bruto|total\s*z|gran\s*total/i, /sub\s*-?total/i, false);
  r.total = fuerte.length ? Math.max(...fuerte) : imp.total;
  if (imp.desglose) r.desglose = imp.desglose;
  return r;
}

function guardarZ_(u, p) {
  const d = p.z || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')) throw new Error('Falta la fecha del cierre Z.');
  if (d.fecha > hoyISO_()) throw new Error('La fecha no puede ser futura.');
  const total = numero_(d.total);
  if (total === '') throw new Error('Escribe el total de ventas del Z.');
  const num = String(d.num_z || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return conBloqueo_(() => {
    const todos = leer_('CierresZ').filter(z => z.estado !== 'anulado');
    const repetido = todos.find(z => String(z.id) !== String(d.id || '') &&
      ((num && String(z.num_z) === num) || (!num && z.fecha === d.fecha && Number(z.total) === total)));
    if (repetido && !d.forzar) throw new Error(`Ese cierre Z ya está apuntado (${num ? 'Z nº ' + num : 'mismo día e importe'}, del ${repetido.fecha.split('-').reverse().join('/')}).`);
    const cambios = { fecha: d.fecha, num_z: num, total, efectivo: numero_(d.efectivo), tarjeta: numero_(d.tarjeta), nota: String(d.nota || '').slice(0, 500), modificado_en: new Date() };
    TIPOS_DESGLOSE.forEach(t => {
      const b = numero_(d['base_' + t]), i = numero_(d['iva_' + t]);
      cambios['base_' + t] = b;
      cambios['iva_' + t] = i;
    });
    if (d.archivo_id) {
      cambios.archivo_id = d.archivo_id;
      cambios.archivo_url = d.archivo_url || '';
      if (d.ocr_texto) cambios.ocr_texto = String(d.ocr_texto).slice(0, 5000);
    }
    let z;
    if (d.id) {
      const actual = todos.find(x => String(x.id) === String(d.id));
      if (!actual) throw new Error('Ese cierre Z ya no existe.');
      if (u.rol !== 'dueno' && String(actual.creado_por) !== String(u.id)) throw new Error('No puedes cambiar este cierre Z.');
      // Si se cambia la foto, la anterior no se borra: pasa a "Anuladas".
      if (d.archivo_id && actual.archivo_id && actual.archivo_id !== d.archivo_id) aCarpetaAnuladas_(actual.archivo_id);
      z = actualizar_('CierresZ', d.id, cambios);
    } else {
      z = insertar_('CierresZ', Object.assign({ id: nuevoId_(), estado: 'ok', archivo_url: '', archivo_id: '', creado_por: u.id, creado_en: new Date(), ocr_texto: '' }, cambios));
    }
    if (z.archivo_id) {
      try {
        const archivo = DriveApp.getFileById(z.archivo_id);
        archivo.setName('Cierre Z ' + z.fecha + (z.num_z ? ' n' + z.num_z : '') + (archivo.getName().match(/\.\w+$/) || [''])[0]);
        archivo.moveTo(carpetaZ_(z.fecha));
      } catch (e) { console.error(e); }
    }
    return { z: limpiarZ_(z) };
  });
}

function anularZ_(u, p) {
  soloDueno_(u);
  const z = conBloqueo_(() => actualizar_('CierresZ', p.id, { estado: 'anulado', modificado_en: new Date() }));
  if (z.archivo_id) aCarpetaAnuladas_(z.archivo_id);
  return {};
}

function aCarpetaAnuladas_(archivoId) {
  try {
    const raiz = DriveApp.getFolderById(prop_('CARPETA_ID'));
    const it = raiz.getFoldersByName('Anuladas');
    DriveApp.getFileById(archivoId).moveTo(it.hasNext() ? it.next() : raiz.createFolder('Anuladas'));
  } catch (e) {
    console.error(e);
  }
}
