// Lectura de facturas: OCR con Google Drive y extracción de los datos del texto.

function ocr_(archivo) {
  const temporal = prop_('TEMPORAL_ID');
  const doc = Drive.Files.create(
    { name: 'lectura ' + archivo.getName(), mimeType: 'application/vnd.google-apps.document', parents: [temporal] },
    archivo.getBlob(),
    { ocrLanguage: 'es', fields: 'id' }
  );
  try {
    return DocumentApp.openById(doc.id).getBody().getText();
  } finally {
    try { DriveApp.getFileById(doc.id).setTrashed(true); } catch (e) { console.error(e); }
  }
}

function analizarFactura_(texto, proveedores) {
  const r = {};
  if (!texto) return r;
  const lineas = texto.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);

  const nifs = buscarNifs_(texto).filter(n => n !== NIF_PROPIO);
  let prov = null;
  for (const n of nifs) {
    prov = proveedores.find(p => normNif_(p.nif) === n);
    if (prov) break;
  }
  if (!prov) {
    const t = normTexto_(texto);
    prov = proveedores
      .filter(p => p.nombre && normTexto_(p.nombre).length >= 4 && t.includes(normTexto_(p.nombre)))
      .sort((a, b) => b.nombre.length - a.nombre.length)[0] || null;
  }
  if (prov) {
    r.proveedor = prov;
    r.nif = normNif_(prov.nif);
    r.categoria = prov.categoria_habitual;
  } else {
    r.nif = nifs[0] || '';
    r.nombreSugerido = nombreSugerido_(lineas);
    r.categoria = categoriaPorPalabras_(texto);
  }

  r.fecha = buscarFecha_(lineas);
  r.num_factura = buscarNumFactura_(lineas);
  Object.assign(r, buscarImportes_(lineas));
  return r;
}

// ---------- NIF / CIF ----------

function normNif_(n) {
  return String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ES(?=[A-Z0-9]{9}$)/, '');
}

function buscarNifs_(texto) {
  const t = texto.toUpperCase()
    .replace(/(\d)[.\-](?=\d)/g, '$1')
    .replace(/\b([A-HJ-NP-SUVWXYZ])[\s.\-]+(?=\d{7})/g, '$1');
  const re = /\b(?:ES)?([A-HJ-NP-SUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/g;
  const validos = [], dudosos = [];
  let m;
  while ((m = re.exec(t))) {
    const n = m[1];
    const lista = nifValido_(n) ? validos : dudosos;
    if (!lista.includes(n)) lista.push(n);
  }
  return validos.concat(dudosos);
}

function nifValido_(n) {
  const letras = 'TRWAGMYFPDXBNJZSQVHLCKE';
  if (/^\d{8}[A-Z]$/.test(n)) return letras[Number(n.slice(0, 8)) % 23] === n[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(n)) {
    const num = Number('XYZ'.indexOf(n[0]) + n.slice(1, 8));
    return letras[num % 23] === n[8];
  }
  // CIF de sociedad
  const d = n.slice(1, 8).split('').map(Number);
  let suma = 0;
  d.forEach((x, i) => {
    if (i % 2 === 1) suma += x;
    else { const y = x * 2; suma += Math.floor(y / 10) + (y % 10); }
  });
  const control = (10 - (suma % 10)) % 10;
  return n[8] === String(control) || n[8] === 'JABCDEFGHI'[control];
}

// ---------- Proveedor y categoría ----------

function normTexto_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function nombreSugerido_(lineas) {
  const propio = /cempaz|la flor de/i;
  const ruido = /factura|recibo|fecha|cliente|n[º°]|tel[eé]f|www|@|c\/|calle|avda|direcci|p[aá]gina|^\d/i;
  const primeras = lineas.slice(0, 12).filter(l => !propio.test(l));
  const sociedad = primeras.find(l => /\b(S\.?\s?L\.?\s?U?|S\.?\s?A\.?|S\.?\s?C\.?\s?P|S\.?\s?COOP|C\.?\s?B)\.?\s*$|sociedad/i.test(l) && l.length <= 60);
  if (sociedad) return sociedad.replace(/\s+/g, ' ');
  const otra = primeras.find(l => /[a-záéíóúñ]{3}/i.test(l) && !ruido.test(l) && l.length <= 50);
  return otra ? otra.replace(/\s+/g, ' ') : '';
}

function categoriaPorPalabras_(texto) {
  const regla = PALABRAS_CATEGORIA.find(([re]) => re.test(texto));
  return regla ? regla[1] : '';
}

// ---------- Fecha ----------

const MESES_ = { enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5,
  junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9, set: 9,
  octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12 };

function buscarFecha_(lineas) {
  const hoy = new Date();
  const minimo = new Date(hoy.getTime() - 400 * 86400000);
  const maximo = new Date(hoy.getTime() + 3 * 86400000);
  const candidatas = [];
  lineas.forEach((linea, i) => {
    const contexto = (lineas[i - 1] || '') + ' ' + linea;
    let puntos = 0;
    if (/fecha|data|date/i.test(contexto)) puntos += 10;
    if (/venc|caduc|entrega|pago|albar/i.test(linea)) puntos -= 6;
    const agregar = (a, m, d) => {
      if (a < 100) a += 2000;
      const f = new Date(a, m - 1, d);
      if (f.getMonth() !== m - 1 || f < minimo || f > maximo) return;
      candidatas.push({ iso: Utilities.formatDate(f, ZONA, 'yyyy-MM-dd'), puntos, i });
    };
    let m;
    const reNum = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})\b/g;
    while ((m = reNum.exec(linea))) agregar(Number(m[3]), Number(m[2]), Number(m[1]));
    const reIso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = reIso.exec(linea))) agregar(Number(m[1]), Number(m[2]), Number(m[3]));
    const reTexto = /\b(\d{1,2})\s*(?:de\s+)?([a-zá]{3,10})\.?,?\s*(?:de\s+)?(\d{4})\b/gi;
    while ((m = reTexto.exec(linea))) {
      const mes = MESES_[m[2].toLowerCase()];
      if (mes) agregar(Number(m[3]), mes, Number(m[1]));
    }
  });
  candidatas.sort((a, b) => b.puntos - a.puntos || a.i - b.i);
  return candidatas.length ? candidatas[0].iso : '';
}

// ---------- Número de factura ----------

function buscarNumFactura_(lineas) {
  const etiqueta = /(?:n[º°o]\.?|n[uú]m(?:ero)?\.?|no\.)\s*(?:de\s+)?(?:factura|fra)\.?|(?:factura|fra\.?|invoice)\s*(?:n[º°o]\.?|n[uú]m(?:ero)?\.?|no\.?|#)?/i;
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(etiqueta);
    if (!m || /(fecha|data)\s*(de\s+)?$/i.test(lineas[i].slice(0, m.index))) continue;
    const resto = lineas[i].slice(m.index + m[0].length);
    const tok = primerToken_(resto) || (/fecha|data/i.test(lineas[i + 1] || '') ? '' : primerToken_(lineas[i + 1] || ''));
    if (tok) return tok;
  }
  return '';
}

function primerToken_(s) {
  const toks = s.replace(/^[\s:.#\-]+/, '').split(/\s+/).slice(0, 3);
  for (const t of toks) {
    const c = t.replace(/[,;:)]+$/, '').replace(/^[(]+/, '');
    if (!/\d/.test(c) || c.length < 2 || c.length > 20) continue;
    if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(c)) continue;
    if (/^\d+[.,]\d{2}$/.test(c) || /%$/.test(c)) continue;
    return c.toUpperCase();
  }
  return '';
}

// ---------- Importes ----------

function importesEn_(s) {
  const re = /-?\d{1,3}(?:\.\d{3})+,\d{2}(?!\d)|-?\d{1,3}(?:,\d{3})+\.\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)/g;
  const lista = [];
  let m;
  while ((m = re.exec(s))) {
    if (/^\s*%/.test(s.slice(m.index + m[0].length))) continue;
    lista.push(parseImporte_(m[0]));
  }
  return lista.filter(n => !isNaN(n));
}

function parseImporte_(t) {
  if (/,\d{2}$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  return Number(t.replace(/,/g, ''));
}

// Importes de las líneas que cumplen "re" (y de la línea siguiente si la etiqueta va sola).
// Con soloPrimero se toma únicamente el primer importe de cada línea (p. ej. "Base 10% 100,00 Cuota 10,00").
function importesConEtiqueta_(lineas, re, excluir, soloPrimero) {
  const lista = [];
  lineas.forEach((l, i) => {
    if (!re.test(l) || (excluir && excluir.test(l))) return;
    let nums = importesEn_(l).filter(n => n > 0);
    if (!nums.length) nums = importesEn_(lineas[i + 1] || '').filter(n => n > 0);
    if (soloPrimero) nums = nums.slice(0, 1);
    lista.push(...nums);
  });
  return lista;
}

function buscarImportes_(lineas) {
  const todos = [];
  lineas.forEach(l => todos.push(...importesEn_(l).filter(n => n > 0)));
  if (!todos.length) return {};

  const totales = importesConEtiqueta_(lineas, /total|a pagar|importe\s+factura|l[ií]quido/i,
    /sub\s*-?total|total\s*(base|iva|bruto|neto|l[ií]neas?|dto|descuento|cuota)|base/i);
  const total = totales.length ? Math.max(...totales) : Math.max(...todos);

  const tiposTexto = [];
  lineas.forEach(l => {
    if (!/iva|i\.v\.a|igic|cuota|tipo/i.test(l) && !/%/.test(l)) return;
    const re = /(\d{1,2})(?:[.,]0{1,2})?\s*%/g;
    let m;
    while ((m = re.exec(l))) {
      const t = Number(m[1]);
      if ([4, 5, 10, 21].includes(t) && !tiposTexto.includes(t)) tiposTexto.push(t);
    }
  });
  const tipos = tiposTexto.length ? tiposTexto.concat([10, 21, 4].filter(t => !tiposTexto.includes(t))) : [10, 21, 4];

  // 1) Un solo tipo de IVA: base * (1 + tipo) = total
  for (const t of tipos) {
    for (const b of todos) {
      if (b >= total) continue;
      if (Math.abs(b * (1 + t / 100) - total) <= 0.03) {
        return { base: r2_(b), iva_pct: t, iva_importe: r2_(total - b), retencion: 0, total: r2_(total) };
      }
    }
  }
  // 2) Con retención de IRPF (alquiler 19 %, profesionales 15 % o 7 %)
  if (/retenc|irpf/i.test(lineas.join(' '))) {
    for (const t of tipos) {
      for (const ret of [19, 15, 7]) {
        for (const b of todos) {
          if (Math.abs(b * (1 + t / 100 - ret / 100) - total) <= 0.03) {
            return { base: r2_(b), iva_pct: t, iva_importe: r2_(b * t / 100), retencion: r2_(b * ret / 100), total: r2_(total) };
          }
        }
      }
    }
  }
  // 3) Varios tipos de IVA: se usa la base indicada y el IVA es la diferencia
  const bases = importesConEtiqueta_(lineas, /base\s*imponible|^base|total\s*base|subtotal|importe\s*neto/i, null, true)
    .filter(b => b < total);
  if (bases.length) {
    const unica = bases.find(b => total - b <= b * 0.22);
    const suma = r2_(bases.reduce((s, b) => s + b, 0));
    const base = unica && tiposTexto.length <= 1 ? unica : (suma < total ? suma : Math.max(...bases));
    const iva = r2_(total - base);
    return { base: r2_(base), iva_pct: tiposTexto.length === 1 ? tiposTexto[0] : '', iva_importe: iva, retencion: 0, total: r2_(total) };
  }
  // 4) Solo el total: se calcula con el tipo de IVA que aparezca (o 10 %)
  if (tiposTexto.length === 1) {
    const t = tiposTexto[0];
    const base = r2_(total / (1 + t / 100));
    return { base, iva_pct: t, iva_importe: r2_(total - base), retencion: 0, total: r2_(total) };
  }
  return { total: r2_(total) };
}
