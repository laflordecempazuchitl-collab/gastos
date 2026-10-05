// Cierre de caja diario: un registro por día con efectivo y datáfono, y la foto del sobre como comprobante.

function carpetaCierres_(fechaIso) {
  const raiz = DriveApp.getFolderById(prop_('CARPETA_ID'));
  const sub = (padre, nombre) => {
    const it = padre.getFoldersByName(nombre);
    return it.hasNext() ? it.next() : padre.createFolder(nombre);
  };
  return sub(sub(sub(raiz, 'Cierres de caja'), fechaIso.slice(0, 4)), fechaIso.slice(0, 7));
}

function limpiarCierre_(c) {
  const r = {};
  HOJAS.Cierres.forEach(k => { if (k !== 'ocr_texto') r[k] = normalizar_(c[k]); });
  return r;
}

function cierresVisibles_(u) {
  return leer_('Cierres')
    .filter(c => u.rol === 'dueno' || String(c.creado_por) === String(u.id))
    .map(limpiarCierre_);
}

// Guarda la foto del sobre y lee lo que pueda. El cierre se crea al pulsar "Guardar".
function subirCierre_(u, p) {
  const a = p.archivo || {};
  const ext = TIPOS_ARCHIVO[a.mime];
  if (!ext) throw new Error('Tipo de archivo no admitido. Usa una foto o un PDF.');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(p.fecha || '') ? p.fecha : hoyISO_();
  const blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime, 'Cierre ' + fecha + ' ' + nuevoId_() + '.' + ext);
  const archivo = carpetaCierres_(fecha).createFile(blob);
  const texto = leerArchivo_(archivo);
  return {
    archivo_id: archivo.getId(),
    archivo_url: archivo.getUrl(),
    leido: !!texto,
    lectura: analizarCierre_(texto),
    ocr_texto: texto.slice(0, 5000)
  };
}

function analizarCierre_(texto) {
  if (!texto) return {};
  const lineas = texto.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
  const primero = (re, excluir) => {
    const l = importesConEtiqueta_(lineas, re, excluir, false);
    return l.length ? Math.max(...l) : '';
  };
  const r = {
    efectivo: primero(/efectivo|contado|met[aá]lico|cash/i),
    tarjeta: primero(/tarjeta|dat[aá]fono|visa|mastercard|card|tpv/i),
    total: primero(/total|venta|caja/i, /sub\s*-?total/i)
  };
  if (r.efectivo !== '' && r.tarjeta === '' && r.total !== '' && r.total > r.efectivo) r.tarjeta = r2_(r.total - r.efectivo);
  if (r.tarjeta !== '' && r.efectivo === '' && r.total !== '' && r.total > r.tarjeta) r.efectivo = r2_(r.total - r.tarjeta);
  const f = buscarFecha_(lineas);
  if (f) r.fecha = f;
  return r;
}

function guardarCierre_(u, p) {
  const d = p.cierre || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')) throw new Error('Falta la fecha.');
  if (d.fecha > hoyISO_()) throw new Error('La fecha no puede ser futura.');
  const efectivo = numero_(d.efectivo) || 0;
  const tarjeta = numero_(d.tarjeta) || 0;
  if (efectivo < 0 || tarjeta < 0) throw new Error('Los importes no pueden ser negativos.');
  if (efectivo === 0 && tarjeta === 0) throw new Error('Escribe el efectivo o el datáfono.');
  return conBloqueo_(() => {
    const todos = leer_('Cierres');
    const otro = todos.find(c => c.fecha === d.fecha && String(c.id) !== String(d.id || ''));
    if (otro) throw new Error('Ya hay un cierre apuntado para ese día. Ábrelo desde la lista para corregirlo.');
    const cambios = {
      fecha: d.fecha, efectivo, tarjeta, total: r2_(efectivo + tarjeta),
      nota: String(d.nota || '').slice(0, 500), modificado_en: new Date()
    };
    if (d.archivo_id) {
      cambios.archivo_id = d.archivo_id;
      cambios.archivo_url = d.archivo_url || '';
      if (d.ocr_texto) cambios.ocr_texto = String(d.ocr_texto).slice(0, 5000);
    }
    let c;
    if (d.id) {
      const actual = todos.find(x => String(x.id) === String(d.id));
      if (!actual) throw new Error('Ese cierre ya no existe.');
      if (u.rol !== 'dueno' && String(actual.creado_por) !== String(u.id)) throw new Error('No puedes cambiar este cierre.');
      if (d.archivo_id && actual.archivo_id && actual.archivo_id !== d.archivo_id) {
        try { DriveApp.getFileById(actual.archivo_id).setTrashed(true); } catch (e) { console.error(e); }
      }
      c = actualizar_('Cierres', d.id, cambios);
    } else {
      c = insertar_('Cierres', Object.assign({ id: nuevoId_(), archivo_url: '', archivo_id: '', creado_por: u.id, creado_en: new Date(), ocr_texto: '' }, cambios));
    }
    if (c.archivo_id) {
      try {
        const archivo = DriveApp.getFileById(c.archivo_id);
        archivo.setName('Cierre ' + c.fecha + (archivo.getName().match(/\.\w+$/) || [''])[0]);
        archivo.moveTo(carpetaCierres_(c.fecha));
      } catch (e) { console.error(e); }
    }
    return { cierre: limpiarCierre_(c) };
  });
}

function borrarCierre_(u, p) {
  soloDueno_(u);
  const c = buscar_('Cierres', p.id);
  if (!c) return {};
  conBloqueo_(() => borrarFila_('Cierres', c.id));
  if (c.archivo_id) {
    try { DriveApp.getFileById(c.archivo_id).setTrashed(true); } catch (e) { console.error(e); }
  }
  return {};
}
