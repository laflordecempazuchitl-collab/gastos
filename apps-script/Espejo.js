// Copia de Drive al ordenador: el programa del ordenador pide la lista de archivos y descarga los que le faltan.
// Solo lectura y protegido con la clave SYNC_KEY (propiedad del script). No se borra nada en ningún lado.

function comprobarClaveEspejo_(p) {
  const k = prop_('SYNC_KEY');
  if (!k || p.clave !== k) throw new Error('No autorizado.');
}

// Ruta en el ordenador para cada carpeta de Drive:
// Facturas/2026/2026-08/Makro -> 2026-08/Makro ; Cierres de caja/2026/2026-08 -> Cierres de caja/2026-08 (igual con Cierres Z)
function rutaLocal_(partes) {
  if (partes[0] === 'Facturas') return partes.slice(2).join('/');
  if (partes[0] === 'Cierres de caja' || partes[0] === 'Cierres Z') return [partes[0]].concat(partes.slice(2)).join('/');
  return partes.join('/');
}

function espejoLista_(p) {
  comprobarClaveEspejo_(p);
  const archivos = [];
  const recorrer = (carpetaId, partes) => {
    let token;
    do {
      const r = Drive.Files.list({
        q: `'${carpetaId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, md5Checksum, size, modifiedTime)',
        pageSize: 1000, pageToken: token
      });
      (r.files || []).forEach(f => {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          if (f.id !== prop_('TEMPORAL_ID')) recorrer(f.id, partes.concat(f.name));
        } else if (!/^application\/vnd\.google-apps\./.test(f.mimeType)) {
          archivos.push({ id: f.id, nombre: f.name, ruta: rutaLocal_(partes), md5: f.md5Checksum, tam: Number(f.size) || 0, mod: f.modifiedTime });
        }
      });
      token = r.nextPageToken;
    } while (token);
  };
  recorrer(prop_('CARPETA_ID'), []);
  return { archivos };
}

function espejoArchivo_(p) {
  comprobarClaveEspejo_(p);
  const f = DriveApp.getFileById(p.id);
  // Solo archivos de la carpeta de la app, nunca otros de la cuenta.
  const raiz = prop_('CARPETA_ID');
  let dentro = false;
  for (let it = f.getParents(), n = 0; it.hasNext() && !dentro && n < 10; n++) {
    const c = it.next();
    if (c.getId() === raiz) dentro = true;
    else it = c.getParents();
  }
  if (!dentro) throw new Error('Ese archivo no es de la app.');
  return { nombre: f.getName(), base64: Utilities.base64Encode(f.getBlob().getBytes()) };
}
