// Envío del informe y las facturas de un periodo a la gestoría.
// Se adjunta el Excel (generado en el móvil) y se comparten las carpetas de los meses
// del periodo SOLO con el correo de la gestora. Si su correo no es de Google, no se abre
// nada sin permiso: se devuelve necesitaEnlace y la app pregunta antes de usar un enlace abierto.

const MAX_ADJUNTOS_BYTES = 15 * 1024 * 1024;
const MAX_ADJUNTOS = 40;

function enviarGestoria_(u, p) {
  soloDueno_(u);
  const email = String(p.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('El correo de la gestoría no es válido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.desde || '') || !/^\d{4}-\d{2}-\d{2}$/.test(p.hasta || '')) throw new Error('Periodo no válido.');
  if (!p.excel || !p.excel.base64) throw new Error('Falta el informe.');
  const periodo = String(p.periodo || '').slice(0, 60);

  const gastos = leer_('Gastos').filter(g => g.estado !== 'anulado' && g.fecha >= p.desde && g.fecha <= p.hasta);
  if (!gastos.length) throw new Error('No hay gastos en ese periodo.');

  // Carpetas de los meses del periodo que tienen archivos.
  const meses = [];
  for (let d = new Date(p.desde + 'T12:00:00'); Utilities.formatDate(d, ZONA, 'yyyy-MM-dd') <= p.hasta; d.setMonth(d.getMonth() + 1)) {
    meses.push(Utilities.formatDate(d, ZONA, 'yyyy-MM'));
    d.setDate(1);
  }
  const conArchivo = gastos.filter(g => g.archivo_id);
  const carpetas = meses
    .filter(m => conArchivo.some(g => g.fecha.slice(0, 7) === m))
    .map(m => ({ mes: m, carpeta: carpetaMes_(m + '-01') }));

  // Compartir solo con la gestora (o con enlace si se ha autorizado expresamente).
  if (carpetas.length) {
    try {
      carpetas.forEach(c => c.carpeta.addViewer(email));
    } catch (e) {
      console.error('addViewer: ' + e);
      if (!p.permitirEnlace) return { necesitaEnlace: true };
      carpetas.forEach(c => c.carpeta.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW));
    }
  }

  // Adjuntos: el Excel siempre; las facturas también si caben.
  const adjuntos = [Utilities.newBlob(Utilities.base64Decode(p.excel.base64),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', p.excel.nombre || 'Gastos.xlsx')];
  let facturasAdjuntas = false;
  if (conArchivo.length <= MAX_ADJUNTOS) {
    const archivos = conArchivo.map(g => { try { return DriveApp.getFileById(g.archivo_id); } catch (e) { return null; } }).filter(Boolean);
    const tam = archivos.reduce((s, f) => s + f.getSize(), 0);
    if (tam <= MAX_ADJUNTOS_BYTES) {
      archivos.forEach(f => adjuntos.push(f.getBlob()));
      facturasAdjuntas = true;
    }
  }

  const suma = k => r2_(gastos.reduce((s, g) => s + (Number(g[k]) || 0), 0));
  const pendientes = gastos.filter(g => g.estado === 'por_revisar').length;
  const sinArchivo = gastos.length - conArchivo.length;
  const nombreMes = m => {
    const n = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return n[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
  };
  const eur = n => Number(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
  const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#2A2118">
    ${p.mensaje ? `<p>${escHtml(p.mensaje).replace(/\n/g, '<br>')}</p>` : ''}
    <p><b>Gastos de ${escHtml(periodo)} — La Flor de Cempazúchitl (NIF ${NIF_PROPIO})</b></p>
    <table cellpadding="4" style="border-collapse:collapse">
      <tr><td>Nº de gastos</td><td align="right">${gastos.length}</td></tr>
      <tr><td>Base imponible</td><td align="right">${eur(suma('base'))}</td></tr>
      <tr><td>IVA soportado</td><td align="right">${eur(suma('iva_importe'))}</td></tr>
      ${suma('retencion') ? `<tr><td>Retenciones IRPF</td><td align="right">${eur(suma('retencion'))}</td></tr>` : ''}
      <tr><td><b>Total</b></td><td align="right"><b>${eur(suma('total'))}</b></td></tr>
    </table>
    <p>Adjunto el detalle en Excel${facturasAdjuntas ? ' y las facturas escaneadas' : ''}.</p>
    ${carpetas.length ? `<p>Todas las facturas escaneadas, por meses:</p><ul>${carpetas.map(c => `<li><a href="${c.carpeta.getUrl()}">Facturas de ${nombreMes(c.mes)}</a></li>`).join('')}</ul>` : ''}
    ${pendientes ? `<p style="color:#B42318">Aviso: ${pendientes} gasto(s) del periodo están pendientes de revisar.</p>` : ''}
    ${sinArchivo ? `<p style="color:#6B5E52">${sinArchivo} gasto(s) no tienen factura escaneada (por ejemplo, gastos apuntados a mano).</p>` : ''}
    <p style="color:#6B5E52;font-size:12px">Enviado desde la app de gastos por ${escHtml(u.nombre)}.</p>
  </div>`;

  MailApp.sendEmail({
    to: email,
    subject: `Facturas ${periodo} — La Flor de Cempazúchitl`,
    htmlBody: html,
    name: 'La Flor de Cempazúchitl',
    attachments: adjuntos
  });

  PropertiesService.getScriptProperties().setProperty('GESTORIA_EMAIL', email);
  registrarEnvio_({ fecha: new Date(), periodo, email, n_gastos: gastos.length, total: suma('total'), enviado_por: u.nombre });
  return { enviado: true, facturasAdjuntas, carpetas: carpetas.length };
}

function registrarEnvio_(fila) {
  const libro = libro_();
  let hoja = libro.getSheetByName('Envios');
  const cols = ['fecha', 'periodo', 'email', 'n_gastos', 'total', 'enviado_por'];
  if (!hoja) {
    hoja = libro.insertSheet('Envios');
    hoja.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#FBF7F2');
    hoja.setFrozenRows(1);
  }
  hoja.appendRow(cols.map(c => fila[c]));
}
