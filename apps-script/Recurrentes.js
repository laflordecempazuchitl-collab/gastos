// Gastos que se repiten cada mes (alquiler...). Se apuntan solos como "por revisar"
// para que luego se adjunte el recibo.

// Lo ejecuta Google cada día a las 6:00 (lo programa "configurar").
function apuntarRecurrentes() {
  const hoy = new Date();
  const mes = Utilities.formatDate(hoy, ZONA, 'yyyy-MM');
  const diaHoy = Number(Utilities.formatDate(hoy, ZONA, 'd'));
  const [a, m] = mes.split('-').map(Number);
  const ultimoDia = new Date(a, m, 0).getDate();

  conBloqueo_(() => {
    const proveedores = leer_('Proveedores');
    leer_('Recurrentes').forEach(r => {
      if (!esVerdad_(r.activo) || r.ultimo_mes === mes) return;
      const dia = Math.min(Math.max(Number(r.dia_del_mes) || 1, 1), ultimoDia);
      if (diaHoy < dia) return;
      const prov = proveedores.find(p => String(p.id) === String(r.proveedor_id));
      const base = numero_(r.base);
      const pct = r.iva_pct === '' ? '' : Number(r.iva_pct);
      const ahora = new Date();
      insertar_('Gastos', {
        id: nuevoId_(),
        fecha: mes + '-' + String(dia).padStart(2, '0'),
        proveedor_id: prov ? prov.id : '',
        proveedor_nombre: prov ? prov.nombre : '',
        nif: prov ? prov.nif : '',
        categoria: r.categoria,
        num_factura: '',
        base,
        iva_pct: pct,
        iva_importe: base !== '' && pct !== '' ? r2_(base * pct / 100) : '',
        retencion: numero_(r.retencion) || 0,
        total: numero_(r.importe),
        estado: 'por_revisar',
        archivo_url: '', archivo_id: '',
        origen: 'recurrente',
        nota: r.concepto,
        recurrente_id: r.id,
        creado_por: 'sistema',
        creado_en: ahora, modificado_en: ahora, ocr_texto: ''
      });
      actualizar_('Recurrentes', r.id, { ultimo_mes: mes });
    });
  });
}

function guardarRecurrente_(u, p) {
  soloDueno_(u);
  const d = p.recurrente || {};
  const concepto = String(d.concepto || '').trim();
  if (!concepto) throw new Error('Falta el concepto.');
  if (!categoriaValida_(d.categoria)) throw new Error('Elige una categoría.');
  const importe = numero_(d.importe);
  if (importe === '') throw new Error('Falta el importe.');
  const dia = Number(d.dia_del_mes);
  if (!(dia >= 1 && dia <= 31)) throw new Error('El día del mes tiene que estar entre 1 y 31.');
  const cambios = {
    concepto, proveedor_id: d.proveedor_id || '', categoria: d.categoria,
    base: numero_(d.base), iva_pct: d.iva_pct === '' || d.iva_pct === undefined ? '' : Number(d.iva_pct),
    retencion: numero_(d.retencion) || 0, importe, dia_del_mes: dia, activo: d.activo !== false
  };
  const r = conBloqueo_(() => d.id
    ? actualizar_('Recurrentes', d.id, cambios)
    : insertar_('Recurrentes', Object.assign({ id: nuevoId_(), ultimo_mes: '' }, cambios)));
  delete r._fila;
  return { recurrente: r };
}
