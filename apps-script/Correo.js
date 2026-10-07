// Importación de facturas que llegan por correo a la cuenta del restaurante (laflordecempazuchitl@gmail.com).
// A esa cuenta se reenvían las de restaurante@flordecempazuchitl.com (Hostinger) y las de los proveedores
// del Gmail personal. Cada noche se leen los adjuntos nuevos: si es una factura y no está ya apuntada,
// se crea como "por revisar"; si ya existe (p. ej. se subió en papel), no se duplica.
// Solo lee el correo (permiso de lectura): no envía, mueve ni borra mensajes.

const CORREO_DESDE_DEFECTO = '2026-10-01';
const CORREO_NO_FACTURA = /relaci[oó]n|rel_reg|justificante|extracto|presupuesto|cat[aá]logo|newsletter|flyer|booksy|passenger/i;
const CORREO_IMAGEN_FACTURA = /factura|fra[\s._-]|invoice|ticket|tiquet|recibo/i;
const CORREO_MAX_MS = 4.5 * 60 * 1000;

function importarCorreos() {
  const inicio = Date.now();
  const props = PropertiesService.getScriptProperties();
  borrarContinuacion_(props);
  const desde = props.getProperty('CORREO_DESDE') || CORREO_DESDE_DEFECTO;
  const hechos = new Set(leer_('Correos').map(c => String(c.clave)));
  const q = 'has:attachment after:' + desde.replace(/-/g, '/') + ' -in:sent -in:drafts -in:chats';

  const ids = [];
  let pagina;
  do {
    const r = Gmail.Users.Messages.list('me', { q, maxResults: 100, pageToken: pagina });
    (r.messages || []).forEach(m => ids.push(m.id));
    pagina = r.nextPageToken;
  } while (pagina);
  ids.reverse(); // de más antiguo a más nuevo

  let creados = 0, duplicados = 0, pendiente = false;
  for (const id of ids) {
    if (hechos.has(id + ':fin')) continue;
    const m = Gmail.Users.Messages.get('me', id, { format: 'full' });
    const cab = n => ((m.payload.headers || []).find(h => h.name.toLowerCase() === n) || {}).value || '';
    const de = cab('from'), asunto = cab('subject');
    const fecha = new Date(Number(m.internalDate));
    const partes = adjuntosDe_(m.payload);
    for (let i = 0; i < partes.length; i++) {
      const clave = id + ':' + i;
      if (hechos.has(clave)) continue;
      if (Date.now() - inicio > CORREO_MAX_MS) { pendiente = true; break; }
      let res;
      try {
        res = procesarAdjunto_(id, partes[i], de, asunto);
      } catch (e) {
        console.error(e && e.stack || e);
        res = { resultado: 'error: ' + (e && e.message || e) };
      }
      if (res.resultado === 'importada') creados++;
      if (res.resultado.startsWith('duplicada')) duplicados++;
      insertar_('Correos', { clave, fecha, remitente: de, asunto, adjunto: partes[i].filename, resultado: res.resultado, gasto_id: res.gasto_id || '' });
      hechos.add(clave);
    }
    if (pendiente) break;
    insertar_('Correos', { clave: id + ':fin', fecha, remitente: de, asunto, adjunto: '', resultado: 'correo revisado', gasto_id: '' });
    hechos.add(id + ':fin');
  }
  console.log(`Importadas: ${creados}, duplicadas: ${duplicados}${pendiente ? ' (continúa en un minuto)' : ''}`);
  if (pendiente) programarContinuacion_(props);
}

// Partes del mensaje que son archivos adjuntos (no las imágenes incrustadas en el texto).
function adjuntosDe_(payload) {
  const out = [];
  const recorrer = p => {
    const cid = (p.headers || []).some(h => h.name.toLowerCase() === 'content-id');
    if (p.filename && p.body && (p.body.attachmentId || p.body.data) && !cid) out.push(p);
    (p.parts || []).forEach(recorrer);
  };
  recorrer(payload);
  return out;
}

function procesarAdjunto_(mensajeId, parte, de, asunto) {
  const nombre = parte.filename;
  const esPdf = parte.mimeType === 'application/pdf' || /\.pdf$/i.test(nombre);
  const esImagen = /^image\/(jpeg|png)$/.test(parte.mimeType);
  if (!esPdf && !esImagen) return { resultado: 'ignorado (no es PDF ni foto)' };
  if (CORREO_NO_FACTURA.test(nombre + ' ' + asunto + ' ' + de)) return { resultado: 'ignorado (no es factura)' };
  const tam = parte.body.size || 0;
  if (esImagen && (tam < 40 * 1024 || !CORREO_IMAGEN_FACTURA.test(nombre + ' ' + asunto))) return { resultado: 'ignorado (imagen)' };

  const datos = parte.body.attachmentId
    ? Gmail.Users.Messages.Attachments.get('me', mensajeId, parte.body.attachmentId).data
    : parte.body.data;
  const blob = Utilities.newBlob(Utilities.base64DecodeWebSafe(datos), esPdf ? 'application/pdf' : parte.mimeType, nombre);
  const archivo = carpetaMes_(hoyISO_()).createFile(blob);
  const nota = ('Correo de ' + de.replace(/<.*>/, '').replace(/"/g, '').trim() + ': ' + asunto).slice(0, 200);
  const r = prepararGasto_(archivo, 'correo', 'correo', nota);
  const g = r.gasto;

  // Sin total y sin nº de factura o NIF, no parece una factura: se descarta.
  if (g.total === '' || (!g.num_factura && !g.nif)) {
    archivo.setTrashed(true);
    return { resultado: 'ignorado (no parece factura)' };
  }
  if (r.duplicado) {
    archivo.setTrashed(true);
    return { resultado: 'duplicada (ya estaba)', gasto_id: r.duplicado.id };
  }
  archivo.setName([g.fecha, g.proveedor_nombre, g.num_factura].filter(Boolean).join(' ').replace(/[\\\/:*?"<>|]+/g, '-').slice(0, 120) + (esPdf ? '.pdf' : '.jpg'));
  moverArchivo_(g.archivo_id, g.fecha, g.proveedor_nombre);
  conBloqueo_(() => insertar_('Gastos', g));
  return { resultado: 'importada', gasto_id: g.id };
}

// Si no da tiempo a todo (Google corta a los 6 minutos), se sigue un minuto después.
function programarContinuacion_(props) {
  const t = ScriptApp.newTrigger('importarCorreos').timeBased().after(60 * 1000).create();
  props.setProperty('CORREO_CONTINUACION', t.getUniqueId());
}

function borrarContinuacion_(props) {
  const id = props.getProperty('CORREO_CONTINUACION');
  if (!id) return;
  ScriptApp.getProjectTriggers().filter(t => t.getUniqueId() === id).forEach(t => ScriptApp.deleteTrigger(t));
  props.deleteProperty('CORREO_CONTINUACION');
}
