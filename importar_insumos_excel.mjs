import fs from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function normalizeUnit(value) {
  return normalizeText(value).includes('PAR') ? 'PARES' : 'UNI';
}

function getRowValue(row, aliases) {
  for (const alias of aliases) {
    const key = normalizeText(alias);
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return '';
}

function extractRows(workbook) {
  const sheetName = workbook.SheetNames.find((name) => normalizeText(name) === 'INVENTARIO') || workbook.SheetNames[0];
  if (!sheetName) throw new Error('No se encontro una hoja INVENTARIO en el archivo.');

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIndex = matrix.findIndex((row) => {
    const headers = row.map((cell) => normalizeText(cell));
    return headers.includes('CODIGO') && (headers.includes('PRODUCTO') || headers.includes('NOMBRE'));
  });

  if (headerIndex === -1) {
    throw new Error('No se encontro la cabecera esperada (CODIGO / PRODUCTO) en la hoja INVENTARIO.');
  }

  const headers = matrix[headerIndex].map((cell) => normalizeText(cell));
  return matrix
    .slice(headerIndex + 1)
    .map((row) => headers.reduce((acc, header, index) => {
      if (header) acc[header] = row[index];
      return acc;
    }, {}))
    .filter((row) => Object.values(row).some((value) => String(value || '').trim() !== ''));
}

function buildCatalog(rows) {
  return rows.map((row) => {
    const codigo = toInt(getRowValue(row, ['CODIGO', 'COD']));
    const nombre = String(getRowValue(row, ['PRODUCTO', 'NOMBRE', 'INSUMO']) || '').trim();
    if (!codigo || !nombre) return null;
    const stockInicial = toInt(getRowValue(row, ['STOCK INICIAL', 'STOCK', 'STOCK_INICIAL']));
    return {
      codigo,
      nombre,
      marca: String(getRowValue(row, ['MARCA']) || '').trim(),
      unidad: normalizeUnit(getRowValue(row, ['UNIDAD DE MEDIDA', 'UNIDAD', 'UNIDAD MEDIDA'])),
      stock_inicial: stockInicial,
      stock_actual: stockInicial,
      activo: true,
    };
  }).filter(Boolean);
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || path.join(process.cwd(), 'temp', 'insumos_catalogo.json');

  if (!inputPath) {
    console.error('Uso: node importar_insumos_excel.mjs "<ruta al excel>" [salida.json]');
    process.exit(1);
  }

  const workbook = XLSX.readFile(inputPath);
  const rows = extractRows(workbook);
  const catalog = buildCatalog(rows);

  if (!catalog.length) {
    throw new Error('No se pudieron construir insumos validos desde el Excel.');
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(catalog, null, 2), 'utf8');

  console.log(`Catalogo generado: ${catalog.length} item(s)`);
  console.log(`Salida: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
