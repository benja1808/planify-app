import { readFileSync } from 'fs';
import { read, utils } from 'xlsx';

const fileBuffer = readFileSync('./Frecuencias.xlsx');
const wb = read(fileBuffer, { type: 'buffer' });
const ws = wb.Sheets['Vibraciones'];
const rows = utils.sheet_to_json(ws, { header: 1 });

const equipos = rows.slice(1)
    .filter(row => row[3]);

console.log(`Total equipos en Excel (Vibraciones): ${equipos.length}`);
