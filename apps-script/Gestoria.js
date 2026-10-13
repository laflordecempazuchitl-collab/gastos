// Envío del informe y las facturas de un periodo a la gestoría.
// Se manda el Excel (generado en el móvil) y TODAS las facturas del periodo (PDF o foto) como adjuntos.
// Si no caben en un correo, se reparten en varios ("parte 1 de 3"...). No se comparte ninguna carpeta.

const MAX_CORREO_BYTES = 18 * 1024 * 1024;

function enviarGestoria_(u, p) {
  soloDueno_(u);
  const email = String(p.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('El correo de la gestoría no es válido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.desde || '') || !/^\d{4}-\d{2}-\d{2}$/.test(p.hasta || '')) throw new Error('Periodo no válido.');
  if (!p.excel || !p.excel.base64) throw new Error('Falta el informe.');
  const periodo = String(p.periodo || '').slice(0, 60);

  const gastos = leer_('Gastos').filter(g => g.estado !== 'anulado' && g.fecha >= p.desde && g.fecha <= p.hasta)
    .sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
  if (!gastos.length && !leer_('CierresZ').some(z => z.estado !== 'anulado' && z.fecha >= p.desde && z.fecha <= p.hasta)) throw new Error('No hay gastos ni cierres Z en ese periodo.');
  const conArchivo = gastos.filter(g => g.archivo_id);

  // Cada factura con un nombre claro: "2026-08-04 Proveedor Nº.pdf".
  const limpio = t => String(t || '').replace(/[\\/:*?"<>|]+/g, '-').trim();
  const usados = {};
  const facturas = [];
  const fallan = [];
  conArchivo.forEach(g => {
    try {
      const blob = DriveApp.getFileById(g.archivo_id).getBlob();
      const ext = (String(blob.getName()).match(/\.[a-z0-9]{2,5}$/i) || ['.' + (TIPOS_ARCHIVO[blob.getContentType()] || 'pdf')])[0].toLowerCase();
      let base = [g.fecha, limpio(g.proveedor_nombre) || 'Sin proveedor', limpio(g.num_factura)].filter(Boolean).join(' ').slice(0, 120);
      if (usados[base]) base += ' (' + (++usados[base]) + ')'; else usados[base] = 1;
      blob.setName(base + ext);
      facturas.push(blob);
    } catch (e) {
      console.error(e);
      fallan.push(g);
    }
  });

  // Cierres Z del periodo (ventas): también van adjuntos.
  const zs = leer_('CierresZ').filter(z => z.estado !== 'anulado' && z.fecha >= p.desde && z.fecha <= p.hasta)
    .sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
  zs.filter(z => z.archivo_id).forEach(z => {
    try {
      const blob = DriveApp.getFileById(z.archivo_id).getBlob();
      const ext = (String(blob.getName()).match(/\.[a-z0-9]{2,5}$/i) || ['.' + (TIPOS_ARCHIVO[blob.getContentType()] || 'pdf')])[0].toLowerCase();
      let base = 'Cierre Z ' + z.fecha + (z.num_z ? ' n' + z.num_z : '');
      if (usados[base]) base += ' (' + (++usados[base]) + ')'; else usados[base] = 1;
      blob.setName(base + ext);
      facturas.push(blob);
    } catch (e) {
      console.error(e);
    }
  });

  // Repartir en correos de hasta MAX_CORREO_BYTES (el Excel va en el primero).
  const excel = Utilities.newBlob(Utilities.base64Decode(p.excel.base64),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', p.excel.nombre || 'Gastos.xlsx');
  const tandas = [[excel]];
  let ocupado = excel.getBytes().length;
  facturas.forEach(b => {
    const t = b.getBytes().length;
    if (ocupado + t > MAX_CORREO_BYTES && tandas[tandas.length - 1].length) { tandas.push([]); ocupado = 0; }
    tandas[tandas.length - 1].push(b);
    ocupado += t;
  });

  const suma = k => r2_(gastos.reduce((s, g) => s + (Number(g[k]) || 0), 0));
  const pendientes = gastos.filter(g => g.estado === 'por_revisar').length;
  const sinArchivo = gastos.length - conArchivo.length;
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
    ${zs.length ? `<p><b>Ventas (cierres Z)</b></p>
    <table cellpadding="4" style="border-collapse:collapse">
      <tr><td>Nº de cierres Z</td><td align="right">${zs.length}</td></tr>
      ${TIPOS_DESGLOSE.map(t => { const b = r2_(zs.reduce((s2, z) => s2 + (Number(z['base_' + t]) || 0), 0)), i = r2_(zs.reduce((s2, z) => s2 + (Number(z['iva_' + t]) || 0), 0)); return b || i ? `<tr><td>Base ${t} % / IVA repercutido</td><td align="right">${eur(b)} / ${eur(i)}</td></tr>` : ''; }).join('')}
      <tr><td><b>Total ventas</b></td><td align="right"><b>${eur(r2_(zs.reduce((s2, z) => s2 + (Number(z.total) || 0), 0)))}</b></td></tr>
    </table>` : ''}
    <p>Adjunto el detalle en Excel y las ${facturas.length - zs.filter(z => z.archivo_id).length} facturas (PDF o foto)${zs.length ? ` y los ${zs.filter(z => z.archivo_id).length} tickets de cierre Z` : ''}${tandas.length > 1 ? `, repartidas en ${tandas.length} correos por tamaño` : ''}.</p>
    ${fallan.length ? `<p style="color:#B42318">No se pudo adjuntar el archivo de ${fallan.length} gasto(s): ${fallan.map(g => escHtml(g.fecha + ' ' + (g.proveedor_nombre || ''))).join(', ')}.</p>` : ''}
    ${pendientes ? `<p style="color:#B42318">Aviso: ${pendientes} gasto(s) del periodo están pendientes de revisar.</p>` : ''}
    ${sinArchivo ? `<p style="color:#6B5E52">${sinArchivo} gasto(s) no tienen factura escaneada (por ejemplo, gastos apuntados a mano).</p>` : ''}
    <p style="color:#6B5E52;font-size:12px">Enviado desde la app de gastos por ${escHtml(u.nombre)}.</p>
  </div>`;

  tandas.forEach((adjuntos, i) => {
    const parte = tandas.length > 1 ? ` (parte ${i + 1} de ${tandas.length})` : '';
    MailApp.sendEmail({
      to: email,
      subject: `Facturas ${periodo} — La Flor de Cempazúchitl${parte}`,
      htmlBody: i === 0 ? html : `<div style="font-family:Arial,sans-serif;font-size:14px">Facturas de ${escHtml(periodo)}${parte}. El resumen y el Excel van en el primer correo.</div>`,
      name: 'La Flor de Cempazúchitl',
      attachments: adjuntos
    });
  });

  PropertiesService.getScriptProperties().setProperty('GESTORIA_EMAIL', email);
  registrarEnvio_({ fecha: new Date(), periodo, email, n_gastos: gastos.length, total: suma('total'), enviado_por: u.nombre });
  return { enviado: true, facturasAdjuntas: true, facturas: facturas.length - zs.filter(z => z.archivo_id).length, cierresZ: zs.length, correos: tandas.length, sinAdjuntar: fallan.length };
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
