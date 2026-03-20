import { readFileSync } from 'fs';
import { read, utils } from 'xlsx';

const fileBuffer = readFileSync('./Frecuencias.xlsx');
const wb = read(fileBuffer, { type: 'buffer' });
const ws = wb.Sheets['Vibraciones'];
const rows = utils.sheet_to_json(ws, { header: 1 });

console.log('--- Matches in Excel ---');
rows.forEach(row => {
    const rowString = JSON.stringify(row).toLowerCase();
    if (rowString.includes('tiro') && rowString.includes('forzado')) {
        console.log(`Row: ${JSON.stringify(row[3])} | KKS: ${row[1]} | Ubicación: ${row[2]}`);
    }
});
