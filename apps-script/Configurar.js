// Ejecutar UNA vez desde el editor (función "configurar").
// Crea la carpeta de Drive, la hoja de cálculo con sus pestañas y el aviso diario de los gastos recurrentes.
// Se puede volver a ejecutar sin peligro: solo crea lo que falte.

function configurar() {
  const props = PropertiesService.getScriptProperties();

  let carpeta;
  if (props.getProperty('CARPETA_ID')) {
    carpeta = DriveApp.getFolderById(props.getProperty('CARPETA_ID'));
  } else {
    carpeta = DriveApp.createFolder('Gastos — La Flor de Cempazúchitl');
    props.setProperty('CARPETA_ID', carpeta.getId());
  }
  if (!props.getProperty('FACTURAS_ID')) {
    props.setProperty('FACTURAS_ID', carpeta.createFolder('Facturas').getId());
  }
  if (!props.getProperty('TEMPORAL_ID')) {
    props.setProperty('TEMPORAL_ID', carpeta.createFolder('Temporal (lectura de facturas)').getId());
  }

  let libro;
  if (props.getProperty('HOJA_ID')) {
    libro = SpreadsheetApp.openById(props.getProperty('HOJA_ID'));
  } else {
    libro = SpreadsheetApp.create('Gastos — La Flor de Cempazúchitl');
    props.setProperty('HOJA_ID', libro.getId());
    DriveApp.getFileById(libro.getId()).moveTo(carpeta);
  }
  libro.setSpreadsheetLocale('es_ES');
  libro.setSpreadsheetTimeZone(ZONA);

  Object.keys(HOJAS).forEach(nombre => {
    const columnas = HOJAS[nombre];
    let hoja = libro.getSheetByName(nombre);
    if (!hoja) hoja = libro.insertSheet(nombre);
    hoja.getRange(1, 1, 1, columnas.length).setValues([columnas]).setFontWeight('bold').setBackground('#FBF7F2');
    hoja.setFrozenRows(1);
    columnas.forEach((col, i) => {
      const rango = hoja.getRange(2, i + 1, hoja.getMaxRows() - 1, 1);
      if (COLUMNAS_TEXTO.includes(col)) rango.setNumberFormat('@');
      else if (COLUMNAS_EUROS.includes(col)) rango.setNumberFormat('#,##0.00 €');
      else if (col === 'fecha') rango.setNumberFormat('dd/mm/yyyy');
      else if (col === 'creado_en' || col === 'modificado_en' || col === 'caduca') rango.setNumberFormat('dd/mm/yyyy hh:mm');
    });
  });
  // La hoja vacía que trae un libro nuevo.
  libro.getSheets().forEach(h => {
    if (!HOJAS[h.getName()] && h.getLastRow() === 0 && libro.getSheets().length > 1) libro.deleteSheet(h);
  });

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'apuntarRecurrentes')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('apuntarRecurrentes').timeBased().everyDays(1).atHour(6).inTimezone(ZONA).create();

  console.log('Carpeta: ' + carpeta.getUrl());
  console.log('Hoja: ' + libro.getUrl());
}
