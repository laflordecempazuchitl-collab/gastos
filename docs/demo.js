// Modo demostración (abrir la app con ?demo): datos inventados, sin servidor. Nada se guarda en Google.
window.DEMO = (function () {
  const hoy = new Date();
  const f = (desfaseMes, dia) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + desfaseMes, dia);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const categorias = [
    ['Carnes', 'proveedores'], ['Verduras', 'proveedores'], ['Tortillas', 'proveedores'], ['Insumos mexicanos', 'proveedores'],
    ['Lácteos', 'proveedores'], ['Bebidas', 'proveedores'],['Productos de aseo', 'proveedores'], ['Alquiler', 'fijos'], ['Suministros', 'fijos'],
    ['Reparaciones', 'varios'], ['Gestoría', 'varios'], ['Menaje', 'varios'], ['Otros', 'varios']
  ].map(([nombre, grupo]) => ({ nombre, grupo }));
  const proveedores = [
    { id: 'p1', nombre: 'Cárnicas Montserrat', nif: 'B65432109', categoria_habitual: 'Carnes', activo: true },
    { id: 'p2', nombre: 'Horta Fresca S.L.', nif: 'B12345674', categoria_habitual: 'Verduras', activo: true },
    { id: 'p3', nombre: 'Tortillería La Milpa', nif: 'B87654321', categoria_habitual: 'Tortillas', activo: true },
    { id: 'p4', nombre: 'Endesa', nif: 'A81948077', categoria_habitual: 'Suministros', activo: true }
  ];
  let n = 0;
  const g = (fecha, pid, cat, base, pct, extra) => {
    const p = proveedores.find(x => x.id === pid);
    const iva = Math.round(base * pct) / 100;
    return Object.assign({
      id: 'g' + (++n), fecha, proveedor_id: pid || '', proveedor_nombre: p ? p.nombre : '', nif: p ? p.nif : '', categoria: cat,
      num_factura: 'F-' + (1000 + n), base, iva_pct: pct, iva_importe: iva, retencion: 0, total: Math.round((base + iva) * 100) / 100,
      estado: 'confirmado', archivo_url: '', archivo_id: 'x', origen: 'foto', nota: '', recurrente_id: '', creado_por: 'u1', creado_en: fecha + 'T10:00'
    }, extra || {});
  };
  const gastos = [
    g(f(0, 1), '', 'Alquiler', 1500, 21, { retencion: 285, total: 1530, origen: 'recurrente', archivo_id: '', nota: 'Alquiler del local', num_factura: '', estado: 'por_revisar' }),
    g(f(0, 2), 'p1', 'Carnes', 412.3, 10), g(f(0, 3), 'p2', 'Verduras', 186.4, 4), g(f(0, 3), 'p3', 'Tortillas', 96, 4),
    g(f(0, 4), 'p4', 'Suministros', 310.5, 21), g(f(0, 4), '', 'Reparaciones', 120, 21, { nota: 'Arreglo cámara frigorífica', num_factura: '' }),
    g(f(0, 5), 'p2', 'Verduras', 92.1, 4, { estado: 'por_revisar' }),
    g(f(-1, 2), 'p1', 'Carnes', 1380, 10), g(f(-1, 5), 'p2', 'Verduras', 640, 4), g(f(-1, 1), '', 'Alquiler', 1500, 21, { retencion: 285, total: 1530, nota: 'Alquiler del local' }),
    g(f(-1, 12), 'p3', 'Tortillas', 310, 4), g(f(-1, 20), 'p4', 'Suministros', 402, 21), g(f(-1, 22), '', 'Gestoría', 150, 21, { retencion: 22.5, total: 159 })
  ];
  const usuario = { id: 'u1', nombre: 'Dueño (demo)', rol: 'dueno', activo: true };
  const datos = () => ({
    version: 'demo', usuario, categorias, gastos: gastos.map(x => Object.assign({}, x)), proveedores: proveedores.map(x => Object.assign({}, x)),
    recurrentes: [{ id: 'r1', concepto: 'Alquiler del local', proveedor_id: '', categoria: 'Alquiler', base: 1500, iva_pct: 21, retencion: 285, importe: 1530, dia_del_mes: 1, activo: true }],
    usuarios: [usuario, { id: 'u2', nombre: 'Lupita', rol: 'empleado', activo: true }]
  });
  const espera = ms => new Promise(r => setTimeout(r, ms));

  return async function api(accion, p) {
    await espera(accion === 'subir' ? 1500 : 250);
    switch (accion) {
      case 'inicio': return { ok: true, necesitaAlta: false, usuarios: [{ id: 'u1', nombre: 'Dueño (demo)' }, { id: 'u2', nombre: 'Lupita' }] };
      case 'login': if (p.pin !== '1234') throw new Error('PIN incorrecto. (En la demo es 1234)'); return { ok: true, token: 'demo', usuario };
      case 'datos': return Object.assign({ ok: true }, datos());
      case 'subir': {
        const nuevo = g(f(0, 5), '', '', 24.5, 4, { estado: 'por_revisar', proveedor_nombre: '', nif: '', num_factura: 'F2026-0815', archivo_url: '#', origen: p.origen });
        gastos.unshift(nuevo);
        return { ok: true, gasto: nuevo, leido: true, sugerencia: { nombre: 'DISTRIBUCIONES HORTA FRESCA S.L.', nif: 'B12345674' } };
      }
      case 'guardarGasto': {
        const d = p.gasto;
        const prov = proveedores.find(x => x.id === d.proveedor_id);
        let x = gastos.find(y => y.id === d.id);
        if (!x) { x = { id: 'g' + (++n), origen: 'manual', creado_en: f(0, 5) }; gastos.unshift(x); }
        Object.assign(x, d, { proveedor_nombre: prov ? prov.nombre : '', nif: prov ? prov.nif : '' });
        return { ok: true, gasto: Object.assign({}, x) };
      }
      case 'guardarProveedor': {
        const d = Object.assign({}, p.proveedor, { activo: p.proveedor.activo !== false });
        if (!d.id) { d.id = 'p' + (++n); proveedores.push(d); } else Object.assign(proveedores.find(x => x.id === d.id), d);
        return { ok: true, proveedor: d };
      }
      case 'guardarCategoria': {
        const c = { nombre: p.nombre.trim()[0].toUpperCase() + p.nombre.trim().slice(1), grupo: p.grupo || 'varios' };
        categorias.push(c);
        return { ok: true, categoria: c };
      }
      case 'guardarRecurrente': return { ok: true, recurrente: Object.assign({ id: 'r' + (++n) }, p.recurrente) };
      case 'guardarUsuario': return { ok: true, usuario: Object.assign({ id: 'u' + (++n) }, p.usuario, { pin: undefined }) };
      case 'descartar': case 'anular': {
        const i = gastos.findIndex(x => x.id === p.id);
        if (i >= 0) gastos.splice(i, 1);
        return { ok: true };
      }
      case 'adjuntar': {
        const x = gastos.find(y => y.id === p.id);
        Object.assign(x, { archivo_url: '#', archivo_id: 'x' });
        return { ok: true, gasto: Object.assign({}, x) };
      }
      default: return { ok: true };
    }
  };
})();
