(function () {
    'use strict';
    const core = window.ExcitatrizOCR;
    const labels = { hum: 'Humedad (%)', tamb: 'Temperatura ambiente (°C)', gen: 'Generación (MW)', vcampo: 'V campo (V)', icampo: 'I campo (A)' };
    function target(panel, key) {
        if (labels[key]) return panel.querySelector(`#excu5-${key}`);
        const [pos, kind] = key.split(':');
        return [...panel.querySelectorAll('.escu5-row')].find(row => row.dataset.pos === pos)?.querySelector(`.escu5-${kind}`);
    }
    window.mountExcitatrizOCR = function (panel) {
        const box = document.createElement('section');
        box.style.cssText = 'padding:14px;border:1px solid #bfdbfe;border-radius:12px;background:#eff6ff;margin-bottom:16px';
        box.innerHTML = `<strong>Leer planilla desde una foto · Prueba inicial</strong>
            <p>Selecciona una foto JPG, PNG o WebP (máximo 8 MB). Al pulsar Leer imagen se enviará al proveedor configurado (Gemini por defecto) para transcribirla. Las lecturas se completarán directamente en las escobillas como borrador. Corrige allí lo que necesites antes de guardar.</p>
            <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Foto de planilla de excitatriz">
            <button type="button" class="btn btn-primary" data-read disabled>Leer imagen</button>
            <p role="status" aria-live="polite" data-status></p>
            <details hidden data-photo><summary>Ver / ampliar foto original</summary><div style="max-height:65vh;overflow:auto"><img alt="Planilla original para comprobar las lecturas" style="max-width:none;width:100%"></div><label>Ampliación <input type="range" min="100" max="300" value="100" aria-label="Ampliar foto"></label></details>
            <div data-review></div>`;
        panel.prepend(box);
        const fileInput = box.querySelector('[type=file]');
        const read = box.querySelector('[data-read]');
        const status = box.querySelector('[data-status]');
        const review = box.querySelector('[data-review]');
        const photo = box.querySelector('[data-photo]');
        const img = photo.querySelector('img');
        let image = null;
        let selection = 0;
        photo.querySelector('[type=range]').addEventListener('input', event => { img.style.width = `${event.target.value}%`; });
        fileInput.addEventListener('change', async () => {
            const version = ++selection;
            image = null;
            read.disabled = true;
            review.replaceChildren();
            photo.hidden = true;
            img.removeAttribute('src');
            const file = fileInput.files[0];
            if (!file) return;
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
                status.textContent = 'Selecciona una imagen JPG, PNG o WebP de hasta 8 MB.';
                return;
            }
            try {
                const data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('No se pudo abrir la imagen.'));
                    reader.readAsDataURL(file);
                });
                if (version !== selection || !panel.isConnected) return;
                image = data;
                img.src = data;
                photo.hidden = false;
                photo.open = true;
                read.disabled = false;
                status.textContent = 'Foto preparada. La lectura no guardará ni finalizará el trabajo.';
            } catch (error) { status.textContent = error.message; }
        });
        read.addEventListener('click', async () => {
            if (!image) return;
            read.disabled = true;
            fileInput.disabled = true;
            review.replaceChildren();
            status.textContent = 'Leyendo la imagen… Esto puede tardar hasta dos minutos.';
            try {
                const backend = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? '' : (window.PLANIFY_PDF_BACKEND || 'https://planify-backend-lfq3.onrender.com');
                const response = await fetch(`${backend}/api/excitatriz/leer-imagen`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image, unit: Number(panel.dataset.unidad) }), signal: AbortSignal.timeout(130000)
                });
                if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Actualiza o inicia el servidor de Planify para habilitar el lector.');
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'No se pudo leer la imagen.');
                if (!panel.isConnected) return;
                fillDraft(result);
            } catch (error) {
                if (panel.isConnected) status.textContent = error.name === 'TimeoutError' ? 'La lectura agotó el tiempo. Intenta nuevamente.' : error.message;
            } finally { read.disabled = false; fileInput.disabled = false; }
        });
        function fillDraft(result) {
            const cells = result.cells;
            let copied = 0, preserved = 0;
            let first = null;
            for (const cell of cells) {
                const input = target(panel, cell.key);
                if (!input) continue;
                const value = core.number(cell.value);
                if (input.value !== '') { preserved++; continue; }
                if (value === null) {
                    input.title = 'No se pudo leer: completa este dato consultando la foto.';
                    continue;
                }
                input.value = String(value);
                input.style.backgroundColor = '#fffbeb';
                input.title = 'Leído de la foto. Puedes corregirlo aquí.';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.addEventListener('input', () => {
                    input.style.backgroundColor = '';
                    input.title = 'Editado manualmente.';
                }, { once: true });
                if (!first) first = input;
                copied++;
            }
            const detected = cells.filter(cell => core.number(cell.value) !== null).length;
            status.textContent = copied + ' valores cargados como borrador en las escobillas. ' +
                detected + '/' + cells.length + ' detectados (' + Math.round(detected / cells.length * 100) + '% de cobertura). ' +
                (preserved ? preserved + ' campos existentes conservados. ' : '') +
                'Corrige directamente los campos amarillos y usa Guardar y terminar cuando estés listo. Aún no se ha guardado el trabajo.';
            photo.open = false;
            review.replaceChildren();
            first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };
})();
