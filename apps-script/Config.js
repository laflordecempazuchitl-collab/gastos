// Configuración general de la app de gastos de La Flor de Cempazúchitl.

const VERSION = '1.0.0';
const ZONA = 'Europe/Madrid';
const NIF_PROPIO = 'Z1020236F';
const DIAS_SESION = 90;

// Grupos: proveedores (compras), fijos y varios.
const CATEGORIAS = [
  { nombre: 'Carnes', grupo: 'proveedores' },
  { nombre: 'Verduras', grupo: 'proveedores' },
  { nombre: 'Tortillas', grupo: 'proveedores' },
  { nombre: 'Insumos mexicanos', grupo: 'proveedores' },
  { nombre: 'Lácteos', grupo: 'proveedores' },
  { nombre: 'Bebidas', grupo: 'proveedores' },
  { nombre: 'Productos de aseo', grupo: 'proveedores' },
  { nombre: 'Alquiler', grupo: 'fijos' },
  { nombre: 'Suministros', grupo: 'fijos' },
  { nombre: 'Reparaciones', grupo: 'varios' },
  { nombre: 'Gestoría', grupo: 'varios' },
  { nombre: 'Menaje', grupo: 'varios' },
  { nombre: 'Otros', grupo: 'varios' }
];

// Palabras que ayudan a adivinar la categoría cuando el proveedor es nuevo.
const PALABRAS_CATEGORIA = [
  [/carnic|carne|embutid|charcut|pollo|aviar|cerdo|vacuno/i, 'Carnes'],
  [/fruta|verdur|hortaliz|fruits|verdures|horta/i, 'Verduras'],
  [/tortill|nixtamal|ma[ií]z/i, 'Tortillas'],
  [/chile|chipotle|jalape|salsa|mexic|tomatillo|frijol/i, 'Insumos mexicanos'],
  [/l[aá]cte|leche|queso|yogur|nata|mantequilla/i, 'Lácteos'],
  [/cervez|cerveza|bebida|refresco|vino|licor|destilad|damm|mahou|moritz|heineken|coca.?cola|pepsi|agua mineral|font vella|tequila|mezcal/i, 'Bebidas'],
  [/limpie|higien|aseo|detergente|lej[ií]a|celulosa|papel/i, 'Productos de aseo'],
  [/alquiler|arrendamiento|lloguer|renta/i, 'Alquiler'],
  [/endesa|iberdrola|naturgy|repsol|holaluz|aig[uü]es|agua|aigua|electric|gas natural|movistar|vodafone|orange|digi|fibra|internet|telef[oó]nica/i, 'Suministros'],
  [/gestor|asesor|contabil|abogad/i, 'Gestoría'],
  [/repara|t[eé]cnico|mantenimiento|fontaner|electricista|cerrajer/i, 'Reparaciones'],
  [/menaje|vajilla|cuberter|utensil|hosteler[ií]a/i, 'Menaje']
];

const HOJAS = {
  Gastos: ['id', 'fecha', 'proveedor_id', 'proveedor_nombre', 'nif', 'categoria', 'num_factura',
    'base', 'iva_pct', 'iva_importe', 'retencion', 'total', 'estado', 'archivo_url', 'archivo_id',
    'origen', 'nota', 'recurrente_id', 'creado_por', 'creado_en', 'modificado_en', 'ocr_texto'],
  Proveedores: ['id', 'nombre', 'nif', 'categoria_habitual', 'activo', 'creado_en'],
  Recurrentes: ['id', 'concepto', 'proveedor_id', 'categoria', 'base', 'iva_pct', 'retencion',
    'importe', 'dia_del_mes', 'activo', 'ultimo_mes'],
  Usuarios: ['id', 'nombre', 'rol', 'activo', 'pin_hash', 'sal', 'creado_en'],
  Sesiones: ['token_hash', 'usuario_id', 'caduca', 'creado_en']
};

// Columnas que deben guardarse como texto (para que Sheets no las convierta en números).
const COLUMNAS_TEXTO = ['id', 'proveedor_id', 'nif', 'num_factura', 'archivo_id', 'recurrente_id',
  'creado_por', 'usuario_id', 'token_hash', 'pin_hash', 'sal', 'ultimo_mes'];
const COLUMNAS_EUROS = ['base', 'iva_importe', 'retencion', 'total', 'importe'];

function prop_(clave) {
  return PropertiesService.getScriptProperties().getProperty(clave);
}
