'use strict';
// App de gastos · La Flor de Cempazúchitl

const API = (window.CONFIG || {}).API_URL || '';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const GRUPOS = { proveedores: 'Proveedores', fijos: 'Gastos fijos', varios: 'Varios' };
const COLOR_GRUPO = { proveedores: '#B45309', fijos: '#0F5C5A', varios: '#7A4B6E' };
const TIPOS_IVA = [0, 4, 10, 21];

// ---------- Utilidades ----------

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round(Number(n) * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const vacio = v => v === '' || v === null || v === undefined;

function leerLS(clave, json) {
  try {
    const v = localStorage.getItem('gastos_' + clave);
    return json ? JSON.parse(v || 'null') : v;
  } catch (e) { return null; }
}
function guardarLS(clave, valor) {
  try {
    if (valor === null || valor === undefined) localStorage.removeItem('gastos_' + clave);
    else localStorage.setItem('gastos_' + clave, typeof valor === 'string' ? valor : JSON.stringify(valor));
  } catch (e) { /* sin almacenamiento: la app sigue funcionando */ }
}

// 1234.5 -> "1.234,50"
function num(n) {
  n = Number(n) || 0;
  const neg = n < 0;
  const [e, d] = Math.abs(n).toFixed(2).split('.');
  return (neg ? '-' : '') + e.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
}
const eur = n => num(n) + ' €';
// Valor para un campo editable: "1234,50"
const numCampo = n => vacio(n) ? '' : Number(n).toFixed(2).replace('.', ',');
function leerNum(s) {
  if (typeof s === 'number') return s;
  s = String(s || '').replace(/[\s€]/g, '');
  if (!s) return '';
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isNaN(n) ? '' : r2(n);
}

function hoyISO() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function fechaCorta(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return d + ' ' + MESES_CORTOS[m - 1] + (a !== new Date().getFullYear() ? ' ' + a : '');
}
const normal = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ---------- Estado ----------

const E = {
  token: leerLS('token'),
  datos: leerLS('datos', true),
  acceso: null,
  form: null,
  vistaPrevia: {},
  sugerencia: leerLS('sugerencias', true) || {},
  filtro: 'todas',
  busqueda: '',
  periodo: null,
  tabProv: 'proveedores',
  buscarProv: '',
  ultimaCarga: 0,
  anterior: 'inicio'
};

const yo = () => (E.datos && E.datos.usuario) || {};
const esDueno = () => yo().rol === 'dueno';
const categorias = () => (E.datos && E.datos.categorias) || [];
function grupoDe(cat) {
  const c = categorias().find(x => x.nombre === cat);
  return c ? c.grupo : 'varios';
}
const proveedor = id => ((E.datos && E.datos.proveedores) || []).find(p => String(p.id) === String(id));
const gastos = () => (E.datos && E.datos.gastos) || [];
const cierres = () => (E.datos && E.datos.cierres) || [];

// ---------- Comunicación con el servidor ----------

async function api(accion, datos = {}, textoCarga) {
  if (!API && !window.DEMO) throw new Error('Falta la dirección del servidor en config.js.');
  if (textoCarga) cargando(textoCarga);
  try {
    if (window.DEMO) return await window.DEMO(accion, datos);
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ accion, token: E.token }, datos))
    });
    if (!r.ok) throw new Error('El servidor no responde (' + r.status + ').');
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('Respuesta extraña del servidor. Inténtalo otra vez.'); }
    if (!j.ok) {
      if (j.error === 'SESION_CADUCADA') {
        cerrarSesionLocal();
        throw new Error('Tu sesión ha caducado. Vuelve a entrar.');
      }
      throw new Error(j.error || 'Error desconocido.');
    }
    return j;
  } catch (e) {
    if (e instanceof TypeError) throw new Error('Sin conexión a internet. Inténtalo otra vez.');
    throw e;
  } finally {
    if (textoCarga) cargando(false);
  }
}

function cargando(texto) {
  const c = $('#cargando');
  c.hidden = !texto;
  if (texto) $('#cargando-texto').textContent = texto;
}

let temporizadorAviso;
function avisar(texto, tipo) {
  const a = $('#aviso');
  a.textContent = texto;
  a.className = tipo || '';
  a.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { a.hidden = true; }, tipo === 'error' ? 5000 : 2600);
}

let cargaEnCurso = null;
function refrescar(mostrarCarga) {
  if (!cargaEnCurso) {
    cargaEnCurso = api('datos', {}, mostrarCarga ? 'Cargando datos…' : null)
      .then(d => {
        const primeraVez = !E.datos;
        E.datos = d;
        E.ultimaCarga = Date.now();
        guardarLS('datos', d);
        // Lo escrito se guarda en E.form al teclear, así que se puede repintar sin perderlo;
        // solo se espera si el cursor está en un campo, para no quitarle el foco.
        const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
        if (primeraVez || !escribiendo) {
          pintar();
          if ($('#hoja') && H.pintar) repintarHoja();
        } else {
          pintarNav();
        }
      })
      .finally(() => { cargaEnCurso = null; });
  }
  return cargaEnCurso;
}

function guardarDatos() {
  guardarLS('datos', E.datos);
}

function reemplazarGasto(g) {
  const lista = gastos();
  const i = lista.findIndex(x => x.id === g.id);
  if (g.estado === 'anulado') { if (i >= 0) lista.splice(i, 1); }
  else if (i >= 0) lista[i] = g;
  else lista.unshift(g);
  guardarDatos();
}

function reemplazarProveedor(p) {
  const lista = E.datos.proveedores = E.datos.proveedores || [];
  const i = lista.findIndex(x => x.id === p.id);
  if (i >= 0) lista[i] = p; else lista.push(p);
}

function cerrarSesionLocal() {
  E.token = null;
  E.datos = null;
  E.form = null;
  guardarLS('token', null);
  guardarLS('datos', null);
  guardarLS('sugerencias', null);
  location.hash = '';
  pintar();
}

// ---------- Navegación ----------

function ruta() {
  const h = decodeURIComponent(location.hash.slice(1)) || 'inicio';
  const partes = h.split('/');
  return { p: partes[0], a: partes[1] || '', b: partes[2] || '' };
}
function ir(h) {
  if (location.hash === '#' + h) pintar();
  else location.hash = h;
}
window.addEventListener('hashchange', e => {
  const viejo = decodeURIComponent((e.oldURL.split('#')[1] || 'inicio'));
  if (!/^(revisar|anadir|cierre)/.test(viejo)) E.anterior = viejo;
  cerrarHoja();
  window.scrollTo(0, 0);
  pintar();
});

const ICONOS = {
  inicio: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  facturas: '<path d="M6 2h9l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M14 2v6h6M9 13h7M9 17h7"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  informes: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  proveedores: '<path d="M3 9h18l-1.5-5h-15z"/><path d="M4 9v11h16V9M9 20v-6h6v6"/>'
};
const svg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS[n]}</svg>`;

function pintarNav() {
  const nav = $('#nav');
  const conNav = E.token && E.datos && !['revisar', 'anadir', 'cierre'].includes(ruta().p);
  nav.hidden = !conNav;
  $('#app').classList.toggle('sin-nav', !conNav);
  if (!conNav) return;
  const p = ruta().p;
  const enlace = (id, texto) => `<a href="#${id}" class="${p === id ? 'activo' : ''}">${svg(id)}<span>${texto}</span></a>`;
  const pendientes = gastos().filter(g => g.estado === 'por_revisar').length;
  const mas = `<a href="#anadir" class="mas" aria-label="Añadir factura"><span class="circulo">${svg('mas')}</span></a>`;
  nav.innerHTML = esDueno()
    ? enlace('inicio', 'Inicio') + enlace('facturas', 'Facturas' + (pendientes ? ` (${pendientes})` : '')) + mas + enlace('informes', 'Informes') + enlace('proveedores', 'Proveedores')
    : enlace('inicio', 'Inicio') + mas + enlace('facturas', 'Facturas');
}

function pintar() {
  const app = $('#app');
  if (!E.token) { pintarNav(); return pintarAcceso(); }
  if (!E.datos) {
    app.innerHTML = '';
    pintarNav();
    refrescar(true).catch(e => {
      app.innerHTML = `<div class="vacio-estado"><p>${esc(e.message)}</p><button class="boton" data-a="reintentar">Reintentar</button></div>`;
    });
    return;
  }
  const r = ruta();
  const soloDueno = ['informes', 'proveedores'];
  if (soloDueno.includes(r.p) && !esDueno()) { location.hash = 'inicio'; return; }
  pintarNav();
  const pantallas = { inicio: pintarInicio, anadir: pintarAnadir, revisar: pintarRevisar, cierre: pintarCierre, facturas: pintarFacturas, informes: pintarInformes, proveedores: pintarProveedores };
  (pantallas[r.p] || pintarInicio)(r);
}

// ---------- Acceso ----------

async function pintarAcceso() {
  const app = $('#app');
  if (!E.acceso) {
    app.innerHTML = '';
    try {
      E.acceso = await api('inicio', {}, 'Conectando…');
      E.acceso.pin = '';
    } catch (e) {
      app.innerHTML = `<div class="acceso"><img class="logo" src="icons/icon-192.png" alt=""><h1>Gastos</h1><p class="tenue">${esc(e.message)}</p><button class="boton" data-a="reintentar">Reintentar</button></div>`;
      return;
    }
  }
  const A = E.acceso;
  const logo = `<img class="logo" src="icons/icon-192.png" alt=""><h1>Gastos</h1><p class="tenue">La Flor de Cempazúchitl</p>`;
  if (A.necesitaAlta) {
    app.innerHTML = `<div class="acceso">${logo}
      <div class="tarjeta" style="text-align:left;margin-top:20px">
        <h2>Primera vez</h2>
        <p class="tenue">Crea tu usuario de dueño. Luego podrás añadir al resto del equipo.</p>
        <label class="campo"><span>Tu nombre</span><input class="entrada" id="alta-nombre" autocomplete="name"></label>
        <label class="campo"><span>PIN de 4 números</span><input class="entrada" id="alta-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label>
        <label class="campo"><span>Repite el PIN</span><input class="entrada" id="alta-pin2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label>
        <button class="boton" data-a="altaInicial">Crear y entrar</button>
      </div></div>`;
    return;
  }
  if (!A.elegido) {
    app.innerHTML = `<div class="acceso">${logo}
      <p style="margin-top:28px;font-weight:600">¿Quién eres?</p>
      <div class="personas">${A.usuarios.map(u => `<button class="boton secundario" data-a="elegirUsuario" data-id="${esc(u.id)}">${esc(u.nombre)}</button>`).join('')}</div>
    </div>`;
    return;
  }
  const u = A.usuarios.find(x => x.id === A.elegido) || {};
  app.innerHTML = `<div class="acceso">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h1>Hola, ${esc(u.nombre)}</h1>
    <p class="tenue">Escribe tu PIN</p>
    <div class="puntos-pin" id="puntos">${[0, 1, 2, 3].map(i => `<span class="${i < A.pin.length ? 'lleno' : ''}"></span>`).join('')}</div>
    <p class="error-pin" id="error-pin">${esc(A.error || '')}</p>
    <div class="teclado">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-a="tecla" data-n="${n}">${n}</button>`).join('')}
      <button class="vacio" tabindex="-1"></button><button data-a="tecla" data-n="0">0</button><button class="borrar" data-a="tecla" data-n="x" aria-label="Borrar">⌫</button>
    </div>
    <button class="enlace" data-a="cambiarUsuario" style="margin-top:18px">No soy ${esc(u.nombre)}</button>
  </div>`;
}

async function entrar(r) {
  E.token = r.token;
  guardarLS('token', r.token);
  E.acceso = null;
  E.datos = null;
  location.hash = 'inicio';
  pintar();
}

// ---------- Inicio ----------

function sumar(lista) { return r2(lista.reduce((s, g) => s + (Number(g.total) || 0), 0)); }
function mesClave(desfase = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + desfase);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}
const nombreMes = clave => MESES[Number(clave.slice(5, 7)) - 1];

// Acceso al cierre de caja del día (o aviso de que ya está apuntado).
function avisoCierre() {
  const f = fechaCierrePorDefecto();
  const c = cierreDe(f);
  const cuando = f === hoyISO() ? 'de hoy' : 'de anoche';
  const estilo = 'style="background:var(--verde-suave);color:var(--verde);border-color:#BFE0DB"';
  return c
    ? `<a class="aviso-revisar" href="#cierre/${esc(c.id)}" ${estilo}><span class="burbuja" style="background:var(--verde)">✓</span><span>Cierre ${cuando} apuntado${esDueno() ? ' · ' + eur(c.total) : ''}</span><span style="margin-left:auto">›</span></a>`
    : `<a class="aviso-revisar" href="#cierre/nuevo" ${estilo}><span class="burbuja" style="background:var(--verde)">€</span><span>Apuntar el cierre de caja ${cuando}</span><span style="margin-left:auto">›</span></a>`;
}

function filaGasto(g) {
  const grupo = grupoDe(g.categoria);
  const titulo = g.proveedor_nombre || g.nota || g.categoria || 'Sin proveedor';
  const detalle = [g.origen === 'correo' ? '✉️ ' + fechaCorta(g.fecha) : fechaCorta(g.fecha), g.categoria || 'Sin categoría', g.num_factura ? 'Nº ' + g.num_factura : ''].filter(Boolean).join(' · ');
  let marca = '';
  if (g.estado === 'por_revisar') marca = '<span class="etiqueta">Por revisar</span>';
  else if (g.origen === 'recurrente' && !g.archivo_id) marca = '<span class="etiqueta gris">Falta recibo</span>';
  return `<li><a class="fila g-${grupo}" href="#revisar/${esc(g.id)}" style="text-decoration:none;color:inherit">
    <span class="icono">${esc((titulo[0] || '?').toUpperCase())}</span>
    <span class="medio"><span class="titulo" style="display:block">${esc(titulo)}</span><span class="detalle" style="display:block">${esc(detalle)}</span></span>
    <span class="derecha"><span class="importe" style="display:block">${eur(g.total)}</span>${marca}</span>
  </a></li>`;
}

function ordenados(lista) {
  return lista.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || String(b.creado_en).localeCompare(String(a.creado_en)));
}

function pintarInicio() {
  const app = $('#app');
  const u = yo();
  const pendientes = gastos().filter(g => g.estado === 'por_revisar');
  const avisoPendientes = pendientes.length
    ? `<a class="aviso-revisar" href="#facturas/por_revisar"><span class="burbuja">${pendientes.length}</span><span>${pendientes.length === 1 ? 'Factura por revisar' : 'Facturas por revisar'}</span><span style="margin-left:auto">›</span></a>`
    : '';
  const cabecera = `<div class="cabecera"><div><p class="sub">Hola, ${esc(u.nombre)}</p><h1>${esDueno() ? 'Gastos de ' + nombreMes(mesClave()) : 'Tus facturas'}</h1></div>
    <div style="display:flex;gap:14px"><button class="enlace" data-a="cambiarPin">Mi PIN</button><button class="enlace" data-a="salir">Salir</button></div></div>`;

  if (!esDueno()) {
    const ultimas = ordenados(gastos()).slice(0, 15);
    app.innerHTML = cabecera + avisoCierre() + avisoPendientes +
      `<a class="boton" href="#anadir" style="margin-bottom:16px">＋ Añadir factura</a>
      <div class="tarjeta"><h2>Últimas que has subido</h2>${ultimas.length ? `<ul class="lista">${ultimas.map(filaGasto).join('')}</ul>` : '<p class="vacio-estado">Todavía no has subido ninguna.</p>'}</div>`;
    return;
  }

  const mes = mesClave(), mesAnt = mesClave(-1);
  const delMes = gastos().filter(g => (g.fecha || '').startsWith(mes));
  const total = sumar(delMes);
  const totalAnt = sumar(gastos().filter(g => (g.fecha || '').startsWith(mesAnt)));
  const porGrupo = {};
  Object.keys(GRUPOS).forEach(k => { porGrupo[k] = sumar(delMes.filter(g => grupoDe(g.categoria) === k)); });
  const porCat = categorias()
    .map(c => ({ c, total: sumar(delMes.filter(g => g.categoria === c.nombre)), n: delMes.filter(g => g.categoria === c.nombre).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.total - a.total);
  const sinCat = delMes.filter(g => !g.categoria);
  const ingresosMes = sumarCaja(cierres().filter(c => c.fecha.startsWith(mes)));
  const resultadoMes = r2(ingresosMes - total);
  const tarjetaCaja = `<button class="tarjeta" data-a="verCaja" style="display:block;width:100%;text-align:left;border:0;cursor:pointer">
      <div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="margin:0">Caja de ${nombreMes(mes)}</h2><span class="peque" style="color:var(--ambar);font-weight:600">Ver resultados ›</span></div>
      <div class="resumen-iva" style="margin-top:10px">
        <span>Ingresos (cierres)</span><b>${eur(ingresosMes)}</b>
        <span>Gastos</span><b>− ${eur(total)}</b>
        <span style="font-weight:700">Resultado</span><b style="color:${resultadoMes >= 0 ? 'var(--ok)' : 'var(--rojo)'}">${eur(resultadoMes)}</b>
      </div></button>`;

  app.innerHTML = cabecera + avisoCierre() + avisoPendientes + `
    <div class="tarjeta ambar">
      <p class="sub" style="margin:0">Total gastado en ${nombreMes(mes)}</p>
      <div class="num-grande">${eur(total)}</div>
      <p class="tenue peque" style="margin:0">${nombreMes(mesAnt)[0].toUpperCase() + nombreMes(mesAnt).slice(1)}: ${eur(totalAnt)} · ${delMes.length} ${delMes.length === 1 ? 'gasto' : 'gastos'}</p>
      <div class="barra-grupos">${total > 0 ? Object.keys(GRUPOS).map(k => `<span style="width:${porGrupo[k] / total * 100}%;background:${k === 'proveedores' ? '#FCD9A8' : k === 'fijos' ? '#7FD1C7' : '#E9C2DF'}"></span>`).join('') : ''}</div>
      <div class="leyenda">${Object.keys(GRUPOS).map(k => `<div><span class="punto" style="background:${k === 'proveedores' ? '#FCD9A8' : k === 'fijos' ? '#7FD1C7' : '#E9C2DF'}"></span>${GRUPOS[k]}<b>${eur(porGrupo[k])}</b></div>`).join('')}</div>
    </div>
    ${tarjetaCaja}
    ${porCat.length || sinCat.length ? `<div class="rejilla">${porCat.map(x => `
      <a class="cat-tarjeta g-${x.c.grupo}" href="#facturas/${encodeURIComponent(x.c.nombre)}" style="text-decoration:none;color:inherit">
        <div class="nombre">${esc(x.c.nombre)}</div><div class="importe">${eur(x.total)}</div><div class="tenue peque">${x.n} ${x.n === 1 ? 'factura' : 'facturas'}</div>
      </a>`).join('')}${sinCat.length ? `<a class="cat-tarjeta g-varios" href="#facturas/por_revisar" style="text-decoration:none;color:inherit"><div class="nombre">Sin categoría</div><div class="importe">${eur(sumar(sinCat))}</div><div class="tenue peque">${sinCat.length} por clasificar</div></a>` : ''}</div>` : ''}
    <div class="tarjeta">
      <div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Últimas facturas</h2><a href="#facturas" class="peque" style="font-weight:600;text-decoration:none">Ver todas</a></div>
      ${gastos().length ? `<ul class="lista">${ordenados(gastos()).slice(0, 6).map(filaGasto).join('')}</ul>` : '<p class="vacio-estado">Aún no hay facturas. Pulsa ＋ para añadir la primera.</p>'}
    </div>`;
}

// ---------- Añadir factura ----------

function pintarAnadir(r) {
  const adjuntando = r.a === 'adjuntar' ? r.b : '';
  $('#app').innerHTML = `
    <div class="cabecera"><button class="volver" data-a="atras" aria-label="Volver">‹</button>
      <div style="flex:1"><h1>${adjuntando ? 'Adjuntar recibo' : 'Añadir factura'}</h1></div></div>
    ${adjuntando ? '' : avisoCierre()}
    <label class="marco-camara" for="in-foto">
      <span class="hoja"></span><span class="esquina e1"></span><span class="esquina e2"></span><span class="esquina e3"></span><span class="esquina e4"></span>
      <span class="centro"><span class="disparador" style="display:block"></span><b>Hacer foto</b><br>
      <span class="consejos">Factura entera, plana y con buena luz. Sin sombras ni dedos encima.</span></span>
    </label>
    <div class="tres-botones" ${adjuntando ? 'style="grid-template-columns:1fr 1fr"' : ''}>
      <label class="boton-icono" for="in-pdf"><span class="ico">📄</span>Subir PDF</label>
      <label class="boton-icono" for="in-galeria"><span class="ico">🖼️</span>Galería</label>
      ${adjuntando ? '' : '<button class="boton-icono" data-a="aMano"><span class="ico">✍️</span>A mano</button>'}
    </div>
    <input type="file" id="in-foto" accept="image/*" capture="environment" data-origen="foto" data-adjuntar="${esc(adjuntando)}" hidden>
    <input type="file" id="in-galeria" accept="image/*" data-origen="galeria" data-adjuntar="${esc(adjuntando)}" hidden>
    <input type="file" id="in-pdf" accept="application/pdf,.pdf" data-origen="pdf" data-adjuntar="${esc(adjuntando)}" hidden>`;
}

function cargarImagen(file) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ko(new Error('No se puede abrir esa imagen. Prueba con otra foto.'));
    img.src = URL.createObjectURL(file);
  });
}

// Reduce la foto a unos 200 KB manteniendo la letra legible.
async function comprimir(file) {
  const img = await cargarImagen(file);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  let lado = 1800, calidad = 0.75, blob = null;
  for (let i = 0; i < 8; i++) {
    const k = Math.min(1, lado / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k);
    c.height = Math.round(h0 * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    blob = await new Promise(res => c.toBlob(res, 'image/jpeg', calidad));
    if (blob && blob.size <= 220 * 1024) break;
    if (calidad > 0.56) calidad -= 0.07;
    else lado = Math.round(lado * 0.85);
  }
  URL.revokeObjectURL(img.src);
  return blob;
}

function aBase64(blob) {
  return new Promise((ok, ko) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(',')[1]);
    lector.onerror = () => ko(new Error('No se pudo leer el archivo.'));
    lector.readAsDataURL(blob);
  });
}

async function procesarArchivo(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const origen = input.dataset.origen;
  const adjuntar = input.dataset.adjuntar;
  let blob = file, mime = file.type;
  if (mime === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    mime = 'application/pdf';
    if (file.size > 10 * 1024 * 1024) throw new Error('El PDF es demasiado grande (máximo 10 MB).');
  } else {
    cargando('Preparando la foto…');
    try { blob = await comprimir(file); } finally { cargando(false); }
    mime = 'image/jpeg';
  }
  const archivo = { base64: await aBase64(blob), mime, nombre: file.name };
  const previa = mime.startsWith('image/') ? URL.createObjectURL(blob) : null;

  if (adjuntar) {
    const r = await api('adjuntar', { id: adjuntar, archivo }, 'Subiendo el recibo…');
    reemplazarGasto(r.gasto);
    if (previa) E.vistaPrevia[r.gasto.id] = previa;
    if (E.form && E.form.id === r.gasto.id) {
      E.form.archivo_url = r.gasto.archivo_url;
      E.form.archivo_id = r.gasto.archivo_id;
      if (!E.form.num_factura) E.form.num_factura = r.gasto.num_factura;
    }
    avisar('Recibo adjuntado', 'ok');
    location.replace('#revisar/' + r.gasto.id);
    return;
  }
  const r = await api('subir', { archivo, origen }, 'Leyendo la factura… (tarda unos segundos)');
  E.datos.gastos.unshift(r.gasto);
  if (r.proveedor) reemplazarProveedor(r.proveedor);
  guardarDatos();
  if (previa) E.vistaPrevia[r.gasto.id] = previa;
  E.sugerencia[r.gasto.id] = Object.assign({}, r.sugerencia, { nuevo: !!r.proveedorNuevo, duplicado: r.duplicado || null });
  guardarLS('sugerencias', E.sugerencia);
  if (!r.leido) avisar('No se ha podido leer el texto. Rellena los datos a mano.', 'error');
  E.form = null;
  location.replace('#revisar/' + r.gasto.id);
}

// ---------- Revisar y asignar ----------

function nuevoForm(g) {
  const f = {
    id: g ? g.id : '',
    fecha: g ? g.fecha : hoyISO(),
    proveedor_id: g ? g.proveedor_id : '',
    categoria: g ? g.categoria : '',
    num_factura: g ? g.num_factura : '',
    base: g ? leerNum(g.base) : '',
    iva_pct: g && !vacio(g.iva_pct) ? Number(g.iva_pct) : '',
    iva_importe: g ? leerNum(g.iva_importe) : '',
    retencion: g ? (leerNum(g.retencion) || 0) : 0,
    total: g ? leerNum(g.total) : '',
    nota: g ? g.nota : '',
    estado: g ? g.estado : 'nuevo',
    origen: g ? g.origen : 'manual',
    archivo_url: g ? g.archivo_url : '',
    archivo_id: g ? g.archivo_id : '',
    recurrente_id: g ? g.recurrente_id : ''
  };
  f.sugerido = !!(g && g.estado === 'por_revisar' && g.proveedor_id && g.origen !== 'recurrente');
  f.verRetencion = Number(f.retencion) > 0;
  return f;
}

function pintarRevisar(r) {
  const id = r.a;
  if (id !== 'nuevo') {
    const g = gastos().find(x => x.id === id);
    if (!g) { $('#app').innerHTML = '<div class="vacio-estado"><p>Este gasto ya no existe.</p><a class="boton" href="#facturas">Ir a facturas</a></div>'; return; }
    if (!E.form || E.form.id !== id) E.form = nuevoForm(g);
  } else if (!E.form || E.form.id) {
    E.form = nuevoForm(null);
  }
  const f = E.form;
  const nuevo = !f.id;
  const titulo = nuevo ? 'Gasto a mano' : f.estado === 'por_revisar' ? 'Revisar factura' : 'Editar gasto';
  const prov = proveedor(f.proveedor_id);
  const sug = E.sugerencia[f.id] || {};

  const previa = E.vistaPrevia[f.id];
  const cajaArchivo = f.archivo_url || previa
    ? `<div class="tarjeta vista-previa">${previa ? `<img src="${previa}" alt="Factura">` : '<span class="doc">' + (f.origen === 'pdf' ? 'PDF' : 'FOTO') + '</span>'}
        <div style="flex:1"><b>${f.origen === 'correo' ? '✉️ Llegó por correo' : f.origen === 'pdf' ? 'PDF de la factura' : 'Foto de la factura'}</b><br>
        ${f.archivo_url ? `<a href="${esc(f.archivo_url)}" target="_blank" rel="noopener">Ver original</a>` : ''}</div></div>`
    : (!nuevo ? `<div class="tarjeta vista-previa"><span class="doc">—</span><div style="flex:1"><b>Sin recibo</b><br><a href="#anadir/adjuntar/${esc(f.id)}">Adjuntar recibo o factura</a></div></div>` : '');

  let cajaProv;
  if (prov) {
    const etiqueta = f.sugerido && sug.nuevo ? '<div class="sugerido">✓ Proveedor nuevo, añadido automáticamente</div>'
      : f.sugerido ? '<div class="sugerido">✓ Proveedor reconocido</div>' : '<div class="tenue peque">Proveedor</div>';
    cajaProv = `<div class="proveedor-caja"><div class="medio">${etiqueta}
      <div class="nombre">${esc(prov.nombre)}</div><div class="tenue peque">${esc(prov.nif || 'Sin NIF')}</div></div>
      <button class="chip" data-a="elegirProveedor">Cambiar</button></div>
      ${sug.nuevo ? '<button class="enlace" data-a="corregirProveedor">Corregir nombre o NIF</button>' : ''}`;
  } else if (sug.nombre || sug.nif) {
    cajaProv = `<div class="tenue peque">Proveedor nuevo encontrado en la factura</div>
      <div class="proveedor-caja"><div class="medio"><div class="nombre">${esc(sug.nombre || 'Sin nombre')}</div><div class="tenue peque">${esc(sug.nif || 'Sin NIF')}</div></div></div>
      <div class="dos" style="margin-top:10px"><button class="boton borde" data-a="elegirProveedor">Elegir otro</button><button class="boton" data-a="crearSugerido">Crear proveedor</button></div>`;
  } else {
    cajaProv = `<div class="proveedor-caja"><div class="medio"><div class="tenue peque">Proveedor</div><div class="nombre" style="color:var(--tinta-3)">Sin proveedor</div></div>
      <button class="chip" data-a="elegirProveedor">Elegir</button></div>`;
  }

  const chipsCat = Object.keys(GRUPOS).map(gr => `<div class="grupo-chips g-${gr}"><div class="tenue">${GRUPOS[gr]}</div><div class="chips envuelve">
    ${categorias().filter(c => c.grupo === gr).map(c => `<button class="chip ${f.categoria === c.nombre ? 'activo' : ''}" data-a="categoria" data-v="${esc(c.nombre)}">${esc(c.nombre)}</button>`).join('')}
    <button class="chip chip-nueva" data-a="nuevaCategoria" data-grupo="${gr}">＋ Nueva</button>
  </div></div>`).join('');

  const chipsIva = TIPOS_IVA.map(t => `<button class="chip ${f.iva_pct === t ? 'activo' : ''}" data-a="ivaPct" data-v="${t}">${t} %</button>`).join('') +
    `<button class="chip ${f.iva_pct === '' ? 'activo' : ''}" data-a="ivaPct" data-v="">Varios</button>`;

  const puedeRepetir = f.estado === 'por_revisar' && ['foto', 'galeria', 'pdf'].includes(f.origen);
  const delCorreo = f.estado === 'por_revisar' && f.origen === 'correo';
  const dup = sug.duplicado && gastos().find(x => x.id === sug.duplicado.id);
  const avisoDup = dup ? `<div class="descuadre"><b>Esta factura ya está apuntada</b>: ${esc(dup.proveedor_nombre || dup.categoria || '')} del ${fechaCorta(dup.fecha)} por ${eur(dup.total)}${dup.origen === 'correo' ? ' (llegó por correo)' : ''}.
      <div class="dos" style="margin-top:10px"><a class="boton secundario" href="#revisar/${esc(dup.id)}" style="min-height:44px;font-size:15px">Ver la otra</a>
      <button class="boton peligro" data-a="descartarCopia" style="min-height:44px;font-size:15px">Descartar esta</button></div></div>` : '';

  $('#app').innerHTML = `
    <div class="cabecera"><button class="volver" data-a="atras" aria-label="Volver">‹</button>
      <div style="flex:1"><p class="sub">${f.estado === 'por_revisar' ? 'Comprueba los datos y guarda' : nuevo ? 'Gasto sin factura escaneada' : 'Gasto confirmado'}</p><h1>${titulo}</h1></div></div>
    ${avisoDup}
    ${cajaArchivo}
    <div class="tarjeta">${cajaProv}</div>
    <div class="tarjeta"><h2>Categoría</h2>${chipsCat}</div>
    <div class="tarjeta">
      <div class="dos">
        <label class="campo"><span>Fecha</span><input class="entrada" type="date" data-campo="fecha" value="${esc(f.fecha)}"></label>
        <label class="campo"><span>Nº factura</span><input class="entrada" data-campo="num_factura" value="${esc(f.num_factura)}" autocapitalize="characters"></label>
      </div>
      <label class="campo"><span>Total</span><input class="entrada importe" style="font-size:24px" inputmode="decimal" data-campo="total" value="${numCampo(f.total)}" placeholder="0,00"></label>
      <div class="campo"><span class="tenue peque" style="font-weight:600">Tipo de IVA</span><div class="chips envuelve" style="margin-top:6px">${chipsIva}</div></div>
      <div class="dos">
        <label class="campo"><span>Base</span><input class="entrada importe" inputmode="decimal" data-campo="base" value="${numCampo(f.base)}" placeholder="0,00"></label>
        <label class="campo"><span>IVA</span><input class="entrada importe" inputmode="decimal" data-campo="iva_importe" value="${numCampo(f.iva_importe)}" placeholder="0,00"></label>
      </div>
      ${f.verRetencion
        ? `<label class="campo"><span>Retención IRPF (se resta)</span><input class="entrada importe" inputmode="decimal" data-campo="retencion" value="${numCampo(f.retencion)}" placeholder="0,00"></label>`
        : '<button class="enlace" data-a="verRetencion">＋ Lleva retención de IRPF</button>'}
      ${desgloseFactura(f.id)}
      <div id="descuadre"></div>
    </div>
    <div class="tarjeta"><label class="campo" style="margin:0"><span>Nota (opcional)</span><textarea class="entrada" data-campo="nota" placeholder="Ej.: arreglo de la cámara frigorífica">${esc(f.nota)}</textarea></label></div>
    <div class="botones">
      ${puedeRepetir ? '<button class="boton secundario" data-a="repetirFoto">Repetir foto</button>'
        : delCorreo ? '<button class="boton secundario" data-a="descartarCopia">No es factura</button>'
        : '<button class="boton secundario" data-a="atras">Cancelar</button>'}
      <button class="boton" data-a="guardarGasto">Guardar gasto</button>
    </div>
    ${f.estado === 'por_revisar' ? '<button class="enlace" data-a="dejarPendiente" style="display:block;margin:10px auto 0">Dejar por revisar</button>' : ''}
    ${!nuevo && esDueno() && !puedeRepetir ? '<button class="enlace" data-a="anular" style="display:block;margin:6px auto 0;color:var(--rojo)">Anular gasto</button>' : ''}`;
  comprobarCuadre();
}

// Desglose por tipo de IVA tal como viene en la factura (solo lectura).
function desgloseFactura(id) {
  const g = id && gastos().find(x => x.id === id);
  if (!g) return '';
  const filas = [4, 10, 21].filter(t => !vacio(g['base_' + t]) || !vacio(g['iva_' + t]));
  if (!filas.length) return '';
  return `<div class="tarjeta" style="background:var(--crema);box-shadow:none;border:1px solid var(--linea);padding:12px;margin:0 0 12px">
    <div class="tenue peque" style="font-weight:600;margin-bottom:6px">Según la factura</div>
    <div class="resumen-iva" style="grid-template-columns:auto 1fr 1fr;font-size:14px">
      <span class="tenue">Tipo</span><b class="tenue">Base</b><b class="tenue">IVA</b>
      ${filas.map(t => `<span>${t} %</span><b>${eur(g['base_' + t])}</b><b>${eur(g['iva_' + t])}</b>`).join('')}
    </div></div>`;
}

function campoForm(el) {
  const f = E.form;
  if (!f) return;
  const c = el.dataset.campo;
  if (['base', 'iva_importe', 'retencion', 'total'].includes(c)) {
    f[c] = leerNum(el.value);
    if (c === 'retencion' && f[c] === '') f[c] = 0;
    recalcular(c);
  } else {
    f[c] = el.value;
  }
}

// Al cambiar un importe se recalculan los demás (base + IVA − retención = total).
function recalcular(campo) {
  const f = E.form;
  const ret = Number(f.retencion) || 0;
  const pct = f.iva_pct;
  if (campo === 'base' || campo === 'ivaPct' || campo === 'retencion') {
    if (!vacio(f.base) && pct !== '') {
      f.iva_importe = r2(f.base * pct / 100);
      f.total = r2(f.base + f.iva_importe - ret);
    } else if (!vacio(f.base) && !vacio(f.iva_importe)) {
      f.total = r2(f.base + f.iva_importe - ret);
    } else if (campo !== 'base' && !vacio(f.total) && pct !== '') {
      recalcular('total');
      return;
    }
  } else if (campo === 'total') {
    if (!vacio(f.total) && pct !== '') {
      f.base = r2((f.total + ret) / (1 + pct / 100));
      f.iva_importe = r2(f.total + ret - f.base);
    }
  } else if (campo === 'iva_importe') {
    if (!vacio(f.base) && !vacio(f.iva_importe)) f.total = r2(f.base + f.iva_importe - ret);
  }
  ['base', 'iva_importe', 'total'].forEach(k => {
    const el = $(`[data-campo="${k}"]`);
    if (el && k !== campo && document.activeElement !== el) el.value = numCampo(f[k]);
  });
  comprobarCuadre();
}

function comprobarCuadre() {
  const f = E.form, caja = $('#descuadre');
  if (!f || !caja) return;
  const ret = Number(f.retencion) || 0;
  const malo = !vacio(f.base) && !vacio(f.iva_importe) && !vacio(f.total) && Math.abs(f.base + f.iva_importe - ret - f.total) > 0.02;
  caja.innerHTML = malo ? `<div class="descuadre">No cuadra: base + IVA${ret ? ' − retención' : ''} = ${eur(f.base + f.iva_importe - ret)}, pero el total es ${eur(f.total)}.</div>` : '';
}

async function guardarForm(estado) {
  const f = E.form;
  if (!f.fecha) throw new Error('Falta la fecha.');
  if (!f.categoria) throw new Error('Elige una categoría.');
  if (vacio(f.total)) throw new Error('Falta el total.');
  const datos = Object.assign({}, f, { estado });
  delete datos.sugerido;
  delete datos.verRetencion;
  const r = await api('guardarGasto', { gasto: datos }, 'Guardando…');
  if (r.proveedor) reemplazarProveedor(r.proveedor);
  reemplazarGasto(r.gasto);
  delete E.sugerencia[r.gasto.id];
  guardarLS('sugerencias', E.sugerencia);
  E.form = null;
  const quedan = gastos().filter(g => g.estado === 'por_revisar').length;
  avisar(estado === 'confirmado' ? (quedan ? `Gasto guardado ✓ · Quedan ${quedan} por revisar` : 'Gasto guardado ✓') : 'Se queda por revisar', 'ok');
  location.hash = E.anterior && E.anterior !== 'revisar' ? E.anterior : 'inicio';
}

// ---------- Cierre de caja ----------

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function fechaLarga(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return DIAS[new Date(a, m - 1, d).getDay()] + ' ' + d + ' de ' + MESES[m - 1];
}
const mayuscula = s => s ? s[0].toUpperCase() + s.slice(1) : s;
function sumarDias(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(a, m - 1, d + n);
  return f.getFullYear() + '-' + pad(f.getMonth() + 1) + '-' + pad(f.getDate());
}
// Si se cierra de madrugada, el cierre es del día anterior.
const fechaCierrePorDefecto = () => new Date().getHours() < 6 ? sumarDias(hoyISO(), -1) : hoyISO();
const cierreDe = fecha => cierres().find(c => c.fecha === fecha);
const sumarCaja = (lista, k = 'total') => r2(lista.reduce((s, c) => s + (Number(c[k]) || 0), 0));

function nuevoCierreForm(c) {
  return {
    id: c ? c.id : '',
    fecha: c ? c.fecha : fechaCierrePorDefecto(),
    efectivo: c ? leerNum(c.efectivo) : '',
    tarjeta: c ? leerNum(c.tarjeta) : '',
    nota: c ? c.nota : '',
    archivo_id: c ? c.archivo_id : '',
    archivo_url: c ? c.archivo_url : '',
    ocr_texto: ''
  };
}

function pintarCierre(r) {
  const id = r.a;
  if (id !== 'nuevo') {
    const c = cierres().find(x => x.id === id);
    if (!c) { $('#app').innerHTML = '<div class="vacio-estado"><p>Este cierre ya no existe.</p><a class="boton" href="#inicio">Ir al inicio</a></div>'; return; }
    if (!E.cierre || E.cierre.id !== id) E.cierre = nuevoCierreForm(c);
  } else if (!E.cierre || E.cierre.id) {
    E.cierre = nuevoCierreForm(null);
  }
  const f = E.cierre;
  const previa = E.vistaPrevia['cierre:' + (f.archivo_id || '')];
  const repetido = !f.id && cierreDe(f.fecha);
  const total = r2((Number(f.efectivo) || 0) + (Number(f.tarjeta) || 0));

  const foto = previa || f.archivo_url
    ? `<div class="tarjeta vista-previa">${previa ? `<img src="${previa}" alt="Sobre del cierre">` : '<span class="doc">FOTO</span>'}
        <div style="flex:1"><b>Foto del cierre</b><br>${f.archivo_url ? `<a href="${esc(f.archivo_url)}" target="_blank" rel="noopener">Ver foto</a> · ` : ''}<label for="in-cierre-galeria" class="enlace" style="padding:0">Cambiar</label></div></div>`
    : `<label class="tarjeta" for="in-cierre-foto" style="display:flex;align-items:center;gap:14px;cursor:pointer;border:2px dashed var(--linea);box-shadow:none">
        <span class="disparador" style="width:52px;height:52px;margin:0;border-width:4px;flex:none"></span>
        <span style="flex:1"><b>Hacer foto del sobre</b><br><span class="tenue peque">Se guarda como comprobante. Si lleva el ticket impreso, se leen los importes.</span></span></label>
      <label for="in-cierre-galeria" class="enlace" style="display:block;margin:-6px 0 12px">o elegir de la galería</label>`;

  $('#app').innerHTML = `
    <div class="cabecera"><button class="volver" data-a="atrasCierre" aria-label="Volver">‹</button>
      <div style="flex:1"><p class="sub">${esc(mayuscula(fechaLarga(f.fecha)))}</p><h1>Cierre de caja</h1></div></div>
    ${foto}
    <input type="file" id="in-cierre-foto" accept="image/*" capture="environment" data-cierre="1" hidden>
    <input type="file" id="in-cierre-galeria" accept="image/*,application/pdf" data-cierre="1" hidden>
    <div class="tarjeta">
      <label class="campo"><span>Día del cierre</span><input class="entrada" type="date" data-cc="fecha" value="${esc(f.fecha)}" max="${hoyISO()}"></label>
      ${repetido ? `<div class="descuadre">Ya hay un cierre del ${esc(fechaLarga(f.fecha))}. <a href="#cierre/${esc(repetido.id)}">Abrirlo para corregirlo</a></div>` : ''}
      <div class="dos">
        <label class="campo"><span>💶 Efectivo</span><input class="entrada importe" inputmode="decimal" data-cc="efectivo" value="${numCampo(f.efectivo)}" placeholder="0,00"></label>
        <label class="campo"><span>💳 Datáfono</span><input class="entrada importe" inputmode="decimal" data-cc="tarjeta" value="${numCampo(f.tarjeta)}" placeholder="0,00"></label>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid var(--linea);padding-top:12px">
        <b>Total del día</b><span class="num-grande" style="font-size:30px" id="total-cierre">${eur(total)}</span></div>
    </div>
    <div class="tarjeta"><label class="campo" style="margin:0"><span>Nota (opcional)</span><textarea class="entrada" data-cc="nota" placeholder="Ej.: faltan 5 € de cambio">${esc(f.nota)}</textarea></label></div>
    <div class="botones"><button class="boton secundario" data-a="atrasCierre">Cancelar</button><button class="boton" data-a="guardarCierre" ${repetido ? 'disabled' : ''}>Guardar cierre</button></div>
    ${f.id && esDueno() ? '<button class="enlace" data-a="borrarCierre" style="display:block;margin:10px auto 0;color:var(--rojo)">Borrar este cierre</button>' : ''}`;
}

function campoCierre(el) {
  const f = E.cierre;
  if (!f) return;
  const c = el.dataset.cc;
  if (c === 'efectivo' || c === 'tarjeta') {
    f[c] = leerNum(el.value);
    const t = $('#total-cierre');
    if (t) t.textContent = eur((Number(f.efectivo) || 0) + (Number(f.tarjeta) || 0));
  } else {
    f[c] = el.value;
    if (c === 'fecha' && el.value) pintar();
  }
}

async function procesarFotoCierre(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const f = E.cierre;
  let blob = file, mime = file.type;
  if (mime === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    mime = 'application/pdf';
  } else {
    cargando('Preparando la foto…');
    try { blob = await comprimir(file); } finally { cargando(false); }
    mime = 'image/jpeg';
  }
  const r = await api('subirCierre', { archivo: { base64: await aBase64(blob), mime }, fecha: f.fecha }, 'Guardando la foto y leyendo los importes…');
  f.archivo_id = r.archivo_id;
  f.archivo_url = r.archivo_url;
  f.ocr_texto = r.ocr_texto || '';
  if (mime.startsWith('image/')) E.vistaPrevia['cierre:' + r.archivo_id] = URL.createObjectURL(blob);
  const l = r.lectura || {};
  let leidos = 0;
  if (vacio(f.efectivo) && !vacio(l.efectivo)) { f.efectivo = l.efectivo; leidos++; }
  if (vacio(f.tarjeta) && !vacio(l.tarjeta)) { f.tarjeta = l.tarjeta; leidos++; }
  if (!f.id && l.fecha && l.fecha <= hoyISO() && l.fecha >= sumarDias(hoyISO(), -7)) f.fecha = l.fecha;
  avisar(leidos ? 'He leído los importes del ticket. Compruébalos antes de guardar.' : 'Foto guardada. Escribe el efectivo y el datáfono.', leidos ? 'ok' : '');
  pintar();
}

// ---------- Selector y formulario de proveedor (hoja inferior) ----------

const H = { pintar: null, estado: null };

function abrirHoja(pintarFn, estado) {
  H.pintar = pintarFn;
  H.estado = estado || {};
  repintarHoja();
}
function repintarHoja() {
  let fondo = $('#hoja');
  if (!fondo) {
    fondo = document.createElement('div');
    fondo.id = 'hoja';
    fondo.className = 'fondo-hoja';
    fondo.addEventListener('click', e => { if (e.target === fondo) cerrarHoja(); });
    document.body.appendChild(fondo);
  }
  fondo.innerHTML = `<div class="hoja-abajo" role="dialog"><div class="asa"></div>${H.pintar(H.estado)}</div>`;
}
function cerrarHoja() {
  const h = $('#hoja');
  if (h) h.remove();
  if (H.alCerrar) { const fn = H.alCerrar; H.alCerrar = null; fn(); }
}

function confirmar(mensaje, boton, peligro) {
  return new Promise(ok => {
    H.alCerrar = () => ok(false);
    abrirHoja(() => `<h2>${esc(mensaje)}</h2>
      <div class="dos" style="margin-top:18px"><button class="boton secundario" data-a="cerrarHoja">Cancelar</button>
      <button class="boton ${peligro ? 'peligro' : ''}" data-a="confirmarSi">${esc(boton)}</button></div>`);
    ACCIONES.confirmarSi = () => { H.alCerrar = null; cerrarHoja(); ok(true); };
  });
}

function hojaSelectorProveedor(s) {
  return `<h2>Elegir proveedor</h2>
    <div class="buscador"><input class="entrada" data-h="q" placeholder="Buscar por nombre o NIF" value="${esc(s.q || '')}" autocomplete="off"></div>
    <button class="boton borde" data-a="nuevoProveedorDesdeSelector" style="margin-bottom:10px">＋ Nuevo proveedor</button>
    <ul class="lista" id="hoja-lista">${listaSelector(s.q)}</ul>
    <button class="enlace" data-a="sinProveedor">Sin proveedor (gasto suelto)</button>`;
}
function listaSelector(q) {
  const t = normal(q);
  const lista = ((E.datos && E.datos.proveedores) || [])
    .filter(p => p.activo && (!t || normal(p.nombre).includes(t) || normal(p.nif).includes(t)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (!lista.length) return '<li class="vacio-estado">No hay proveedores con ese nombre.</li>';
  return lista.map(p => `<li><button class="fila g-${grupoDe(p.categoria_habitual)}" data-a="usarProveedor" data-id="${esc(p.id)}">
    <span class="icono">${esc(p.nombre[0].toUpperCase())}</span>
    <span class="medio"><span class="titulo" style="display:block">${esc(p.nombre)}</span><span class="detalle" style="display:block">${esc([p.nif, p.categoria_habitual].filter(Boolean).join(' · '))}</span></span></button></li>`).join('');
}

function hojaFormProveedor(s) {
  const chips = Object.keys(GRUPOS).map(gr => `<div class="grupo-chips g-${gr}"><div class="tenue">${GRUPOS[gr]}</div><div class="chips envuelve">
    ${categorias().filter(c => c.grupo === gr).map(c => `<button class="chip ${s.categoria_habitual === c.nombre ? 'activo' : ''}" data-a="hojaCategoria" data-v="${esc(c.nombre)}">${esc(c.nombre)}</button>`).join('')}
    <button class="chip chip-nueva" data-a="nuevaCategoriaProveedor" data-grupo="${gr}">＋ Nueva</button>
  </div></div>`).join('');
  return `<h2>${s.id ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
    <label class="campo"><span>Nombre</span><input class="entrada" data-h="nombre" value="${esc(s.nombre || '')}"></label>
    <label class="campo"><span>NIF / CIF</span><input class="entrada" data-h="nif" value="${esc(s.nif || '')}" autocapitalize="characters"></label>
    <div class="campo"><span>Categoría habitual</span>${chips}</div>
    ${s.id && esDueno() ? `<label class="interruptor">Activo<input type="checkbox" data-h="activo" ${s.activo !== false ? 'checked' : ''}></label>` : ''}
    <div class="dos"><button class="boton secundario" data-a="${s.volverSelector ? 'volverSelector' : 'cerrarHoja'}">Cancelar</button><button class="boton" data-a="guardarProveedor">Guardar</button></div>`;
}

// Hoja para crear una categoría. "volver" es la hoja que estaba abierta (p. ej. el alta de proveedor).
function hojaNuevaCategoria(s) {
  return `<h2>Nueva categoría</h2>
    <label class="campo"><span>Nombre</span><input class="entrada" data-h="nombre" value="${esc(s.nombre || '')}" placeholder="Ej.: Bebidas, Pan, Hielo…" maxlength="30"></label>
    <div class="campo"><span>¿En qué grupo va?</span><div class="chips envuelve">
      ${Object.keys(GRUPOS).map(gr => `<button class="chip g-${gr} ${s.grupo === gr ? 'activo' : ''}" data-a="grupoCategoria" data-v="${gr}">${GRUPOS[gr]}</button>`).join('')}
    </div>
    <p class="tenue peque" style="margin:8px 0 0">Proveedores: compras de género. Gastos fijos: alquiler, luz, agua… Varios: todo lo demás.</p></div>
    <div class="dos"><button class="boton secundario" data-a="cancelarCategoria">Cancelar</button><button class="boton" data-a="guardarCategoria">Crear</button></div>`;
}

function abrirNuevaCategoria(grupo, volver) {
  abrirHoja(hojaNuevaCategoria, { grupo, volver });
  setTimeout(() => { const i = $('#hoja [data-h="nombre"]'); if (i) i.focus(); }, 50);
}

function usarProveedorEnForm(p) {
  E.form.proveedor_id = p ? p.id : '';
  E.form.sugerido = false;
  if (p && p.categoria_habitual) E.form.categoria = p.categoria_habitual;
  cerrarHoja();
  pintar();
}

// ---------- Facturas ----------

function pintarFacturas(r) {
  if (r.a) { E.filtro = r.a; }
  const pendientes = gastos().filter(g => g.estado === 'por_revisar').length;
  const presentes = categorias().filter(c => gastos().some(g => g.categoria === c.nombre));
  const chip = (v, texto, grupo) => `<button class="chip ${grupo ? 'g-' + grupo : ''} ${E.filtro === v ? 'activo' : ''}" data-a="filtro" data-v="${esc(v)}">${esc(texto)}</button>`;
  $('#app').innerHTML = `
    <div class="cabecera"><div><p class="sub">${gastos().length} ${gastos().length === 1 ? 'gasto' : 'gastos'}</p><h1>Facturas</h1></div>
      <a class="chip" href="#revisar/nuevo" style="text-decoration:none">＋ A mano</a></div>
    <div class="buscador"><input class="entrada" id="buscar-facturas" type="search" placeholder="Buscar proveedor, nº, nota o importe" value="${esc(E.busqueda)}" autocomplete="off"></div>
    <div class="chips">${chip('todas', 'Todas')}${chip('por_revisar', 'Por revisar' + (pendientes ? ` (${pendientes})` : ''))}${presentes.map(c => chip(c.nombre, c.nombre, c.grupo)).join('')}</div>
    <div id="lista-facturas"></div>`;
  pintarListaFacturas();
}

function pintarListaFacturas() {
  const caja = $('#lista-facturas');
  if (!caja) return;
  const t = normal(E.busqueda.trim());
  let lista = gastos();
  if (E.filtro === 'por_revisar') lista = lista.filter(g => g.estado === 'por_revisar');
  else if (E.filtro !== 'todas') lista = lista.filter(g => g.categoria === E.filtro);
  if (t) {
    lista = lista.filter(g => normal([g.proveedor_nombre, g.nota, g.num_factura, g.categoria, num(g.total), g.nif].join(' ')).includes(t));
  }
  lista = ordenados(lista);
  if (!lista.length) { caja.innerHTML = '<p class="vacio-estado">No hay facturas que coincidan.</p>'; return; }
  const meses = {};
  lista.forEach(g => { const k = (g.fecha || '').slice(0, 7); (meses[k] = meses[k] || []).push(g); });
  caja.innerHTML = Object.keys(meses).map(k => `
    <div class="mes-cabecera"><h3>${k ? nombreMes(k) + ' ' + k.slice(0, 4) : 'Sin fecha'}</h3><span class="tenue">${eur(sumar(meses[k]))}</span></div>
    <div class="tarjeta" style="padding:4px 14px"><ul class="lista">${meses[k].map(filaGasto).join('')}</ul></div>`).join('');
}

// ---------- Informes ----------

function periodoActual() {
  const d = new Date();
  return { tipo: 'mes', a: d.getFullYear(), n: d.getMonth() + 1 };
}
function rango(p) {
  if (p.tipo === 'mes') {
    const fin = new Date(p.a, p.n, 0).getDate();
    return { desde: `${p.a}-${pad(p.n)}-01`, hasta: `${p.a}-${pad(p.n)}-${pad(fin)}`, nombre: `${MESES[p.n - 1]} ${p.a}`, corto: MESES[p.n - 1] };
  }
  if (p.tipo === 'trimestre') {
    const m1 = (p.n - 1) * 3 + 1, m3 = m1 + 2;
    return { desde: `${p.a}-${pad(m1)}-01`, hasta: `${p.a}-${pad(m3)}-${pad(new Date(p.a, m3, 0).getDate())}`,
      nombre: `${p.n}º trimestre ${p.a}`, corto: `el ${p.n - 1 || 4}º trimestre`, detalle: `${MESES_CORTOS[m1 - 1]} – ${MESES_CORTOS[m3 - 1]}` };
  }
  return { desde: `${p.a}-01-01`, hasta: `${p.a}-12-31`, nombre: String(p.a), corto: String(p.a - 1) };
}
function moverPeriodo(p, paso) {
  const q = Object.assign({}, p);
  if (q.tipo === 'año') { q.a += paso; return q; }
  const max = q.tipo === 'mes' ? 12 : 4;
  q.n += paso;
  if (q.n < 1) { q.n = max; q.a--; }
  if (q.n > max) { q.n = 1; q.a++; }
  return q;
}
const enRango = (g, r) => g.fecha >= r.desde && g.fecha <= r.hasta;

function pintarInformes() {
  if (!E.periodo) E.periodo = periodoActual();
  const p = E.periodo, r = rango(p);
  const ant = rango(moverPeriodo(p, -1));
  const lista = gastos().filter(g => enRango(g, r));
  const total = sumar(lista), totalAnt = sumar(gastos().filter(g => enRango(g, ant)));
  const hayFuturo = moverPeriodo(p, 1);
  const futuroBloqueado = rango(hayFuturo).desde > hoyISO();
  const caja = E.vistaInforme === 'caja';
  const arriba = `
    <div class="cabecera"><div><p class="sub">Informes</p><h1>${caja ? '¿Cuánto hemos ganado?' : '¿Cuánto hemos gastado?'}</h1></div></div>
    <div class="segmentos" style="grid-template-columns:1fr 1fr">
      <button class="${caja ? '' : 'activo'}" data-a="vistaInforme" data-v="gastos">Gastos</button>
      <button class="${caja ? 'activo' : ''}" data-a="vistaInforme" data-v="caja">Caja y resultados</button></div>
    <div class="segmentos">${['mes', 'trimestre', 'año'].map(t => `<button class="${p.tipo === t ? 'activo' : ''}" data-a="tipoPeriodo" data-v="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
    <div class="navegador"><button data-a="periodo" data-v="-1" aria-label="Anterior">‹</button>
      <div style="text-align:center"><b>${esc(r.nombre)}</b>${r.detalle ? `<div class="tenue peque">${r.detalle}</div>` : ''}</div>
      <button data-a="periodo" data-v="1" aria-label="Siguiente" ${futuroBloqueado ? 'disabled' : ''}>›</button></div>`;
  if (caja) { $('#app').innerHTML = arriba + informeCaja(p, r, ant, lista); return; }

  let comparacion = '';
  if (totalAnt > 0) {
    const dif = (total - totalAnt) / totalAnt * 100;
    const nombreAnt = p.tipo === 'mes' ? ant.corto : p.tipo === 'trimestre' ? `el trimestre anterior` : ant.corto;
    comparacion = `<span class="${dif > 0 ? 'dif-sube' : 'dif-baja'}">${dif > 0 ? '▲' : '▼'} ${Math.abs(dif).toFixed(0)} % ${dif > 0 ? 'más' : 'menos'} que ${esc(nombreAnt)}</span> · ${eur(totalAnt)}`;
  } else {
    comparacion = 'Sin gastos en el periodo anterior';
  }

  const porCat = categorias().map(c => {
    const l = lista.filter(g => g.categoria === c.nombre);
    return { c, total: sumar(l), n: l.length };
  }).filter(x => x.n).sort((a, b) => b.total - a.total);
  const sinCat = lista.filter(g => !g.categoria);
  if (sinCat.length) porCat.push({ c: { nombre: 'Sin categoría', grupo: 'varios' }, total: sumar(sinCat), n: sinCat.length });
  const max = Math.max(1, ...porCat.map(x => x.total));
  const porGrupo = Object.keys(GRUPOS).map(k => ({ k, total: sumar(lista.filter(g => grupoDe(g.categoria) === k)) }));

  const base = r2(lista.reduce((s, g) => s + (Number(g.base) || 0), 0));
  const iva = r2(lista.reduce((s, g) => s + (Number(g.iva_importe) || 0), 0));
  const ret = r2(lista.reduce((s, g) => s + (Number(g.retencion) || 0), 0));
  const pendientes = lista.filter(g => g.estado === 'por_revisar').length;
  const sinBase = lista.filter(g => vacio(g.base) || g.base === 0).length;

  $('#app').innerHTML = arriba + `
    <div class="tarjeta ambar">
      <p class="sub" style="margin:0">Total del periodo</p>
      <div class="num-grande">${eur(total)}</div>
      <p class="peque" style="margin:0">${comparacion}</p>
    </div>
    <div class="tarjeta">
      <h2>Por grupo</h2>
      <div class="leyenda" style="grid-template-columns:repeat(3,1fr)">${porGrupo.map(x => `<div><span class="punto" style="background:${COLOR_GRUPO[x.k]}"></span>${GRUPOS[x.k]}<b>${eur(x.total)}</b></div>`).join('')}</div>
    </div>
    <div class="tarjeta">
      <h2>Por categoría</h2>
      ${porCat.length ? porCat.map(x => `<div class="barra-cat g-${x.c.grupo}"><div class="cab"><span>${esc(x.c.nombre)} <span class="tenue">· ${x.n}</span></span><b>${eur(x.total)}</b></div>
        <div class="pista"><div class="relleno" style="width:${(x.total / max * 100).toFixed(1)}%"></div></div></div>`).join('') : '<p class="vacio-estado">No hay gastos en este periodo.</p>'}
    </div>
    <div class="tarjeta">
      <h2>Para la gestoría</h2>
      <div class="resumen-iva">
        <span>Base imponible</span><b>${eur(base)}</b>
        <span>IVA soportado</span><b>${eur(iva)}</b>
        ${ret ? `<span>Retenciones IRPF</span><b>${eur(ret)}</b>` : ''}
        <span style="font-weight:700">Total</span><b>${eur(total)}</b>
        <span class="tenue">Nº de gastos</span><b class="tenue">${lista.length}</b>
      </div>
      ${pendientes ? `<p class="descuadre" style="margin:12px 0 0">Hay ${pendientes} ${pendientes === 1 ? 'gasto' : 'gastos'} por revisar en este periodo. <a href="#facturas/por_revisar">Revisar</a></p>` : ''}
      ${sinBase ? `<p class="tenue peque" style="margin:10px 0 0">${sinBase} ${sinBase === 1 ? 'gasto no tiene' : 'gastos no tienen'} base/IVA separados.</p>` : ''}
    </div>
    <button class="boton verde" data-a="abrirGestoria" ${lista.length ? '' : 'disabled'}>✉️ Enviar a la gestoría</button>
    <div class="dos" style="margin-top:10px">
      <button class="boton secundario" data-a="exportar" data-v="xlsx" ${lista.length ? '' : 'disabled'}>Descargar Excel</button>
      <button class="boton secundario" data-a="exportar" data-v="csv" ${lista.length ? '' : 'disabled'}>Descargar CSV</button>
    </div>`;
}

// Pestaña "Caja y resultados": ingresos de los cierres frente a los gastos del mismo periodo.
function informeCaja(p, r, ant, gastosPeriodo) {
  const lista = cierres().filter(c => enRango(c, r));
  const ingresos = sumarCaja(lista), efectivo = sumarCaja(lista, 'efectivo'), tarjeta = sumarCaja(lista, 'tarjeta');
  const gastosTot = sumar(gastosPeriodo);
  const compras = sumar(gastosPeriodo.filter(g => grupoDe(g.categoria) === 'proveedores'));
  const resultado = r2(ingresos - gastosTot);
  const resultadoAnt = r2(sumarCaja(cierres().filter(c => enRango(c, ant))) - sumar(gastosLista(ant)));
  const pct = (a, b) => b > 0 ? Math.round(a / b * 100) : 0;

  // Días sin cierre (del periodo, hasta ayer)
  // (se cuenta desde el primer cierre apuntado, para no avisar de días anteriores a usar la app)
  const hasta = r.hasta < hoyISO() ? r.hasta : sumarDias(hoyISO(), -1);
  const primero = cierres().map(c => c.fecha).sort()[0];
  const faltan = [];
  if (primero) {
    for (let d = r.desde > primero ? r.desde : primero; d <= hasta; d = sumarDias(d, 1)) if (!cierreDe(d)) faltan.push(d);
  }

  const barra = (texto, valor, total, color) => `<div class="barra-cat"><div class="cab"><span>${texto}</span><b>${pct(valor, total)} %</b></div>
    <div class="pista"><div class="relleno" style="width:${Math.min(100, pct(valor, total))}%;background:${color}"></div></div></div>`;

  // Detalle: por día en un mes; por mes en trimestre y año.
  let detalle;
  if (p.tipo === 'mes') {
    detalle = lista.length ? `<ul class="lista">${lista.slice().sort((a, b) => b.fecha.localeCompare(a.fecha)).map(c => `<li><a class="fila g-fijos" href="#cierre/${esc(c.id)}" style="text-decoration:none;color:inherit">
      <span class="icono">${Number(c.fecha.slice(8))}</span>
      <span class="medio"><span class="titulo" style="display:block">${esc(mayuscula(fechaLarga(c.fecha)))}</span><span class="detalle" style="display:block">💶 ${eur(c.efectivo)} · 💳 ${eur(c.tarjeta)}${c.archivo_id ? '' : ' · sin foto'}</span></span>
      <span class="derecha importe">${eur(c.total)}</span></a></li>`).join('')}</ul>` : '<p class="vacio-estado">No hay cierres apuntados en este mes.</p>';
  } else {
    const meses = [];
    for (let d = r.desde; d <= r.hasta; d = sumarDias(d.slice(0, 7) + '-28', 7).slice(0, 7) + '-01') meses.push(d.slice(0, 7));
    detalle = `<div class="resumen-iva" style="grid-template-columns:1fr auto auto auto;gap:8px 12px">
      <span class="tenue peque">Mes</span><b class="tenue peque">Ingresos</b><b class="tenue peque">Gastos</b><b class="tenue peque">Resultado</b>
      ${meses.map(m => {
        const i = sumarCaja(cierres().filter(c => c.fecha.startsWith(m)));
        const g = sumar(gastos().filter(x => (x.fecha || '').startsWith(m)));
        return `<span style="text-transform:capitalize">${nombreMes(m)}</span><b>${eur(i)}</b><b>${eur(g)}</b><b style="color:${i - g >= 0 ? 'var(--ok)' : 'var(--rojo)'}">${eur(i - g)}</b>`;
      }).join('')}</div>`;
  }

  // Solo se compara con el periodo anterior cuando este ya ha terminado (un mes a medias engañaría).
  let comparacion = '';
  if (resultadoAnt !== 0 && r.hasta < hoyISO()) {
    const dif = r2(resultado - resultadoAnt);
    comparacion = `${dif >= 0 ? '▲' : '▼'} ${eur(Math.abs(dif))} ${dif >= 0 ? 'más' : 'menos'} que el periodo anterior`;
  }

  return `
    <div class="tarjeta" style="background:${resultado >= 0 ? 'var(--verde)' : 'var(--rojo)'};color:#fff">
      <p style="margin:0;color:rgba(255,255,255,.8)">Resultado del periodo</p>
      <div class="num-grande">${eur(resultado)}</div>
      <p class="peque" style="margin:0;color:rgba(255,255,255,.85)">Ingresos ${eur(ingresos)} − Gastos ${eur(gastosTot)}${comparacion ? '<br>' + comparacion : ''}</p>
    </div>
    ${faltan.length ? `<p class="descuadre">${faltan.length === 1 ? 'Falta el cierre del ' + fechaCorta(faltan[0]) : `Faltan ${faltan.length} cierres en este periodo`} (si ese día estuvo cerrado, no pasa nada).</p>` : ''}
    <div class="tarjeta">
      <h2>Ingresos</h2>
      <div class="resumen-iva">
        <span>💶 Efectivo</span><b>${eur(efectivo)}</b>
        <span>💳 Datáfono</span><b>${eur(tarjeta)}</b>
        <span style="font-weight:700">Total</span><b>${eur(ingresos)}</b>
        <span class="tenue">Días con cierre</span><b class="tenue">${lista.length}</b>
        <span class="tenue">Media por día</span><b class="tenue">${eur(lista.length ? ingresos / lista.length : 0)}</b>
      </div>
    </div>
    <div class="tarjeta">
      <h2>¿Qué parte de los ingresos se va en…?</h2>
      ${ingresos > 0 ? barra('Compras de género (proveedores)', compras, ingresos, COLOR_GRUPO.proveedores) +
        barra('Gastos fijos', sumar(gastosPeriodo.filter(g => grupoDe(g.categoria) === 'fijos')), ingresos, COLOR_GRUPO.fijos) +
        barra('Varios', sumar(gastosPeriodo.filter(g => grupoDe(g.categoria) === 'varios')), ingresos, COLOR_GRUPO.varios) +
        barra('Total de gastos', gastosTot, ingresos, '#2A2118')
        : '<p class="vacio-estado">Apunta los cierres de caja para ver este cálculo.</p>'}
      <p class="tenue peque" style="margin:8px 0 0">Importes con IVA. Es una aproximación: solo cuenta los gastos apuntados en la app (no incluye nóminas ni seguros sociales si no los apuntas).</p>
    </div>
    <div class="tarjeta"><h2>${p.tipo === 'mes' ? 'Cierres del mes' : 'Mes a mes'}</h2>${detalle}</div>
    <a class="boton borde" href="#cierre/nuevo" style="margin-bottom:10px">＋ Apuntar un cierre</a>
    <button class="boton secundario" data-a="exportar" data-v="xlsx">Descargar Excel (gastos y caja)</button>`;
}

const gastosLista = r => gastos().filter(g => enRango(g, r));

function filasExportar(lista) {
  return ordenados(lista).reverse().map(g => ({
    'Fecha': g.fecha,
    'Proveedor': g.proveedor_nombre || '',
    'NIF': g.nif || '',
    'Nº factura': g.num_factura || '',
    'Categoría': g.categoria || '',
    'Grupo': GRUPOS[grupoDe(g.categoria)],
    'Base': vacio(g.base) ? '' : Number(g.base),
    'IVA %': vacio(g.iva_pct) ? 'Varios' : Number(g.iva_pct),
    'IVA': vacio(g.iva_importe) ? '' : Number(g.iva_importe),
    'Retención': Number(g.retencion) || 0,
    'Total': Number(g.total) || 0,
    ...Object.fromEntries([4, 10, 21].flatMap(t => [[`Base ${t}%`, vacio(g['base_' + t]) ? '' : Number(g['base_' + t])], [`IVA ${t}%`, vacio(g['iva_' + t]) ? '' : Number(g['iva_' + t])]])),
    'Estado': g.estado === 'por_revisar' ? 'Por revisar' : 'Confirmado',
    'Nota': g.nota || '',
    'Archivo': g.archivo_url || ''
  }));
}

function cargarScript(src) {
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => ko(new Error('No se pudo cargar el exportador. ¿Hay internet?'));
    document.head.appendChild(s);
  });
}

async function entregarArchivo(blob, nombre) {
  const file = new File([blob], nombre, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: nombre });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

async function exportar(formato) {
  const r = rango(E.periodo);
  const lista = gastos().filter(g => enRango(g, r));
  const filas = filasExportar(lista);
  const nombre = 'Gastos La Flor - ' + r.nombre;
  if (formato === 'csv') {
    const cols = Object.keys(filas[0]);
    const celda = (v, col) => {
      if (typeof v === 'number') return col === 'IVA %' ? String(v) : num(v).replace(/\./g, '');
      const s = String(v);
      return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const texto = '﻿' + [cols.join(';')].concat(filas.map(f => cols.map(c => celda(c === 'Fecha' ? f[c].split('-').reverse().join('/') : f[c], c)).join(';'))).join('\r\n');
    return entregarArchivo(new Blob([texto], { type: 'text/csv;charset=utf-8' }), nombre + '.csv');
  }
  cargando('Preparando el Excel…');
  try {
    const datos = await construirExcel(lista, cierres().filter(c => enRango(c, r)));
    await entregarArchivo(new Blob([datos], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombre + '.xlsx');
  } finally {
    cargando(false);
  }
}

// Devuelve el Excel (hojas "Gastos", "Resumen" y, si hay cierres, "Caja").
async function construirExcel(lista, cierresPeriodo = []) {
  if (!window.XLSX) await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  const filas = filasExportar(lista);
  {
    const X = window.XLSX;
    const filasX = filas.map(f => Object.assign({}, f, { Fecha: new Date(f.Fecha + 'T12:00:00') }));
    const hoja = X.utils.json_to_sheet(filasX, { cellDates: true, dateNF: 'dd/mm/yyyy' });
    formatearHoja(X, hoja, ['Base', 'IVA', 'Retención', 'Total', 'Base 4%', 'IVA 4%', 'Base 10%', 'IVA 10%', 'Base 21%', 'IVA 21%'],
      [10, 28, 12, 14, 18, 14, 12, 8, 12, 11, 12, 10, 10, 10, 10, 10, 10, 12, 30, 40]);

    // Resumen por categoría y por tipo de IVA
    const resumen = [];
    const fila = (a, b, c, d, e) => resumen.push({ 'Concepto': a, 'Base': b, 'IVA': c, 'Retención': d, 'Total': e });
    const sum = (l, k) => r2(l.reduce((s, g) => s + (Number(g[k]) || 0), 0));
    categorias().concat([{ nombre: '' }]).forEach(c => {
      const l = lista.filter(g => (g.categoria || '') === c.nombre);
      if (l.length) fila(c.nombre || 'Sin categoría', sum(l, 'base'), sum(l, 'iva_importe'), sum(l, 'retencion'), sum(l, 'total'));
    });
    fila('TOTAL', sum(lista, 'base'), sum(lista, 'iva_importe'), sum(lista, 'retencion'), sum(lista, 'total'));
    fila('', '', '', '', '');
    // Por tipo de IVA: se usa el desglose de la factura; si no lo hay, la base/IVA del gasto con su tipo.
    const conDesglose = g => [4, 10, 21].some(t => !vacio(g['base_' + t]));
    [4, 10, 21].forEach(t => {
      const b = r2(lista.reduce((s, g) => s + (conDesglose(g) ? Number(g['base_' + t]) || 0 : Number(g.iva_pct) === t && !vacio(g.iva_pct) ? Number(g.base) || 0 : 0), 0));
      const i = r2(lista.reduce((s, g) => s + (conDesglose(g) ? Number(g['iva_' + t]) || 0 : Number(g.iva_pct) === t && !vacio(g.iva_pct) ? Number(g.iva_importe) || 0 : 0), 0));
      if (b || i) fila(`IVA ${t} %`, b, i, '', r2(b + i));
    });
    const sinTipo = lista.filter(g => !conDesglose(g) && (vacio(g.iva_pct) || ![4, 10, 21].includes(Number(g.iva_pct))));
    if (sinTipo.length) fila('Sin desglose de IVA', sum(sinTipo, 'base'), sum(sinTipo, 'iva_importe'), sum(sinTipo, 'retencion'), sum(sinTipo, 'total'));
    if (cierresPeriodo.length) {
      const ingresos = sumarCaja(cierresPeriodo);
      fila('', '', '', '', '');
      fila('INGRESOS (cierres de caja)', '', '', '', ingresos);
      fila('RESULTADO (ingresos − gastos)', '', '', '', r2(ingresos - sum(lista, 'total')));
    }
    const hojaR = X.utils.json_to_sheet(resumen);
    formatearHoja(X, hojaR, ['Base', 'IVA', 'Retención', 'Total'], [30, 14, 14, 14, 14]);

    const libro = X.utils.book_new();
    X.utils.book_append_sheet(libro, hoja, 'Gastos');
    X.utils.book_append_sheet(libro, hojaR, 'Resumen');
    if (cierresPeriodo.length) {
      const filasC = cierresPeriodo.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).map(c => ({
        'Fecha': new Date(c.fecha + 'T12:00:00'), 'Efectivo': Number(c.efectivo) || 0, 'Datáfono': Number(c.tarjeta) || 0,
        'Total': Number(c.total) || 0, 'Nota': c.nota || '', 'Foto': c.archivo_url || ''
      }));
      filasC.push({ 'Fecha': 'TOTAL', 'Efectivo': sumarCaja(cierresPeriodo, 'efectivo'), 'Datáfono': sumarCaja(cierresPeriodo, 'tarjeta'), 'Total': sumarCaja(cierresPeriodo), 'Nota': '', 'Foto': '' });
      const hojaC = X.utils.json_to_sheet(filasC, { cellDates: true, dateNF: 'dd/mm/yyyy' });
      formatearHoja(X, hojaC, ['Efectivo', 'Datáfono', 'Total'], [12, 12, 12, 12, 30, 40]);
      X.utils.book_append_sheet(libro, hojaC, 'Caja');
    }
    return X.write(libro, { bookType: 'xlsx', type: 'array', cellDates: true });
  }
}

// ---------- Envío a la gestoría ----------

function hojaGestoria(s) {
  const r = rango(E.periodo);
  const lista = gastos().filter(g => enRango(g, r));
  const pendientes = lista.filter(g => g.estado === 'por_revisar').length;
  return `<h2>Enviar a la gestoría</h2>
    <p class="tenue" style="margin-top:-4px">${esc(r.nombre)} · ${lista.length} ${lista.length === 1 ? 'gasto' : 'gastos'} · ${eur(sumar(lista))}</p>
    <label class="campo"><span>Correo de la gestoría</span><input class="entrada" type="email" inputmode="email" data-h="email" value="${esc(s.email || '')}" placeholder="gestoria@ejemplo.com" autocomplete="email"></label>
    <label class="campo"><span>Mensaje (opcional)</span><textarea class="entrada" data-h="mensaje" placeholder="Hola, te paso las facturas de ${esc(r.nombre)}.">${esc(s.mensaje || '')}</textarea></label>
    <p class="tenue peque">Se enviará desde el Gmail del restaurante con el informe en Excel y un enlace a las facturas escaneadas, compartidas solo con ese correo.</p>
    ${pendientes ? `<p class="descuadre">Hay ${pendientes} ${pendientes === 1 ? 'gasto' : 'gastos'} por revisar en este periodo. Se enviarán igualmente, marcados como «Por revisar».</p>` : ''}
    <div class="dos"><button class="boton secundario" data-a="cerrarHoja">Cancelar</button><button class="boton verde" data-a="enviarGestoria">Enviar</button></div>`;
}

async function enviarGestoria(permitirEnlace) {
  const s = H.estado;
  const email = String(s.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Escribe un correo válido.');
  const r = rango(E.periodo);
  const lista = gastos().filter(g => enRango(g, r));
  if (!lista.length) throw new Error('No hay gastos en este periodo.');
  cargando('Preparando el informe…');
  let excel;
  try {
    excel = { base64: await aBase64(new Blob([await construirExcel(lista, cierres().filter(c => enRango(c, r)))])), nombre: 'Gastos La Flor - ' + r.nombre + '.xlsx' };
  } finally {
    cargando(false);
  }
  const res = await api('enviarGestoria', {
    email, mensaje: s.mensaje || '', desde: r.desde, hasta: r.hasta, periodo: r.nombre, excel, permitirEnlace: !!permitirEnlace
  }, 'Enviando a la gestoría…');
  if (res.necesitaEnlace) {
    const estado = s;
    const ok = await confirmar('El correo de la gestoría no es de Google, así que no se pueden compartir las facturas solo con ella. ¿Envío un enlace abierto? (cualquiera que tenga el enlace podría ver esas facturas)', 'Sí, enviar con enlace', true);
    if (!ok) { avisar('No se ha enviado nada.'); return; }
    H.estado = estado;
    return enviarGestoria(true);
  }
  E.datos.gestoria_email = email;
  guardarDatos();
  cerrarHoja();
  avisar(`Enviado a ${email} ✓`, 'ok');
}

// ---------- Cambiar PIN ----------

function hojaPin() {
  return `<h2>Cambiar mi PIN</h2>
    <label class="campo"><span>PIN actual</span><input class="entrada" type="password" inputmode="numeric" maxlength="4" data-h="actual" autocomplete="current-password"></label>
    <label class="campo"><span>PIN nuevo (4 números)</span><input class="entrada" type="password" inputmode="numeric" maxlength="4" data-h="nuevo" autocomplete="new-password"></label>
    <label class="campo"><span>Repite el PIN nuevo</span><input class="entrada" type="password" inputmode="numeric" maxlength="4" data-h="repite" autocomplete="new-password"></label>
    <p class="tenue peque">Al cambiarlo se cerrará tu sesión en los demás móviles donde hayas entrado.</p>
    <div class="dos"><button class="boton secundario" data-a="cerrarHoja">Cancelar</button><button class="boton" data-a="guardarPin">Cambiar</button></div>`;
}

function formatearHoja(X, hoja, columnasEuro, anchos) {
  const rangoH = X.utils.decode_range(hoja['!ref']);
  for (let c = rangoH.s.c; c <= rangoH.e.c; c++) {
    const cab = hoja[X.utils.encode_cell({ r: 0, c })];
    if (!cab || !columnasEuro.includes(cab.v)) continue;
    for (let r = 1; r <= rangoH.e.r; r++) {
      const celda = hoja[X.utils.encode_cell({ r, c })];
      if (celda && celda.t === 'n') celda.z = '#,##0.00 "€"';
    }
  }
  hoja['!cols'] = anchos.map(w => ({ wch: w }));
}

// ---------- Proveedores, gastos fijos y usuarios ----------

function pintarProveedores() {
  const t = E.tabProv;
  const tab = (v, texto) => `<button class="${t === v ? 'activo' : ''}" data-a="tabProv" data-v="${v}">${texto}</button>`;
  let cuerpo = '';
  if (t === 'proveedores') {
    cuerpo = `<div class="buscador"><input class="entrada" id="buscar-prov" type="search" placeholder="Buscar proveedor" value="${esc(E.buscarProv)}" autocomplete="off"></div>
      <button class="boton borde" data-a="nuevoProveedor" style="margin-bottom:12px">＋ Nuevo proveedor</button>
      <div class="tarjeta" style="padding:4px 14px"><ul class="lista" id="lista-prov"></ul></div>`;
  } else if (t === 'fijos') {
    const lista = (E.datos.recurrentes || []);
    cuerpo = `<p class="tenue">Se apuntan solos cada mes el día indicado, como «por revisar», para que luego adjuntes el recibo.</p>
      <button class="boton borde" data-a="editarRecurrente" style="margin-bottom:12px">＋ Nuevo gasto fijo</button>
      <div class="tarjeta" style="padding:4px 14px"><ul class="lista">${lista.length ? lista.map(r => `<li><button class="fila g-${grupoDe(r.categoria)} ${r.activo ? '' : 'inactivo'}" data-a="editarRecurrente" data-id="${esc(r.id)}">
        <span class="icono">${esc(String(r.dia_del_mes))}</span>
        <span class="medio"><span class="titulo" style="display:block">${esc(r.concepto)}</span><span class="detalle" style="display:block">Día ${esc(String(r.dia_del_mes))} de cada mes · ${esc(r.categoria)}${r.activo ? '' : ' · Pausado'}</span></span>
        <span class="derecha importe">${eur(r.importe)}</span></button></li>`).join('') : '<li class="vacio-estado">No hay gastos fijos todavía. Añade el alquiler.</li>'}</ul></div>`;
  } else {
    const lista = (E.datos.usuarios || []);
    cuerpo = `<p class="tenue">Cada persona entra con su nombre y su PIN. Los «empleados» solo pueden subir facturas y ver las suyas.</p>
      <button class="boton borde" data-a="editarUsuario" style="margin-bottom:12px">＋ Nueva persona</button>
      <div class="tarjeta" style="padding:4px 14px"><ul class="lista">${lista.map(u => `<li><button class="fila ${u.activo ? '' : 'inactivo'}" data-a="editarUsuario" data-id="${esc(u.id)}">
        <span class="icono">${esc(u.nombre[0].toUpperCase())}</span>
        <span class="medio"><span class="titulo" style="display:block">${esc(u.nombre)}</span><span class="detalle" style="display:block">${u.rol === 'dueno' ? 'Dueño · lo ve todo' : 'Empleado · solo sube facturas'}${u.activo ? '' : ' · Sin acceso'}</span></span></button></li>`).join('')}</ul></div>
      <p class="pie">Versión ${esc(E.datos.version || '')}</p>`;
  }
  $('#app').innerHTML = `
    <div class="cabecera"><div><p class="sub">Ajustes</p><h1>Proveedores</h1></div></div>
    <div class="segmentos">${tab('proveedores', 'Proveedores')}${tab('fijos', 'Fijos')}${tab('usuarios', 'Personas')}</div>
    ${cuerpo}`;
  pintarListaProv();
}

function pintarListaProv() {
  const caja = $('#lista-prov');
  if (!caja) return;
  const t = normal(E.buscarProv);
  const lista = (E.datos.proveedores || [])
    .filter(p => !t || normal(p.nombre).includes(t) || normal(p.nif).includes(t))
    .sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre, 'es'));
  caja.innerHTML = lista.length ? lista.map(p => `<li><button class="fila g-${grupoDe(p.categoria_habitual)} ${p.activo ? '' : 'inactivo'}" data-a="editarProveedor" data-id="${esc(p.id)}">
    <span class="icono">${esc(p.nombre[0].toUpperCase())}</span>
    <span class="medio"><span class="titulo" style="display:block">${esc(p.nombre)}</span><span class="detalle" style="display:block">${esc([p.nif || 'Sin NIF', p.categoria_habitual || 'Sin categoría'].join(' · '))}${p.activo ? '' : ' · De baja'}</span></span></button></li>`).join('')
    : '<li class="vacio-estado">No hay proveedores. Se crean aquí o al revisar una factura.</li>';
}

function hojaRecurrente(s) {
  const provs = (E.datos.proveedores || []).filter(p => p.activo || p.id === s.proveedor_id);
  return `<h2>${s.id ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}</h2>
    <label class="campo"><span>Concepto</span><input class="entrada" data-h="concepto" value="${esc(s.concepto || '')}" placeholder="Alquiler del local"></label>
    <label class="campo"><span>Proveedor (opcional)</span><select class="entrada" data-h="proveedor_id"><option value="">— Ninguno —</option>
      ${provs.map(p => `<option value="${esc(p.id)}" ${p.id === s.proveedor_id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>
    <label class="campo"><span>Categoría</span><select class="entrada" data-h="categoria">
      ${categorias().map(c => `<option ${c.nombre === s.categoria ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
    <div class="dos">
      <label class="campo"><span>Total que se paga</span><input class="entrada importe" inputmode="decimal" data-h="importe" value="${numCampo(s.importe)}"></label>
      <label class="campo"><span>Día del mes</span><input class="entrada" inputmode="numeric" data-h="dia_del_mes" value="${esc(s.dia_del_mes || '')}" placeholder="1"></label>
    </div>
    <div class="tres">
      <label class="campo"><span>Base</span><input class="entrada importe" inputmode="decimal" data-h="base" value="${numCampo(s.base)}"></label>
      <label class="campo"><span>IVA %</span><select class="entrada" data-h="iva_pct"><option value="">—</option>${TIPOS_IVA.map(t => `<option value="${t}" ${String(s.iva_pct) === String(t) ? 'selected' : ''}>${t} %</option>`).join('')}</select></label>
      <label class="campo"><span>Retención</span><input class="entrada importe" inputmode="decimal" data-h="retencion" value="${numCampo(s.retencion)}"></label>
    </div>
    <label class="interruptor">Activo<input type="checkbox" data-h="activo" ${s.activo !== false ? 'checked' : ''}></label>
    <div class="dos"><button class="boton secundario" data-a="cerrarHoja">Cancelar</button><button class="boton" data-a="guardarRecurrente">Guardar</button></div>`;
}

function hojaUsuario(s) {
  return `<h2>${s.id ? 'Editar persona' : 'Nueva persona'}</h2>
    <label class="campo"><span>Nombre</span><input class="entrada" data-h="nombre" value="${esc(s.nombre || '')}"></label>
    <div class="campo"><span>Permisos</span><div class="chips envuelve">
      <button class="chip ${s.rol !== 'dueno' ? 'activo' : ''}" data-a="hojaRol" data-v="empleado">Empleado: solo sube facturas</button>
      <button class="chip ${s.rol === 'dueno' ? 'activo' : ''}" data-a="hojaRol" data-v="dueno">Dueño: lo ve todo</button></div></div>
    <label class="campo"><span>${s.id ? 'Nuevo PIN (déjalo vacío para no cambiarlo)' : 'PIN de 4 números'}</span><input class="entrada" type="password" inputmode="numeric" maxlength="4" data-h="pin" value="" autocomplete="new-password"></label>
    ${s.id ? `<label class="interruptor">Puede entrar<input type="checkbox" data-h="activo" ${s.activo !== false ? 'checked' : ''}></label>` : ''}
    <div class="dos"><button class="boton secundario" data-a="cerrarHoja">Cancelar</button><button class="boton" data-a="guardarUsuario">Guardar</button></div>`;
}

// ---------- Acciones (botones) ----------

const ACCIONES = {
  reintentar: () => { E.acceso = null; pintar(); },
  atras: () => {
    E.form = null;
    if (history.length > 1) history.back(); else ir('inicio');
  },
  salir: async () => {
    if (!(await confirmar('¿Cerrar sesión en este móvil?', 'Cerrar sesión'))) return;
    try { await api('logout'); } catch (e) { /* da igual: se cierra igualmente */ }
    cerrarSesionLocal();
  },

  // Acceso
  altaInicial: async () => {
    const nombre = $('#alta-nombre').value.trim(), pin = $('#alta-pin').value, pin2 = $('#alta-pin2').value;
    if (!nombre) throw new Error('Escribe tu nombre.');
    if (!/^\d{4}$/.test(pin)) throw new Error('El PIN tiene que tener 4 números.');
    if (pin !== pin2) throw new Error('Los dos PIN no coinciden.');
    entrar(await api('altaInicial', { nombre, pin }, 'Creando usuario…'));
  },
  elegirUsuario: el => { E.acceso.elegido = el.dataset.id; E.acceso.pin = ''; E.acceso.error = ''; pintarAcceso(); },
  cambiarUsuario: () => { E.acceso.elegido = null; pintarAcceso(); },
  tecla: async el => {
    const A = E.acceso;
    if (A.ocupado) return;
    if (el.dataset.n === 'x') A.pin = A.pin.slice(0, -1);
    else if (A.pin.length < 4) A.pin += el.dataset.n;
    A.error = '';
    pintarAcceso();
    if (A.pin.length === 4) {
      A.ocupado = true;
      try {
        entrar(await api('login', { usuario_id: A.elegido, pin: A.pin }, 'Entrando…'));
      } catch (e) {
        A.pin = '';
        A.error = e.message;
        pintarAcceso();
        const p = $('#puntos');
        if (p) p.classList.add('temblor');
      } finally {
        A.ocupado = false;
      }
    }
  },

  // Añadir
  aMano: () => { E.form = null; location.replace('#revisar/nuevo'); },

  // Revisar
  categoria: el => { E.form.categoria = el.dataset.v; pintar(); },
  ivaPct: el => {
    E.form.iva_pct = el.dataset.v === '' ? '' : Number(el.dataset.v);
    recalcular('ivaPct');
    pintar();
  },
  verRetencion: () => { E.form.verRetencion = true; pintar(); },
  elegirProveedor: () => abrirHoja(hojaSelectorProveedor, { q: '' }),
  usarProveedor: el => usarProveedorEnForm(proveedor(el.dataset.id)),
  corregirProveedor: () => abrirHoja(hojaFormProveedor, Object.assign({}, proveedor(E.form.proveedor_id), { paraForm: true })),
  sinProveedor: () => usarProveedorEnForm(null),
  crearSugerido: () => {
    const s = E.sugerencia[E.form.id] || {};
    abrirHoja(hojaFormProveedor, { nombre: s.nombre, nif: s.nif, categoria_habitual: E.form.categoria, paraForm: true });
  },
  nuevoProveedorDesdeSelector: () => {
    const q = H.estado.q || '';
    abrirHoja(hojaFormProveedor, { nombre: q, categoria_habitual: E.form && E.form.categoria, paraForm: true, volverSelector: true });
  },
  volverSelector: () => abrirHoja(hojaSelectorProveedor, { q: '' }),
  hojaCategoria: el => { H.estado.categoria_habitual = el.dataset.v; repintarHoja(); },
  nuevaCategoria: el => abrirNuevaCategoria(el.dataset.grupo, null),
  nuevaCategoriaProveedor: el => abrirNuevaCategoria(el.dataset.grupo, { pintar: H.pintar, estado: H.estado }),
  grupoCategoria: el => { H.estado.grupo = el.dataset.v; repintarHoja(); },
  cancelarCategoria: () => {
    const v = H.estado.volver;
    if (v) abrirHoja(v.pintar, v.estado); else cerrarHoja();
  },
  guardarCategoria: async () => {
    const s = H.estado;
    if (!String(s.nombre || '').trim()) throw new Error('Escribe el nombre de la categoría.');
    const r = await api('guardarCategoria', { nombre: s.nombre, grupo: s.grupo }, 'Creando categoría…');
    const c = r.categoria;
    if (!categorias().some(x => x.nombre === c.nombre)) E.datos.categorias.push(c);
    guardarDatos();
    avisar(r.yaExistia ? `La categoría «${c.nombre}» ya existía` : `Categoría «${c.nombre}» creada`, 'ok');
    if (s.volver) {
      abrirHoja(s.volver.pintar, Object.assign(s.volver.estado, { categoria_habitual: c.nombre }));
    } else {
      cerrarHoja();
      if (E.form) E.form.categoria = c.nombre;
      pintar();
    }
  },
  guardarProveedor: async () => {
    const s = H.estado;
    const r = await api('guardarProveedor', { proveedor: { id: s.id, nombre: s.nombre, nif: s.nif, categoria_habitual: s.categoria_habitual, activo: s.activo } }, 'Guardando proveedor…');
    const lista = E.datos.proveedores;
    const i = lista.findIndex(p => p.id === r.proveedor.id);
    if (i >= 0) lista[i] = r.proveedor; else lista.push(r.proveedor);
    guardarDatos();
    avisar('Proveedor guardado', 'ok');
    if (s.paraForm && E.form) usarProveedorEnForm(r.proveedor);
    else { cerrarHoja(); pintar(); }
  },
  guardarGasto: () => guardarForm('confirmado'),
  dejarPendiente: () => guardarForm('por_revisar'),
  repetirFoto: async () => {
    if (!(await confirmar('¿Descartar esta foto y hacer otra?', 'Repetir foto'))) return;
    const id = E.form.id;
    await api('descartar', { id }, 'Descartando…');
    E.datos.gastos = gastos().filter(g => g.id !== id);
    guardarDatos();
    E.form = null;
    location.replace('#anadir');
  },
  descartarCopia: async () => {
    if (!(await confirmar('¿Descartar esta factura? Se quitará de la lista y su archivo irá a la papelera de Drive.', 'Descartar', true))) return;
    const id = E.form.id;
    await api('descartar', { id }, 'Descartando…');
    E.datos.gastos = gastos().filter(g => g.id !== id);
    delete E.sugerencia[id];
    guardarLS('sugerencias', E.sugerencia);
    guardarDatos();
    E.form = null;
    avisar('Descartada', 'ok');
    location.hash = E.anterior || 'inicio';
  },
  anular: async () => {
    if (!(await confirmar('¿Anular este gasto? Dejará de contar en los totales (seguirá en la hoja de cálculo).', 'Anular gasto', true))) return;
    const id = E.form.id;
    await api('anular', { id }, 'Anulando…');
    E.datos.gastos = gastos().filter(g => g.id !== id);
    guardarDatos();
    E.form = null;
    avisar('Gasto anulado', 'ok');
    location.hash = E.anterior || 'inicio';
  },

  // Cierre de caja
  atrasCierre: () => {
    E.cierre = null;
    if (history.length > 1) history.back(); else ir('inicio');
  },
  guardarCierre: async () => {
    const f = E.cierre;
    if (vacio(f.efectivo) && vacio(f.tarjeta)) throw new Error('Escribe el efectivo y el datáfono.');
    const r = await api('guardarCierre', { cierre: f }, 'Guardando el cierre…');
    const lista = E.datos.cierres = cierres();
    const i = lista.findIndex(c => c.id === r.cierre.id);
    if (i >= 0) lista[i] = r.cierre; else lista.push(r.cierre);
    if (f.archivo_id && E.vistaPrevia['cierre:' + f.archivo_id]) E.vistaPrevia['cierre:' + r.cierre.archivo_id] = E.vistaPrevia['cierre:' + f.archivo_id];
    guardarDatos();
    E.cierre = null;
    avisar(`Cierre del ${fechaCorta(r.cierre.fecha)} guardado ✓ · ${eur(r.cierre.total)}`, 'ok');
    location.hash = E.anterior || 'inicio';
  },
  borrarCierre: async () => {
    if (!(await confirmar('¿Borrar este cierre de caja? La foto irá a la papelera de Drive.', 'Borrar', true))) return;
    const id = E.cierre.id;
    await api('borrarCierre', { id }, 'Borrando…');
    E.datos.cierres = cierres().filter(c => c.id !== id);
    guardarDatos();
    E.cierre = null;
    avisar('Cierre borrado', 'ok');
    location.hash = E.anterior || 'inicio';
  },
  vistaInforme: el => { E.vistaInforme = el.dataset.v; pintar(); },
  verCaja: () => { E.vistaInforme = 'caja'; E.periodo = periodoActual(); ir('informes'); },

  // Facturas
  filtro: el => {
    E.filtro = el.dataset.v;
    if (ruta().a) location.replace('#facturas'); else pintar();
  },

  // Informes
  tipoPeriodo: el => {
    const d = new Date(), t = el.dataset.v;
    E.periodo = { tipo: t, a: d.getFullYear(), n: t === 'mes' ? d.getMonth() + 1 : t === 'trimestre' ? Math.floor(d.getMonth() / 3) + 1 : 0 };
    pintar();
  },
  periodo: el => { E.periodo = moverPeriodo(E.periodo, Number(el.dataset.v)); pintar(); },
  exportar: el => exportar(el.dataset.v),
  abrirGestoria: () => abrirHoja(hojaGestoria, { email: (E.datos && E.datos.gestoria_email) || '' }),
  enviarGestoria: () => enviarGestoria(false),

  // PIN
  cambiarPin: () => abrirHoja(hojaPin, {}),
  guardarPin: async () => {
    const s = H.estado;
    if (!/^\d{4}$/.test(s.nuevo || '')) throw new Error('El PIN nuevo tiene que tener 4 números.');
    if (s.nuevo !== s.repite) throw new Error('Los dos PIN nuevos no coinciden.');
    await api('cambiarPin', { actual: s.actual || '', nuevo: s.nuevo }, 'Cambiando el PIN…');
    cerrarHoja();
    avisar('PIN cambiado ✓', 'ok');
  },

  // Proveedores / fijos / personas
  tabProv: el => { E.tabProv = el.dataset.v; pintar(); },
  nuevoProveedor: () => abrirHoja(hojaFormProveedor, { activo: true }),
  editarProveedor: el => abrirHoja(hojaFormProveedor, Object.assign({}, proveedor(el.dataset.id))),
  editarRecurrente: el => {
    const r = (E.datos.recurrentes || []).find(x => x.id === el.dataset.id);
    abrirHoja(hojaRecurrente, r ? Object.assign({}, r) : { categoria: 'Alquiler', activo: true, dia_del_mes: 1, iva_pct: 21 });
  },
  guardarRecurrente: async () => {
    const s = H.estado;
    const datos = Object.assign({}, s, { importe: leerNum(s.importe), base: leerNum(s.base), retencion: leerNum(s.retencion) || 0 });
    const r = await api('guardarRecurrente', { recurrente: datos }, 'Guardando…');
    const lista = E.datos.recurrentes = E.datos.recurrentes || [];
    const i = lista.findIndex(x => x.id === r.recurrente.id);
    if (i >= 0) lista[i] = r.recurrente; else lista.push(r.recurrente);
    guardarDatos();
    cerrarHoja();
    avisar('Gasto fijo guardado', 'ok');
    pintar();
  },
  editarUsuario: el => {
    const u = (E.datos.usuarios || []).find(x => x.id === el.dataset.id);
    abrirHoja(hojaUsuario, u ? Object.assign({}, u) : { rol: 'empleado', activo: true });
  },
  hojaRol: el => { H.estado.rol = el.dataset.v; repintarHoja(); },
  guardarUsuario: async () => {
    const r = await api('guardarUsuario', { usuario: H.estado }, 'Guardando…');
    const lista = E.datos.usuarios = E.datos.usuarios || [];
    const i = lista.findIndex(x => x.id === r.usuario.id);
    if (i >= 0) lista[i] = r.usuario; else lista.push(r.usuario);
    guardarDatos();
    cerrarHoja();
    avisar('Guardado', 'ok');
    pintar();
  },
  cerrarHoja: () => cerrarHoja()
};

// ---------- Eventos ----------

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = ACCIONES[el.dataset.a];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve().then(() => fn(el)).catch(err => avisar(err.message, 'error'));
});

// Las hojas guardan su estado como texto y casillas (los importes se convierten al guardar).
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.campo) campoForm(t);
  else if (t.dataset.cc) campoCierre(t);
  else if (t.dataset.h) {
    H.estado[t.dataset.h] = t.type === 'checkbox' ? t.checked : t.value;
    if (t.dataset.h === 'q') { const l = $('#hoja-lista'); if (l) l.innerHTML = listaSelector(t.value); }
  } else if (t.id === 'buscar-facturas') { E.busqueda = t.value; pintarListaFacturas(); }
  else if (t.id === 'buscar-prov') { E.buscarProv = t.value; pintarListaProv(); }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.type === 'file') {
    (t.dataset.cierre ? procesarFotoCierre(t) : procesarArchivo(t)).catch(err => { cargando(false); avisar(err.message, 'error'); });
  }
  else if (t.dataset.h && t.tagName === 'SELECT') H.estado[t.dataset.h] = t.value;
  else if (t.dataset.h && t.type === 'checkbox') H.estado[t.dataset.h] = t.checked;
});

// Al volver a la app se actualizan los datos (si han pasado más de 30 segundos).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && E.token && Date.now() - E.ultimaCarga > 30000) {
    refrescar(false).catch(() => {});
  }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

pintar();
if (E.token && E.datos) refrescar(false).catch(() => {});
