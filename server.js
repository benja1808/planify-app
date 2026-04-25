const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

let webpush = null;
try {
    webpush = require('web-push');
} catch (_) {
    webpush = null;
}

const requestedPort = Number(process.env.PORT || 4173);
const rootDir = __dirname;
const TEMP_DIR = path.join(__dirname, 'temp');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fygvulgffhxrimaeyoep.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_YOksHoWnkBBt74lnKFqc8g_XyP3EyQF';
const supabaseServer = createClient(SUPABASE_URL, SUPABASE_KEY);
const PUSH_POLL_MS = Number(process.env.PUSH_POLL_MS || 30000);

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function readPushConfig() {
    const configPath = path.join(rootDir, 'push-config.json');
    let fileConfig = {};
    if (fs.existsSync(configPath)) {
        try {
            fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            console.warn('[push] No se pudo leer push-config.json:', error.message);
        }
    }

    return {
        publicKey: process.env.VAPID_PUBLIC_KEY || fileConfig.publicKey || '',
        privateKey: process.env.VAPID_PRIVATE_KEY || fileConfig.privateKey || '',
        subject: process.env.VAPID_SUBJECT || fileConfig.subject || 'mailto:admin@planify.local'
    };
}

const pushConfig = readPushConfig();
const pushReady = Boolean(webpush && pushConfig.publicKey && pushConfig.privateKey);
if (pushReady) {
    webpush.setVapidDetails(pushConfig.subject, pushConfig.publicKey, pushConfig.privateKey);
} else {
    console.warn('[push] Push remoto desactivado. Falta web-push o claves VAPID.');
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

function writeJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

function normalizarTareaPush(t = {}) {
    return {
        id: String(t.id || ''),
        tipo: t.tipo || 'Trabajo',
        liderId: t.lider_id || t.liderId || null,
        liderNombre: t.lider_nombre || t.liderNombre || '',
        ayudantesIds: t.ayudantes_ids || t.ayudantesIds || [],
        estadoTarea: t.estado_tarea || t.estadoTarea || '',
        estadoEjecucion: t.estado_ejecucion || t.estadoEjecucion || 'activo',
        otNumero: t.ot_numero || t.otNumero || '',
        ubicacion: t.ubicacion || '',
        fechaExpiracion: t.fecha_expiracion || t.fechaExpiracion || ''
    };
}

function tareaActivaPush(tarea) {
    const estadoTarea = String(tarea.estadoTarea || '').toLowerCase();
    const estadoEjecucion = String(tarea.estadoEjecucion || 'activo').toLowerCase();
    if (estadoEjecucion === 'finalizado' || estadoEjecucion === 'cerrado') return false;
    return ['en_curso', 'programada_semana', 'pendiente', 'programada'].includes(estadoTarea);
}

function describirTareaPush(tarea) {
    return [
        tarea.otNumero ? `OT ${tarea.otNumero}` : '',
        tarea.tipo || 'Trabajo',
        tarea.ubicacion || ''
    ].filter(Boolean).join(' - ');
}

function subscriptionParaTarea(subscription, tarea) {
    if (subscription.role === 'admin') return true;
    if (subscription.role !== 'trabajador' || !subscription.trabajador_id) return false;
    const trabajadorId = String(subscription.trabajador_id);
    return String(tarea.liderId || '') === trabajadorId ||
        (tarea.ayudantesIds || []).some((id) => String(id) === trabajadorId);
}

function subscriptionParaTrabajador(subscription, trabajadorId) {
    if (!trabajadorId) return false;
    return subscription.role === 'trabajador' && String(subscription.trabajador_id || '') === String(trabajadorId);
}

async function listarPushSubscriptions() {
    const { data, error } = await supabaseServer
        .from('push_subscriptions')
        .select('id, endpoint, subscription, role, trabajador_id, enabled')
        .eq('enabled', true);
    if (error) {
        if (['42P01', 'PGRST205'].includes(error.code)) {
            console.warn('[push] Falta tabla push_subscriptions. Ejecuta la migracion 20260425090000_push_notifications.sql.');
            return [];
        }
        throw error;
    }
    return data || [];
}

async function desactivarPushSubscription(id) {
    if (!id) return;
    await supabaseServer
        .from('push_subscriptions')
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .catch(() => {});
}

async function enviarPushASuscripcion(row, payload) {
    if (!pushReady || !row?.subscription) return false;
    try {
        await webpush.sendNotification(row.subscription, JSON.stringify(payload), { TTL: 60 * 60 * 6 });
        return true;
    } catch (error) {
        const status = Number(error.statusCode || error.status || 0);
        if (status === 404 || status === 410) await desactivarPushSubscription(row.id);
        console.warn('[push] Error enviando push:', status || error.message);
        return false;
    }
}

async function enviarPushAFiltro(subscriptions, predicate, payload) {
    const destinatarios = subscriptions.filter(predicate);
    await Promise.allSettled(destinatarios.map((row) => enviarPushASuscripcion(row, payload)));
    return destinatarios.length;
}

const pushState = {
    initialized: false,
    inFlight: false,
    tareas: new Map(),
    horasExtra: new Map(),
    solicitudesInsumos: new Map()
};

async function obtenerPushSnapshot() {
    const [tareasRes, heRes, insumosRes] = await Promise.all([
        supabaseServer.from('tareas').select('*'),
        Promise.resolve(
            supabaseServer.from('horas_extra').select('*').order('created_at', { ascending: false }).limit(200)
        ).catch(() => ({ data: [] })),
        Promise.resolve(
            supabaseServer.from('solicitudes_insumos').select('*').order('created_at', { ascending: false }).limit(200)
        ).catch(() => ({ data: [] }))
    ]);

    return {
        tareas: (tareasRes.data || []).map(normalizarTareaPush),
        horasExtra: heRes.data || [],
        solicitudesInsumos: insumosRes.data || []
    };
}

function aplicarPushBaseline(snapshot) {
    pushState.tareas = new Map(snapshot.tareas.map((tarea) => [String(tarea.id), tarea]));
    pushState.horasExtra = new Map(snapshot.horasExtra.map((item) => [String(item.id), String(item.estado || 'pendiente')]));
    pushState.solicitudesInsumos = new Map(snapshot.solicitudesInsumos.map((item) => [String(item.id), String(item.estado || 'pendiente')]));
    pushState.initialized = true;
}

async function revisarCambiosPush() {
    if (!pushReady || pushState.inFlight) return;
    pushState.inFlight = true;
    try {
        const snapshot = await obtenerPushSnapshot();
        if (!pushState.initialized) {
            aplicarPushBaseline(snapshot);
            return;
        }

        const subscriptions = await listarPushSubscriptions();
        if (!subscriptions.length) {
            aplicarPushBaseline(snapshot);
            return;
        }

        for (const tarea of snapshot.tareas) {
            const anterior = pushState.tareas.get(String(tarea.id));
            if (!anterior && tareaActivaPush(tarea)) {
                await enviarPushAFiltro(
                    subscriptions,
                    (subscription) => subscriptionParaTarea(subscription, tarea),
                    {
                        title: 'Nuevo trabajo asignado',
                        body: describirTareaPush(tarea),
                        tag: `planify-task-${tarea.id}`,
                        url: './index.html'
                    }
                );
            }
        }

        for (const registro of snapshot.horasExtra) {
            const id = String(registro.id);
            const anterior = pushState.horasExtra.get(id);
            const actual = String(registro.estado || 'pendiente');
            if (anterior === 'pendiente' && actual !== 'pendiente') {
                await enviarPushAFiltro(
                    subscriptions,
                    (subscription) => subscriptionParaTrabajador(subscription, registro.trabajador_id),
                    {
                        title: actual === 'aprobado' ? 'Horas extra aprobadas' : 'Horas extra rechazadas',
                        body: `${registro.fecha || ''} - ${registro.horas || 0} hora(s).`,
                        tag: `planify-he-${id}`,
                        url: './index.html'
                    }
                );
            }
        }

        for (const solicitud of snapshot.solicitudesInsumos) {
            const id = String(solicitud.id);
            const anterior = pushState.solicitudesInsumos.get(id);
            const actual = String(solicitud.estado || 'pendiente');
            if (anterior === 'pendiente' && actual !== 'pendiente') {
                await enviarPushAFiltro(
                    subscriptions,
                    (subscription) => subscriptionParaTrabajador(subscription, solicitud.trabajador_id),
                    {
                        title: actual === 'aprobada' ? 'Solicitud de insumo aprobada' : 'Solicitud de insumo rechazada',
                        body: solicitud.insumo_nombre || 'Solicitud de insumo actualizada.',
                        tag: `planify-insumo-${id}`,
                        url: './index.html'
                    }
                );
            }
        }

        aplicarPushBaseline(snapshot);
    } catch (error) {
        console.warn('[push] No se pudieron revisar cambios:', error.message);
    } finally {
        pushState.inFlight = false;
    }
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

    if (req.method === 'GET' && pathname === '/push/vapid-public-key') {
        writeJson(res, pushReady ? 200 : 503, {
            enabled: pushReady,
            publicKey: pushReady ? pushConfig.publicKey : '',
            message: pushReady ? 'Push remoto disponible' : 'Push remoto no configurado'
        });
        return;
    }

    if (req.method === 'GET' && pathname === '/push/status') {
        writeJson(res, 200, {
            enabled: pushReady,
            initialized: pushState.initialized,
            pollMs: PUSH_POLL_MS
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/push/subscribe') {
        try {
            if (!pushReady) {
                writeJson(res, 503, { ok: false, error: 'Push remoto no configurado' });
                return;
            }
            const body = await readBody(req);
            if (!body?.subscription?.endpoint) {
                writeJson(res, 400, { ok: false, error: 'Suscripcion invalida' });
                return;
            }
            const payload = {
                endpoint: body.subscription.endpoint,
                subscription: body.subscription,
                role: body.role || 'visita',
                trabajador_id: body.trabajadorId || null,
                trabajador_nombre: body.trabajadorNombre || null,
                user_agent: body.userAgent || req.headers['user-agent'] || null,
                enabled: true,
                updated_at: new Date().toISOString()
            };
            const { error } = await supabaseServer
                .from('push_subscriptions')
                .upsert(payload, { onConflict: 'endpoint' });
            if (error) throw error;
            writeJson(res, 200, { ok: true });
        } catch (error) {
            writeJson(res, 500, { ok: false, error: error.message });
        }
        return;
    }

    if (req.method === 'POST' && pathname === '/push/unsubscribe') {
        try {
            const body = await readBody(req);
            const endpoint = body?.endpoint || body?.subscription?.endpoint;
            if (endpoint) {
                await supabaseServer
                    .from('push_subscriptions')
                    .update({ enabled: false, updated_at: new Date().toISOString() })
                    .eq('endpoint', endpoint);
            }
            writeJson(res, 200, { ok: true });
        } catch (error) {
            writeJson(res, 500, { ok: false, error: error.message });
        }
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
        if (pushReady) {
            revisarCambiosPush();
            setInterval(revisarCambiosPush, PUSH_POLL_MS);
            console.log(`[push] Push remoto activo. Revisando cambios cada ${PUSH_POLL_MS} ms.`);
        }
    });
}

listenWithFallback(requestedPort);
