# -*- coding: utf-8 -*-
# ============================================================================
# Generador de aceites_equipos.js (datos de lubricantes por equipo)
# ----------------------------------------------------------------------------
# Regla de mapeo: cargar el aceite en el equipo NORMAL/canonico (kks GUA#,
# ruta R.VENT, ubicacion "Unidad N") y solo caer al duplicado de ruta de
# lubricacion (kks 2893-...) si el canonico no existe para esa unidad.
#
# Kit de regeneracion (al recibir mas unidades / mas filas del Excel):
#   1) node _dump_app.mjs        -> refresca _app_equipos.json (equipos reales + origen)
#   2) extraer Excel a _aceites_raw.json: { "U4":[{"nombre","aceite","cantidad"}...], ...}
#   3) ajustar resolve()/familias si aparecen equipos nuevos sin match
#   4) python _gen_aceites.py    -> reescribe aceites_equipos.js + reporte de cobertura
# ============================================================================
import json, re, unicodedata, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

raw = json.load(open('_aceites_raw.json', encoding='utf-8'))
app = json.load(open('_app_equipos.json', encoding='utf-8'))

def deac(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s)) if unicodedata.category(c) != 'Mn')

# clave laxa: sin acentos, mayus, solo alfanumerico -> para EMPAREJAR el activo real
def loose(s):
    return re.sub(r'[^A-Z0-9]', '', deac(s).upper())

# indices por unidad: canonico (preferido) y todos -> activo real
canon_loose, all_loose = {}, {}
for e in app:
    u = e['unidad']
    lk = loose(e['activo'])
    all_loose.setdefault(u, {}).setdefault(lk, e['activo'])
    if e['origen'] == 'canon':
        canon_loose.setdefault(u, {}).setdefault(lk, e['activo'])

def find_actual(u, candidate):
    lk = loose(candidate)
    if lk in canon_loose.get(u, {}): return canon_loose[u][lk]
    if lk in all_loose.get(u, {}):  return all_loose[u][lk]
    return None

def first_actual(u, cands):
    for c in cands:
        a = find_actual(u, c)
        if a: return a
    return None

STOP = {'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'A'}

def parte_from(name, family_regex):
    n = deac(name).upper()
    n = re.sub(family_regex, '', n, count=1)
    n = re.sub(r'\b[1-5]\s*-?\s*[A-D]\b', ' ', n)   # unidad-letra
    n = re.sub(r'\b[A-D]\b', ' ', n)
    n = re.sub(r'\bN\s*[º°ª]?\s*\d+\b', ' ', n)
    n = n.replace('(', ' ').replace(')', ' ')
    n = re.sub(r'[.,]', ' ', n)
    n = re.sub(r'^DE\s+', '', n.strip())
    n = re.sub(r'\s+', ' ', n).strip()
    return n

def letter(name, d):
    up = deac(name).upper()
    m = re.search(r'%s\s*-?\s*([A-D])\b' % d, up)
    if m: return m.group(1)
    m = re.search(r'-\s*([A-D])\b', up)
    return m.group(1) if m else ''

def resolve(u, name):
    d = u[1]
    N = deac(name).upper().strip()
    L = letter(name, d)

    # ---- familias que NO se mapean (sin equipo equivalente claro) ----
    if 'MONORRIEL' in N: return None, None
    if 'MAKE-UP' in N or 'MAKE UP' in N: return None, None
    if 'PLANTA DESALADORA' in N or 'DESALADORA' in N: return None, None
    if 'DESBLOQUEADOR' in N: return None, None
    if 'SOPLADOR' in N: return None, None
    if 'DESCARGADOR DE POLVO' in N: return None, None
    if 'TRANSPORTADOR TRIPPER' in N: return None, None
    if re.search(r'BOMBA (HIDRAZINA|FOSFATO|SULFATO|AGENTE|DOSIFICAD)', N): return None, None
    if 'VACIO CENIZA' in N or 'FLUIDIZACION' in N: return None, None

    # ---- VENTILADORES (canonico = nombre normal por unidad) ----
    if 'TIRO FORZADO' in N:
        return first_actual(u, ['VENTILADOR TIRO FORZADO', f'VENTILADOR TIRO FORZADO VTF U{d}']), r'VENTILADOR TIRO FORZADO'
    if 'AIRE PRIMARIO' in N:
        return first_actual(u, ['VENTILADOR AIRE PRIMARIO', f'VENTILADOR AIRE PRIMARIO VAP U{d}']), r'VENTILADOR AIRE PRIMARIO'
    if re.search(r'RECIRCUL|GASES', N):
        return first_actual(u, ['VENTILADOR RECIRCULADOR DE GASES', f'VENTILADOR GASES RECIRCULACION VRG U{d}']), r'VENTIL\w*\.? *RECIRCUL\w*\.? *(DE )?GASES'
    if 'TIRO INDUCIDO' in N:
        return first_actual(u, ['VENTILADOR TIRO INDUCIDO', f'VENTILADOR TIRO INDUCIDO VTI U{d}', f'UNIDAD VENTILADOR VTI U{d}']), r'VENTILADOR TIRO INDUCIDO'
    if 'AIRE SELLO' in N:
        return first_actual(u, [f'VENTILADOR AIRE SELLO {L}', f'VENTILADOR AIRE SELLO VAS -{d}{L}']), r'VENTILADOR AIRE SELLO'

    # ---- PULVERIZADOR / MOLINO (antes sin match) ----
    if 'PULVERIZADOR' in N:
        return first_actual(u, [f'MOLINO PULVERIZADOR DE CARBON {d}{L}']), r'(REDUCTOR\s+)?PULVERIZADOR'
    # ---- ALIMENTADOR DE CARBON (antes sin match) ----
    if re.search(r'ALIM\w*\.?\s*CARBON', N):
        return first_actual(u, [f'ALIMENTADOR DE CARBON {d}{L}']), r'ALIM\w*\.?\s*CARBON'

    # ---- BOMBAS ----
    if re.match(r'BOMBA AGUA ALIMENTAC', N):
        return first_actual(u, [f'BBA AGUA ALIMENTACION {L}', f'BOMBA AGUA ALIMENTACION -{d}{L}', f'BOMBA AGUA ALIMENTACION -{L}']), r'BOMBA AGUA ALIMENTAC\w*'
    if re.match(r'BOMBA (DE )?CONDENSADO', N):
        return first_actual(u, [f'BBA AGUA CONDENSADO {d}{L}', f'BOMBA AGUA CONDENSADA -{d}{L}']), r'BOMBA (DE )?CONDENSADO'
    if re.match(r'BOMBA CIRCULAC', N):
        return first_actual(u, [f'BBA CIRCULACION PPLL {d}{L}', f'BOMBA CIRCULACION PRINCIPAL -{d}{L}']), r'BOMBA CIRCULAC\w*( PPLL)?'
    if re.match(r'BOMBA BOOSTER', N):
        return first_actual(u, [f'BBA BOOSTER {L}', f'BOMBA BOOSTER -{d}{L}']), r'BOMBA BOOSTER'
    if re.match(r'BOMBA AGUA ENFRIAMIENTO', N):
        return first_actual(u, [f'BBA ENFRIAMIENTO {L}', f'BOMBA AGUA ENFRIAMIENTO -{d}{L}']), r'BOMBA AGUA ENFRIAMIENTO'
    if re.match(r'BOMBA DRENAJE', N):
        return (first_actual(u, ['BOMBA DRENAJE ESCORIA -A']) if L == 'A' else None), r'BOMBA DRENAJE'
    if re.match(r'BOMBA LAVADO REJA', N):
        return first_actual(u, [f'BOMBA -{L} LAVADO REJA MOVIL U{d}']), r'BOMBA LAVADO REJA'

    # ---- OTROS ----
    if 'CALENTADOR DE AIRE' in N:
        return first_actual(u, [f'CALENTADOR AIRE REGENERATIVO U{d}', 'CALENTADOR AIRE REGENERATIVO']), r'CALENTADOR DE AIRE'
    if 'CADENA SUMER' in N:
        return first_actual(u, [f'CADENA SUMERGIDA U{d}', 'CADENA SUMERGIDA']), r'CADENA SUMER\w*'
    if 'TRITURADOR DE ESCORIA' in N:
        return first_actual(u, [f'TRITURADOR DE ESCORIA U{d}']), r'TRITURADOR DE ESCORIA'
    if re.search(r'TRANSPORTADOR\s+ESCORIA', N):
        num = '1' if re.search(r'N\s*[º°]?\s*1|N.1', N) else ('2' if re.search(r'N\s*[º°]?\s*2|N.2', N) else '')
        if not num: return None, None
        return first_actual(u, [f'CORREA {num} DE ESCORIAS U{d}', f'CORREA TRANSPORTADORA -{num} ESCORIA U{d}']), r'TRANSPORTADOR\s+ESCORIA( N\s*[º°]?\s*\d)?'
    if 'FILTRO DEBRIS' in N:
        return first_actual(u, ['FILTRO DEBRIS']), r'FILTRO DEBRIS'
    if re.match(r'PURIFICADOR', N):
        return first_actual(u, ['PURIFICADOR ACEITE MAV21AT201', 'PURIFICADOR ACEITE']), r'PURIFICADOR DE? ?ACEITE'
    if re.match(r'VTI\s*\(? *RETROFIT', N):
        return first_actual(u, [f'UNIDAD VENTILADOR VTI U{d}']), r'VTI\s*\(? *RETROFIT *\)?'
    if 'REJA FIJA' in N:
        return first_actual(u, ['TAMBOR REJA FIJA']), r'REJA FIJA'
    return None, None

out, report = {}, {'matched': [], 'unmatched': []}
for u in ['U4', 'U2', 'U1']:
    out[u] = {}
    for row in raw[u]:
        name = row['nombre']; aceite = row['aceite'].strip(); cant = row['cantidad'].strip()
        if not aceite and not cant:
            report['unmatched'].append((u, name, '(sin aceite en excel)')); continue
        a, fam = resolve(u, name)
        if not a:
            report['unmatched'].append((u, name, aceite)); continue
        parte = parte_from(name, fam) if fam else ''
        out[u].setdefault(a, []).append({'parte': parte, 'aceite': aceite, 'cantidad': cant})
        es_canon = loose(a) in canon_loose.get(u, {})
        report['matched'].append((u, name, '->', a, ('canon' if es_canon else '2893'), ('['+parte+']' if parte else ''), aceite, cant))

# dedupe
for u in out:
    for a in out[u]:
        seen, ded = set(), []
        for x in out[u][a]:
            k = (x['parte'], x['aceite'], x['cantidad'])
            if k in seen: continue
            seen.add(k); ded.append(x)
        out[u][a] = ded

# ---- emitir aceites_equipos.js ----
def jstr(s): return json.dumps(s, ensure_ascii=False)
L = []
L.append('// ============================================================================')
L.append('// Lubricantes / aceites por equipo  ·  GENERADO AUTOMATICAMENTE — no editar a mano.')
L.append('// Fuente: "Copia de PLANILLA_ACEITES-EQUIPOS(1).xlsx" (hojas UNIDAD 4 / 2 / 1).')
L.append('// El aceite se carga en el equipo NORMAL/canonico (no en el duplicado de ruta 2893).')
L.append('// Estructura: PLANIFY_ACEITES.data[unidad][ACTIVO] = [{parte, aceite, cantidad}, ...]')
L.append('// Regenerar con _gen_aceites.py al recibir mas unidades.')
L.append('// ============================================================================')
L.append('(function () {')
L.append('  const DATA = {')
for u in ['U4', 'U2', 'U1']:
    L.append('    %s: {' % jstr(u))
    for a in sorted(out[u].keys()):
        parts = ', '.join('{ parte: %s, aceite: %s, cantidad: %s }' % (jstr(x['parte']), jstr(x['aceite']), jstr(x['cantidad'])) for x in out[u][a])
        L.append('      %s: [ %s ],' % (jstr(a), parts))
    L.append('    },')
L.append('  };')
L.append('')
L.append("  const norm = s => String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().replace(/\\s+/g, ' ').trim();")
L.append('  const IDX = {};')
L.append('  for (const u in DATA) { IDX[u] = {}; for (const a in DATA[u]) IDX[u][norm(a)] = DATA[u][a]; }')
L.append('')
L.append('  // Detecta la unidad del equipo: 2893-N (rutas) | GUA-N (kks normal) | "Unidad N" / "U N".')
L.append('  function unidadDe(equipo) {')
L.append('    if (!equipo) return null;')
L.append("    const s = `${equipo.kks || ''} ${equipo.denominacion_ut || ''} ${equipo.ubicacion_tecnica || ''}`;")
L.append("    let m = s.match(/2893-(\\d)/); if (m && m[1] >= '1' && m[1] <= '5') return 'U' + m[1];")
L.append("    m = String(equipo.kks || '').match(/GUA(\\d)/i); if (m && m[1] >= '1' && m[1] <= '5') return 'U' + m[1];")
L.append("    m = String(equipo.ubicacion || '').match(/UNIDAD\\s*([1-5])/i); if (m) return 'U' + m[1];")
L.append("    m = String(equipo.ubicacion || '').match(/\\bU\\s*([1-5])\\b/i); if (m) return 'U' + m[1];")
L.append('    return null;')
L.append('  }')
L.append('')
L.append('  window.PLANIFY_ACEITES = {')
L.append('    data: DATA,')
L.append('    unidadDe,')
L.append('    // Devuelve [{parte, aceite, cantidad}, ...] para un equipo, o null si no hay datos.')
L.append('    get(equipo) {')
L.append('      const u = unidadDe(equipo); if (!u || !IDX[u]) return null;')
L.append('      const lub = IDX[u][norm(equipo.activo)];')
L.append('      return (lub && lub.length) ? lub : null;')
L.append('    }')
L.append('  };')
L.append('})();')
L.append('')
open('aceites_equipos.js', 'w', encoding='utf-8').write('\n'.join(L))

print('aceites_equipos.js escrito.  Activos cubiertos:', {u: len(out[u]) for u in out})
print('\n== MATCHED (%d) ==' % len(report['matched']))
for r in report['matched']: print('  ', ' '.join(r))
print('\n== UNMATCHED / SKIPPED (%d) ==' % len(report['unmatched']))
for r in report['unmatched']: print('  ', ' | '.join(r))
