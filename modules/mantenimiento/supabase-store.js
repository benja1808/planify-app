/* Separate Supabase Auth session: does not alter Planify's existing anonymous client. */
(() => {
    'use strict';
    let client, direct, projectUrl, publicKey;
    const bucket = () => client.storage.from('mantenimiento');
    function unwrap(result) { if (result.error) throw result.error; return result.data; }
    async function rows(table) {
        const result = [];
        for (let offset = 0; ; offset += 500) {
            const page = unwrap(await client.from(table).select('*').order('id').range(offset, offset + 499));
            result.push(...page);
            if (page.length < 500) return result;
        }
    }
    const mapEquipment = e => ({...e, sourceId:e.source_id});
    const mapJob = j => ({...j, equipmentId:j.equipment_id});
    const api = {
        configure(url, key) {
            projectUrl = url; publicKey = key;
            if (!direct) direct = window.supabase.createClient(url,key,{auth:{storageKey:'planify-maintenance-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
            if (!client) client = direct;
        },
        async session() {
            let saved;
            try { saved = JSON.parse(localStorage.getItem('planify_session') || 'null'); } catch (_) {}
            let {data} = await direct.auth.getSession();
            if (saved?.token && ['admin','administrador'].includes(saved.rol || saved.role) && !data.session?.user.app_metadata?.maintenance_planner_session) {
                await api.signInPlanner(saved.token);
                ({data} = await direct.auth.getSession());
            }
            if (data.session) {
                client=direct;
                const role = data.session.user.app_metadata?.maintenance_role;
                return {id:data.session.user.id,role:['admin','administrador'].includes(role) ? role : 'trabajador'};
            }
            if (!['localhost','127.0.0.1','[::1]'].includes(location.hostname)) return null;
            const response = await fetch('/api/maintenance/session', {credentials:'same-origin',cache:'no-store'});
            if (response.status === 401) return null;
            if (!response.ok) throw new Error('Inicia Planify con el servidor de Mantenimiento.');
            client = window.supabase.createClient(location.origin + '/api/maintenance/supabase', publicKey, {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>fetch(url,{...options,credentials:'same-origin'})}});
            return response.json();
        },
        async signInWorker(rut,pin) {
            await direct.auth.signOut({scope:'local'});
            const response=await fetch(projectUrl+'/functions/v1/maintenance-login',{method:'POST',headers:{'Content-Type':'application/json',apikey:publicKey},body:JSON.stringify({rut,pin})});
            const result=await response.json();
            if (!response.ok) throw new Error(result.message || 'No se pudo validar el acceso.');
            const {error}=await direct.auth.setSession(result);
            if(error) throw error;
            client=direct;
        },
        async signInPlanner(token) {
            const response = await fetch(projectUrl+'/functions/v1/maintenance-planner-login',{method:'POST',headers:{'Content-Type':'application/json',apikey:publicKey},body:JSON.stringify({token})});
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'No se pudo abrir Mantenimiento.');
            const {error} = await direct.auth.setSession(result);
            if (error) throw error;
            client=direct;
        },
        async equipmentState(id) {
            return unwrap(await client.from('mantenimiento_equipos').select('id,is_open').eq('id',id).single());
        },
        async signIn(role,pin) {
            const response = await fetch('/api/maintenance/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,pin})});
            let result; try { result = await response.json(); } catch { throw new Error('El servidor local de Mantenimiento no está disponible.'); }
            if (!response.ok) throw new Error(result.message || 'No se pudo validar el PIN.');
            return result;
        },
        async signOut() { if(direct) await direct.auth.signOut(); if(['localhost','127.0.0.1','[::1]'].includes(location.hostname)) await fetch('/api/maintenance/logout',{method:'POST'}); client=direct; },
        async usage() { return unwrap(await client.rpc('mantenimiento_consumo')); },
        async load(equipmentId) {
            const [equipment, jobs, usage] = await Promise.all([rows('mantenimiento_equipos'),rows('mantenimiento_trabajos'),api.usage()]);
            const currentJobs = jobs.filter(j => j.equipment_id === equipmentId && j.status === 'ready');
            for (const job of currentJobs) {
                if (!job.photos.length) continue;
                const signed = unwrap(await bucket().createSignedUrls(job.photos.map(p=>p.path),900));
                job.photos = job.photos.map((p,i) => ({...p,url:signed[i]?.signedUrl || ''}));
            }
            return {equipment:equipment.map(mapEquipment),jobs:jobs.map(mapJob),usage};
        },
        async addEquipment(entry) {
            const payload = {id:entry.id,name:entry.name,unit:entry.unit,kks:entry.kks,source_id:entry.sourceId || null};
            const result = await client.from('mantenimiento_equipos').insert(payload).select().single();
            if (result.error?.code === '23505') {
                const existing = (await rows('mantenimiento_equipos')).find(e => e.source_id && e.source_id === payload.source_id || e.unit === payload.unit && e.name.trim().toLowerCase() === payload.name.trim().toLowerCase());
                if (existing) return mapEquipment(existing);
            }
            return mapEquipment(unwrap(result));
        },
        async setEquipmentOpen(id, open) {
            return mapEquipment(unwrap(await client.from('mantenimiento_equipos').update({is_open:open}).eq('id',id).select().single()));
        },
        async saveJob(job, onProgress) {
            const photos = job.photos.map((p,i) => ({name:p.name,size:p.blob.size,mime:p.blob.type,path:`${job.id}/${i}-${crypto.randomUUID()}.${{'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[p.blob.type]}`}));
            unwrap(await client.rpc('mantenimiento_reservar',{payload:{id:job.id,equipment_id:job.equipmentId,category:job.category,title:job.title,work:job.work,photos}}));
            try {
                for (let i=0;i<photos.length;i++) {
                    onProgress?.(`Subiendo fotografía ${i+1} de ${photos.length}…`);
                    unwrap(await bucket().upload(photos[i].path,job.photos[i].blob,{contentType:photos[i].mime,upsert:false}));
                }
                unwrap(await client.from('mantenimiento_trabajos').update({status:'ready'}).eq('id',job.id).select().single());
            } catch (error) {
                // Keep the manifest when cleanup fails, so deletion can be retried.
                try { await api.deleteJob({id:job.id,photos}); }
                catch (_) { throw new Error(`${error.message}. Quedó una carga incompleta; recarga y elimínala para liberar su reserva.`); }
                throw error;
            }
        },
        async deleteJob(job) {
            unwrap(await client.from('mantenimiento_trabajos').update({status:'deleting'}).eq('id',job.id));
            if (job.photos.length) unwrap(await bucket().remove(job.photos.map(p=>p.path)));
            unwrap(await client.from('mantenimiento_trabajos').delete().eq('id',job.id));
        },
        async photoBlob(photo) { return unwrap(await bucket().download(photo.path)); }
    };
    window.MaintenanceCloud = api;
})();
