// Punto de entrada de la web app. La app del móvil envía {accion, token, ...} por POST.

function doGet() {
  return json_({ ok: true, app: 'gastos', version: VERSION });
}

function doPost(e) {
  let respuesta;
  try {
    const p = JSON.parse(e.postData.contents);
    respuesta = Object.assign({ ok: true }, despachar_(p));
  } catch (err) {
    console.error(err && err.stack || err);
    respuesta = { ok: false, error: (err && err.message) || String(err) };
  }
  return json_(respuesta);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function despachar_(p) {
  switch (p.accion) {
    case 'inicio': return inicio_();
    case 'altaInicial': return altaInicial_(p);
    case 'login': return login_(p);
  }
  const u = sesion_(p.token);
  switch (p.accion) {
    case 'logout': return logout_(p.token);
    case 'datos': return datos_(u);
    case 'subir': return subir_(u, p);
    case 'adjuntar': return adjuntar_(u, p);
    case 'guardarGasto': return guardarGasto_(u, p);
    case 'descartar': return descartar_(u, p);
    case 'anular': return anular_(u, p);
    case 'guardarProveedor': return guardarProveedor_(u, p);
    case 'guardarCategoria': return guardarCategoria_(u, p);
    case 'enviarGestoria': return enviarGestoria_(u, p);
    case 'cambiarPin': return cambiarPin_(u, p);
    case 'guardarRecurrente': return guardarRecurrente_(u, p);
    case 'guardarUsuario': return guardarUsuario_(u, p);
  }
  throw new Error('Acción desconocida: ' + p.accion);
}

function datos_(u) {
  const dueno = u.rol === 'dueno';
  const gastos = leer_('Gastos')
    .filter(g => g.estado !== 'anulado' && (dueno || String(g.creado_por) === String(u.id)))
    .map(limpiarGasto_);
  const r = {
    version: VERSION,
    usuario: u,
    categorias: categorias_(),
    gastos,
    proveedores: leer_('Proveedores').map(limpiarProveedor_)
  };
  if (dueno) {
    r.recurrentes = leer_('Recurrentes').map(x => { delete x._fila; x.activo = esVerdad_(x.activo); return x; });
    r.usuarios = leer_('Usuarios').map(usuarioPublico_);
    r.gestoria_email = prop_('GESTORIA_EMAIL') || '';
  }
  return r;
}
