import { readFileSync } from 'fs';
import { read, utils } from 'xlsx';

const fileBuffer = readFileSync('./Frecuencias.xlsx');
const wb = read(fileBuffer, { type: 'buffer' });
const ws = wb.Sheets['Vibraciones'];
const rows = utils.sheet_to_json(ws, { header: 1 });

const results = rows.filter(row => {
    const rowString = JSON.stringify(row).toLowerCase();
    return rowString.includes('tiro') && rowString.includes('forzado');
});

console.log(`Found ${results.length} specific matches in Excel:`);
results.forEach(row => console.log(JSON.stringify(row)));
