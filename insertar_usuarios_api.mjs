import { SUPABASE_URL, SUPABASE_KEY } from './supabase-env.mjs';
const url = `${SUPABASE_URL}/rest/v1/trabajadores`;
const key = SUPABASE_KEY;

const datos = [
    {
        nombre: 'Jose Araya',
        puesto: 'Técnico Lubricación',
        habilidades: ['Lubricación', 'Cambios de aceite'],
        disponible: false,
        ocupado: false
    },
    {
        nombre: 'Eduardo Tapia',
        puesto: 'Técnico Lubricación',
        habilidades: ['Lubricación', 'Balanceo', 'Cambios de aceite'],
        disponible: false,
        ocupado: false
    },
    {
        nombre: 'Octavio Navarrete',
        puesto: 'Administrador de Contrato - Analista',
        habilidades: ['END (Tintas penetrantes)', 'Medición de vibraciones', 'Termografía', 'Medición de espesores', 'Medición de dureza', 'Lubricación'],
        disponible: false,
        ocupado: false
    }
];

async function insertarUsuarios() {
    try {
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
        if (!fetch) {
          console.error("Fetch is not available in your Node version. Upgrading Node might be necessary.");
          return;
        }

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'apikey': key,
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(datos)
        });

        if (res.ok) {
            console.log("¡Usuarios insertados correctamente en la base de datos!");
        } else {
            console.error("Error al insertar:", await res.text());
        }
    } catch (error) {
        console.error("Error ejecutando fetch:", error);
    }
}

insertarUsuarios();
