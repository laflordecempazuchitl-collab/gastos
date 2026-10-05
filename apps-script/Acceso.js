// Acceso con PIN de 4 dígitos por persona.
// Tras 5 fallos seguidos el usuario queda bloqueado 15 minutos; al tercer bloqueo del día, 24 horas.

function hash_(texto) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes);
}

function validarPin_(pin) {
  if (!/^\d{4}$/.test(String(pin || ''))) throw new Error('El PIN tiene que tener 4 números.');
}

function usuarioPublico_(u) {
  return { id: u.id, nombre: u.nombre, rol: u.rol, activo: esVerdad_(u.activo) };
}

function inicio_() {
  const usuarios = leer_('Usuarios').filter(u => esVerdad_(u.activo));
  return {
    version: VERSION,
    necesitaAlta: usuarios.length === 0,
    usuarios: usuarios.map(u => ({ id: u.id, nombre: u.nombre }))
  };
}

// Solo funciona si todavía no hay ningún usuario: crea al dueño.
function altaInicial_(p) {
  return conBloqueo_(() => {
    if (leer_('Usuarios').length > 0) throw new Error('Ya hay usuarios dados de alta.');
    const nombre = String(p.nombre || '').trim();
    if (!nombre) throw new Error('Escribe tu nombre.');
    validarPin_(p.pin);
    const sal = nuevoId_();
    const u = { id: nuevoId_(), nombre, rol: 'dueno', activo: true, pin_hash: hash_(sal + ':' + p.pin), sal, creado_en: new Date() };
    insertar_('Usuarios', u);
    return crearSesion_(u);
  });
}

function login_(p) {
  const u = leer_('Usuarios').find(x => String(x.id) === String(p.usuario_id) && esVerdad_(x.activo));
  if (!u) throw new Error('Usuario no encontrado.');
  const props = PropertiesService.getScriptProperties();
  const clave = 'intentos_' + u.id;
  const hoy = hoyISO_();
  let int = JSON.parse(props.getProperty(clave) || '{}');
  if (int.dia !== hoy) int = { dia: hoy, fallos: 0, bloqueos: 0, hasta: 0 };
  if (int.hasta && Date.now() < int.hasta) {
    const min = Math.ceil((int.hasta - Date.now()) / 60000);
    throw new Error('Demasiados intentos. Prueba otra vez dentro de ' + (min > 90 ? Math.ceil(min / 60) + ' horas.' : min + ' minutos.'));
  }
  if (hash_(u.sal + ':' + p.pin) !== u.pin_hash) {
    int.fallos++;
    if (int.fallos >= 5) {
      int.fallos = 0;
      int.bloqueos++;
      int.hasta = Date.now() + (int.bloqueos >= 3 ? 24 * 60 : 15) * 60000;
    }
    props.setProperty(clave, JSON.stringify(int));
    throw new Error('PIN incorrecto.');
  }
  props.deleteProperty(clave);
  return crearSesion_(u);
}

function crearSesion_(u) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  const caduca = new Date(Date.now() + DIAS_SESION * 86400000);
  insertar_('Sesiones', { token_hash: hash_(token), usuario_id: u.id, caduca, creado_en: new Date() });
  return { token, usuario: usuarioPublico_(u) };
}

// Devuelve el usuario de la sesión o lanza SESION_CADUCADA.
function sesion_(token) {
  if (!token) throw new Error('SESION_CADUCADA');
  const th = hash_(token);
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('s_' + th);
  if (guardado) return JSON.parse(guardado);
  const s = leer_('Sesiones').find(x => x.token_hash === th);
  if (!s || new Date(s.caduca).getTime() < Date.now()) throw new Error('SESION_CADUCADA');
  const u = leer_('Usuarios').find(x => String(x.id) === String(s.usuario_id) && esVerdad_(x.activo));
  if (!u) throw new Error('SESION_CADUCADA');
  const pub = usuarioPublico_(u);
  cache.put('s_' + th, JSON.stringify(pub), 600);
  return pub;
}

function logout_(token) {
  const th = hash_(token);
  CacheService.getScriptCache().remove('s_' + th);
  const s = leer_('Sesiones').find(x => x.token_hash === th);
  if (s) hoja_('Sesiones').deleteRow(s._fila);
  return {};
}

function soloDueno_(u) {
  if (u.rol !== 'dueno') throw new Error('Solo el dueño puede hacer esto.');
}

function guardarUsuario_(u, p) {
  soloDueno_(u);
  const d = p.usuario || {};
  const nombre = String(d.nombre || '').trim();
  if (!nombre) throw new Error('Falta el nombre.');
  const rol = d.rol === 'dueno' ? 'dueno' : 'empleado';
  return conBloqueo_(() => {
    const cambios = { nombre, rol, activo: d.activo !== false };
    if (d.pin) {
      validarPin_(d.pin);
      cambios.sal = nuevoId_();
      cambios.pin_hash = hash_(cambios.sal + ':' + d.pin);
    }
    let r;
    if (d.id) {
      if (String(d.id) === String(u.id) && (rol !== 'dueno' || !cambios.activo)) {
        throw new Error('No puedes quitarte a ti mismo el permiso de dueño.');
      }
      r = actualizar_('Usuarios', d.id, cambios);
      // Las sesiones abiertas se guardan 10 minutos en caché: el cambio tarda como mucho eso.
      if (!cambios.activo || d.pin) cerrarSesionesDe_(d.id);
    } else {
      if (!d.pin) throw new Error('Pon un PIN de 4 números.');
      r = insertar_('Usuarios', Object.assign({ id: nuevoId_(), creado_en: new Date() }, cambios));
    }
    return { usuario: usuarioPublico_(r) };
  });
}

function cerrarSesionesDe_(usuarioId) {
  const hoja = hoja_('Sesiones');
  leer_('Sesiones')
    .filter(s => String(s.usuario_id) === String(usuarioId))
    .map(s => s._fila)
    .sort((a, b) => b - a)
    .forEach(f => hoja.deleteRow(f));
}
