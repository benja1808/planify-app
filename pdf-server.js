'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
const PORT = 3001;
const TEMP_DIR = path.join(__dirname, 'temp');

// Ensure temp dir exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// CORS headers
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.use(express.json({ limit: '10mb' }));

/**
 * Try python commands in order until one works.
 * Windows with Python installed via python.org uses 'py'.
 */
function runPython(scriptPath, inputFile, outputFile) {
    return new Promise((resolve, reject) => {
        const candidates = ['py', 'python', 'python3'];

        function tryNext(index) {
            if (index >= candidates.length) {
                reject(new Error(
                    'Python no encontrado. Instala Python desde python.org ' +
                    'y asegurate de marcar "Add Python to PATH".'
                ));
                return;
            }
            const cmd = candidates[index];
            execFile(cmd, [scriptPath, inputFile, outputFile], { timeout: 60000 }, (err, stdout, stderr) => {
                if (!err) {
                    resolve({ stdout, stderr });
                } else {
                    // Si el error es "not found" o similar, probar el siguiente
                    const msg = (err.message || '').toLowerCase();
                    const notFound = msg.includes('enoent') || msg.includes('not found') ||
                                    msg.includes('no such') || msg.includes('cannot find');
                    if (notFound) {
                        tryNext(index + 1);
                    } else {
                        // Error real de Python (crash del script, etc.)
                        reject(new Error(stderr || err.message));
                    }
                }
            });
        }

        tryNext(0);
    });
}

/**
 * POST /generar-pdf
 * Body: JSON payload
 * Returns: { pdf: "<base64>" }
 */
app.post('/generar-pdf', async (req, res) => {
    const ts = Date.now();
    const inputFile  = path.join(TEMP_DIR, `input_pdf_${ts}.json`);
    const outputFile = path.join(TEMP_DIR, `output_pdf_${ts}.pdf`);
    const scriptPath = path.join(__dirname, 'generar_pdf.py');

    try {
        const condicionRecibida = req.body?.distribucion?.condicion;
        console.log('[DEBUG] condicion recibida:', JSON.stringify(condicionRecibida, null, 2));
        fs.writeFileSync(inputFile, JSON.stringify(req.body, null, 2), 'utf8');
        const { stderr } = await runPython(scriptPath, inputFile, outputFile);
        if (stderr) console.warn('[pdf-server] Python stderr:', stderr);
        const base64 = fs.readFileSync(outputFile).toString('base64');
        res.json({ pdf: base64 });
    } catch (error) {
        console.error('[pdf-server] /generar-pdf error:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        try { fs.unlinkSync(inputFile);  } catch (_) {}
        try { fs.unlinkSync(outputFile); } catch (_) {}
    }
});

/**
 * POST /generar-excel
 * Body: JSON payload
 * Returns: { xlsx: "<base64>" }
 */
app.post('/generar-excel', async (req, res) => {
    const ts = Date.now();
    const inputFile  = path.join(TEMP_DIR, `input_xlsx_${ts}.json`);
    const outputFile = path.join(TEMP_DIR, `output_xlsx_${ts}.xlsx`);
    const scriptPath = path.join(__dirname, 'generar_excel.py');

    try {
        fs.writeFileSync(inputFile, JSON.stringify(req.body, null, 2), 'utf8');
        const { stderr } = await runPython(scriptPath, inputFile, outputFile);
        if (stderr) console.warn('[pdf-server] Python stderr:', stderr);
        const base64 = fs.readFileSync(outputFile).toString('base64');
        res.json({ xlsx: base64 });
    } catch (error) {
        console.error('[pdf-server] /generar-excel error:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        try { fs.unlinkSync(inputFile);  } catch (_) {}
        try { fs.unlinkSync(outputFile); } catch (_) {}
    }
});

app.listen(PORT, () => {
    console.log(`[pdf-server] Servidor corriendo en http://localhost:${PORT}`);
    console.log(`[pdf-server] Temp dir: ${TEMP_DIR}`);
});
