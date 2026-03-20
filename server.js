const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT || 4173);
const rootDir = __dirname;

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

http.createServer((req, res) => {
    const filePath = resolvePath(req.url);
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
}).listen(port, () => {
    console.log(`Planner app running at http://localhost:${port}`);
});
