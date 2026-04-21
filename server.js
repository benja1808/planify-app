const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const requestedPort = Number(process.env.PORT || 4173);
const rootDir = __dirname;
const TEMP_DIR = path.join(__dirname, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

function resolvePath(urlPath) {
    const cleanPath = decodeURIComponent((urlPath || '/').split('?')[0]);
    const relativePath = cleanPath === '/' ? '/index.html' : cleanPath;
    const requestedPath = path.normalize(path.join(rootDir, relativePath));
    return requestedPath.startsWith(rootDir) ? requestedPath : null;
}

function getPythonCandidates() {
    const candidates = [];
    const explicitPython = process.env.PYTHON || process.env.PYTHON_PATH;

    if (explicitPython) {
        candidates.push(explicitPython);
    }

    if (process.platform === 'win32') {
        const localPrograms = process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python')
            : null;

        if (localPrograms && fs.existsSync(localPrograms)) {
            const installs = fs.readdirSync(localPrograms, { withFileTypes: true })
                .filter((entry) => entry.isDirectory() && /^Python\d+/i.test(entry.name))
                .map((entry) => path.join(localPrograms, entry.name, 'python.exe'))
                .filter((candidate) => fs.existsSync(candidate))
                .sort()
                .reverse();

            candidates.push(...installs);
        }

        candidates.push('py');
    }

    candidates.push('python', 'python3');
    return [...new Set(candidates.filter(Boolean))];
}

function runPython(scriptPath, inputFile, outputFile) {
    return new Promise((resolve, reject) => {
        const candidates = getPythonCandidates();

        function tryCmd(index) {
            if (index >= candidates.length) {
                reject(new Error(
                    'No se encontro una instalacion utilizable de Python. ' +
                    'Configura la variable PYTHON o agrega Python al PATH.'
                ));
                return;
            }

            const cmd = candidates[index];
            execFile(cmd, [scriptPath, inputFile, outputFile], { timeout: 60000 }, (err, stdout, stderr) => {
                if (!err) {
                    resolve({ stdout, stderr });
                } else {
                    const retryable = err.code === 'ENOENT' || err.code === 'EACCES';
                    if (retryable) {
                        tryCmd(index + 1);
                        return;
                    }

                    reject(new Error(stderr || err.message));
                }
            });
        }

        tryCmd(0);
    });
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    // CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Planify-Server', 'planner_app');

    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = requestUrl.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // POST /generar-pdf
    if (req.method === 'POST' && pathname === '/generar-pdf') {
        const ts = Date.now();
        const inputFile = path.join(TEMP_DIR, `input_pdf_${ts}.json`);
        const outputFile = path.join(TEMP_DIR, `output_pdf_${ts}.pdf`);
        const scriptPath = path.join(__dirname, 'generar_pdf.py');
        try {
            const data = await readBody(req);
            fs.writeFileSync(inputFile, JSON.stringify(data, null, 2), 'utf8');
            await runPython(scriptPath, inputFile, outputFile);
            const pdfBuffer = fs.readFileSync(outputFile);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ pdf: pdfBuffer.toString('base64') }));
        } catch (error) {
            console.error('[server] /generar-pdf error:', error.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        } finally {
            try { fs.unlinkSync(inputFile); } catch (_) {}
            try { fs.unlinkSync(outputFile); } catch (_) {}
        }
        return;
    }

    // POST /generar-excel
    if (req.method === 'POST' && pathname === '/generar-excel') {
        const ts = Date.now();
        const inputFile = path.join(TEMP_DIR, `input_xlsx_${ts}.json`);
        const outputFile = path.join(TEMP_DIR, `output_xlsx_${ts}.xlsx`);
        const scriptPath = path.join(__dirname, 'generar_excel.py');
        try {
            const data = await readBody(req);
            fs.writeFileSync(inputFile, JSON.stringify(data, null, 2), 'utf8');
            await runPython(scriptPath, inputFile, outputFile);
            const xlsxBuffer = fs.readFileSync(outputFile);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ xlsx: xlsxBuffer.toString('base64') }));
        } catch (error) {
            console.error('[server] /generar-excel error:', error.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        } finally {
            try { fs.unlinkSync(inputFile); } catch (_) {}
            try { fs.unlinkSync(outputFile); } catch (_) {}
        }
        return;
    }

    // Static files
    const filePath = resolvePath(pathname);
    if (!filePath) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error && error.code === 'ENOENT') {
            fs.readFile(path.join(rootDir, 'index.html'), (fallbackError, fallbackContent) => {
                if (fallbackError) {
                    res.writeHead(500);
                    res.end('Internal Server Error');
                    return;
                }
                res.writeHead(200, { 'Content-Type': mimeTypes['.html'] });
                res.end(fallbackContent);
            });
            return;
        }
        if (error) {
            res.writeHead(500);
            res.end('Internal Server Error');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(content);
    });
});

function listenWithFallback(port, attemptsRemaining = 10) {
    server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && !process.env.PORT && attemptsRemaining > 0) {
            const nextPort = port + 1;
            console.warn(`[server] Puerto ${port} ocupado. Reintentando en ${nextPort}...`);
            listenWithFallback(nextPort, attemptsRemaining - 1);
            return;
        }

        console.error(`[server] No se pudo iniciar en el puerto ${port}:`, error.message);
        process.exit(1);
    });

    server.listen(port, () => {
        const address = server.address();
        const activePort = typeof address === 'object' && address ? address.port : port;
        console.log(`Planner app running at http://localhost:${activePort}`);
        console.log(`PDF/Excel server integrated at http://localhost:${activePort}/generar-pdf`);
        if (activePort !== requestedPort) {
            console.log(`[server] Puerto solicitado ${requestedPort} ocupado; usando ${activePort}.`);
        }
    });
}

listenWithFallback(requestedPort);
