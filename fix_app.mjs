import fs from 'fs';

let content = fs.readFileSync('app.js', 'utf8');

content = content.replace(
    'sBtnAsig.disabled = !(sUbic.value && sEq.value && sEmpl.value);',
    'sBtnAsig.disabled = !(sUbic.value && sEq.value);'
);

content = content.replace(
    'sEmpl.innerHTML = `<option value="">-- Seleccione supervisor --</option>` + aptos.map(t => `<option value="${t.id}">${t.nombre}</option>`).join(\'\');\r\n            sHint.innerHTML = aptos.length > 0 ? `<span style="color:var(--success-color)">${aptos.length} aptos</span>` : `<span style="color:var(--danger-color)">Sin personal para esta tarea</span>`;',
    'sEmpl.innerHTML = `<option value="">-- Seleccione supervisor (Opcional) --</option>` + aptos.map(t => `<option value="${t.id}">${t.nombre}</option>`).join(\'\');\r\n            sHint.innerHTML = aptos.length > 0 ? `<span style="color:var(--success-color)">${aptos.length} aptos</span>` : `<span style="color:var(--warning-color)">Sin personal específico. Puede guardar igual.</span>`;'
);

content = content.replace(
    'sEmpl.innerHTML = `<option value="">-- Seleccione supervisor --</option>` + aptos.map(t => `<option value="${t.id}">${t.nombre}</option>`).join(\'\');\n            sHint.innerHTML = aptos.length > 0 ? `<span style="color:var(--success-color)">${aptos.length} aptos</span>` : `<span style="color:var(--danger-color)">Sin personal para esta tarea</span>`;',
    'sEmpl.innerHTML = `<option value="">-- Seleccione supervisor (Opcional) --</option>` + aptos.map(t => `<option value="${t.id}">${t.nombre}</option>`).join(\'\');\n            sHint.innerHTML = aptos.length > 0 ? `<span style="color:var(--success-color)">${aptos.length} aptos</span>` : `<span style="color:var(--warning-color)">Sin personal específico. Puede guardar igual.</span>`;'
);


content = content.replace(
    'asignarTarea(tit, sEmpl.value, ays, \'programada_semana\', sInputOt.value.trim().toUpperCase(), \'activo\', fechaExp, sEq.value, tiposSel, [], sUbic.value);',
    'asignarTarea(tit, sEmpl.value || null, ays, \'programada_semana\', sInputOt.value.trim().toUpperCase(), \'activo\', fechaExp, sEq.value, tiposSel, [], sUbic.value);'
);

fs.writeFileSync('app.js', content, 'utf8');
console.log('Replacements complete');
