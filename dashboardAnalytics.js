(function() {
    if (window.__dashboardAnalyticsLoaded) return;
    window.__dashboardAnalyticsLoaded = true;
    if (!window.__analyticsDrawerEscBound) {
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && typeof window.__closeAnalyticsDrawer === 'function') {
                window.__closeAnalyticsDrawer();
            }
        });
        window.__analyticsDrawerEscBound = true;
    }
    if (!window.__analyticsDrawerClickGuardBound) {
        document.addEventListener('click', event => {
            const root = document.getElementById('analytics-detail-root');
            if (!root || !root.classList.contains('is-open')) return;
            const drawer = root.querySelector('.analytics-detail-drawer');
            if (drawer && drawer.contains(event.target)) return;
            if (typeof window.__closeAnalyticsDrawer === 'function') window.__closeAnalyticsDrawer();
        }, true);
        window.__analyticsDrawerClickGuardBound = true;
    }
    if (!window.__analyticsPrintCleanupBound) {
        window.addEventListener('afterprint', () => {
            document.body.classList.remove('analytics-print-mode');
            document.body.classList.remove('analytics-print-equipment-mode');
            document.getElementById('analytics-equipment-print-shell')?.remove();
        });
        window.__analyticsPrintCleanupBound = true;
    }

    const charts = [];
    const TYPE_COLORS = {
        Vibraciones: '#f97316',
        Termografia: '#fb923c',
        Lubricacion: '#94a3b8',
        END: '#64748b',
        Espesores: '#f59e0b',
        Dureza: '#475569',
        Otros: '#cbd5e1'
    };

    function injectStyles() {
        if (document.getElementById('dashboard-analytics-styles')) return;
        const style = document.createElement('style');
        style.id = 'dashboard-analytics-styles';
        style.textContent = `
.analytics-dashboard{display:grid;gap:1rem;padding-bottom:.35rem}
.analytics-panel{padding:1.15rem;position:relative;overflow:hidden}
.analytics-panel--hero{padding:1.35rem;background:linear-gradient(145deg,#fff8ef 0%,#ffffff 56%,#f8fafc 100%);border-color:rgba(249,115,22,.14);box-shadow:0 22px 50px rgba(249,115,22,.08)}
.analytics-panel--hero:before{content:"";position:absolute;inset:auto auto -100px -80px;width:240px;height:240px;border-radius:999px;background:radial-gradient(circle,rgba(249,115,22,.14),rgba(249,115,22,0));pointer-events:none}
.analytics-panel--hero:after{content:"";position:absolute;top:-80px;right:-40px;width:220px;height:220px;border-radius:999px;background:radial-gradient(circle,rgba(148,163,184,.14),rgba(148,163,184,0));pointer-events:none}
.analytics-hero-top,.analytics-toolbar,.analytics-hero-strip,.analytics-specialty-row{position:relative;z-index:1}
.analytics-hero-top{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:1rem}
.analytics-eyebrow{font-size:.74rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#ea580c;margin-bottom:.45rem}
.analytics-title{margin:0;font-size:1.95rem;display:flex;align-items:center;gap:.65rem;letter-spacing:-.03em}
.analytics-title i{color:#f97316}
.analytics-subtitle{margin:.5rem 0 0;color:var(--text-muted);max-width:700px;line-height:1.55}
.analytics-range-summary{display:flex;flex-direction:column;align-items:flex-end;gap:.15rem;padding:1rem 1.1rem;border-radius:18px;background:rgba(255,255,255,.84);border:1px solid rgba(15,23,42,.08);font-size:.86rem;color:var(--text-muted);min-width:220px;box-shadow:0 12px 26px rgba(15,23,42,.06)}
.analytics-range-summary strong{font-size:1.3rem;line-height:1;color:var(--text-main)}
.analytics-toolbar{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap}
.analytics-presets{display:flex;gap:.55rem;flex-wrap:wrap}
.analytics-preset{border:1px solid rgba(148,163,184,.35);background:#fff;color:#475569;border-radius:999px;padding:.6rem 1rem;font-size:.82rem;font-weight:700;cursor:pointer;transition:all .2s ease;box-shadow:0 4px 18px rgba(15,23,42,.04)}
.analytics-preset:hover{transform:translateY(-1px);border-color:rgba(249,115,22,.35);color:#9a3412;background:#fff7ed}
.analytics-preset.is-active{background:#f97316;color:#fff;border-color:#f97316;box-shadow:0 12px 30px rgba(249,115,22,.22)}
.analytics-date-fields{display:flex;gap:.75rem;flex-wrap:wrap}
.analytics-date-fields label{display:flex;flex-direction:column;gap:.3rem;font-size:.78rem;font-weight:700;color:#64748b}
.analytics-date-fields input{min-width:150px}
.analytics-toolbar-actions{display:flex;gap:.6rem;flex-wrap:wrap}
.analytics-toolbar-btn{border:1px solid rgba(148,163,184,.28);background:#fff;color:#334155;border-radius:999px;padding:.6rem .95rem;font-size:.8rem;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:.5rem;box-shadow:0 8px 20px rgba(15,23,42,.05);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease,background-color .18s ease,color .18s ease}
.analytics-toolbar-btn:hover{transform:translateY(-1px);box-shadow:0 14px 24px rgba(15,23,42,.08);border-color:rgba(249,115,22,.34);color:#9a3412;background:#fff7ed}
.analytics-range-compare{display:inline-flex;align-items:center;gap:.42rem;padding:.38rem .65rem;border-radius:999px;background:#eff6ff;border:1px solid rgba(59,130,246,.14);color:#1d4ed8;font-size:.76rem;font-weight:800;line-height:1.2;max-width:100%;text-align:right}
.analytics-range-compare.is-positive{background:#ecfdf5;border-color:rgba(5,150,105,.18);color:#047857}
.analytics-range-compare.is-negative{background:#fff7ed;border-color:rgba(217,119,6,.22);color:#b45309}
.analytics-range-compare.is-neutral{background:#f8fafc;border-color:rgba(148,163,184,.18);color:#475569}
.analytics-specialty-row{display:flex;gap:.55rem;flex-wrap:wrap;margin-top:1rem}
.analytics-specialty-pill{--analytics-accent:#64748b;--analytics-accent-soft:rgba(148,163,184,.14);--analytics-accent-border:rgba(148,163,184,.24);display:inline-flex;align-items:center;gap:.5rem;padding:.45rem .7rem;border-radius:999px;background:linear-gradient(135deg,var(--analytics-accent-soft),rgba(255,255,255,.96));border:1px solid var(--analytics-accent-border);font-size:.78rem;font-weight:700;color:#334155;font-family:inherit;appearance:none}
.analytics-specialty-pill strong{font-size:.76rem;color:var(--analytics-accent)}
.analytics-specialty-pill.is-muted{color:#64748b}
.analytics-specialty-swatch{width:9px;height:9px;border-radius:999px;flex-shrink:0}
.analytics-hero-strip{display:grid;grid-template-columns:1.4fr repeat(3,minmax(0,1fr));gap:.9rem;margin-top:1rem}
.analytics-hero-callout,.analytics-hero-card{border-radius:20px;padding:1rem 1.05rem;min-height:138px}
.analytics-hero-callout{background:linear-gradient(135deg,#0f172a,#334155);color:#fff;box-shadow:0 18px 34px rgba(15,23,42,.16)}
.analytics-hero-card{background:rgba(255,255,255,.86);border:1px solid rgba(148,163,184,.18);box-shadow:0 12px 24px rgba(15,23,42,.05)}
.analytics-hero-label{display:block;font-size:.74rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.78}
.analytics-hero-callout .analytics-hero-label{color:rgba(255,255,255,.72)}
.analytics-hero-value{display:block;margin-top:.55rem;font-size:clamp(1.35rem,2.8vw,1.8rem);font-weight:900;line-height:1.12;letter-spacing:-.03em;overflow-wrap:anywhere}
.analytics-hero-card .analytics-hero-value{font-size:clamp(1.1rem,2.3vw,1.35rem);color:#0f172a}
.analytics-hero-meta{display:block;margin-top:.55rem;font-size:.86rem;line-height:1.45;color:var(--text-muted)}
.analytics-hero-status-row{display:flex;align-items:flex-start;justify-content:space-between;gap:.8rem;margin-top:.55rem}
.analytics-hero-status-row .analytics-hero-value{margin-top:0}
.analytics-hero-callout .analytics-hero-meta{color:rgba(255,255,255,.82)}
.analytics-kpi-sections{display:grid;gap:1rem}
.analytics-section-block{display:grid;gap:.85rem}
.analytics-section-headline{display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;padding:0 .2rem}
.analytics-section-headline h3{margin:0;font-size:1rem;font-weight:900;color:#0f172a;letter-spacing:-.02em}
.analytics-section-headline span{font-size:.82rem;color:#64748b;line-height:1.45}
.analytics-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem}
.analytics-kpi-card{--kpi-accent:#94a3b8;--kpi-accent-soft:rgba(148,163,184,.12);--kpi-accent-border:rgba(148,163,184,.2);background:#fff;border:1px solid rgba(15,23,42,.08);border-radius:20px;padding:1rem 1.05rem;display:flex;flex-direction:column;gap:.55rem;min-height:156px;box-shadow:0 12px 30px rgba(15,23,42,.04)}
.analytics-kpi-top{display:flex;justify-content:space-between;align-items:flex-start;gap:.75rem}
.analytics-kpi-icon{width:42px;height:42px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;background:#fff7ed;color:#c2410c;box-shadow:inset 0 0 0 1px rgba(249,115,22,.08)}
.analytics-kpi-card.tone-orange{background:linear-gradient(135deg,#ff9b31,#f97316);color:#fff;border-color:transparent}
.analytics-kpi-card.tone-teal{background:linear-gradient(135deg,#2dd4bf,#0f766e);color:#fff;border-color:transparent}
.analytics-kpi-card.tone-emerald{background:linear-gradient(135deg,#5eead4,#10b981);color:#06281f;border-color:transparent}
.analytics-kpi-card.tone-slate{background:linear-gradient(135deg,#1f2937,#334155);color:#fff;border-color:transparent}
.analytics-kpi-card.tone-orange .analytics-kpi-icon,.analytics-kpi-card.tone-teal .analytics-kpi-icon,.analytics-kpi-card.tone-emerald .analytics-kpi-icon,.analytics-kpi-card.tone-slate .analytics-kpi-icon{background:rgba(255,255,255,.16);color:inherit;box-shadow:none}
.analytics-kpi-label{font-size:.78rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;opacity:.86}
.analytics-kpi-value{font-size:clamp(1.45rem,3vw,2rem);line-height:1.1;font-weight:900;word-break:break-word;letter-spacing:-.03em;overflow-wrap:anywhere}
.analytics-kpi-meta{font-size:.83rem;opacity:.9;line-height:1.45}
.analytics-kpi-foot{margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between;gap:.8rem}
.analytics-kpi-insights{display:flex;flex-wrap:wrap;gap:.45rem;align-items:flex-start}
.analytics-kpi-spark{display:block;flex:0 0 132px;width:132px;height:34px;opacity:.95}
.analytics-kpi-spark svg{display:block;width:100%;height:100%}
.analytics-kpi-trend{display:inline-flex;align-items:center;gap:.42rem;padding:.36rem .62rem;border-radius:999px;background:var(--kpi-accent-soft);border:1px solid var(--kpi-accent-border);color:var(--kpi-accent);font-size:.73rem;font-weight:800;line-height:1.1;white-space:nowrap}
.analytics-kpi-trend.is-flat{color:#475569}
.analytics-kpi-card.tone-orange .analytics-kpi-trend,.analytics-kpi-card.tone-teal .analytics-kpi-trend,.analytics-kpi-card.tone-slate .analytics-kpi-trend{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.22);color:#fff}
.analytics-kpi-card.tone-emerald .analytics-kpi-trend{background:rgba(255,255,255,.22);border-color:rgba(6,40,31,.14);color:#06281f}
.analytics-compare-badge{display:inline-flex;align-items:center;gap:.42rem;padding:.36rem .62rem;border-radius:999px;font-size:.73rem;font-weight:800;line-height:1.1;white-space:nowrap;border:1px solid rgba(148,163,184,.18);background:#f8fafc;color:#475569}
.analytics-compare-badge.is-positive{background:#ecfdf5;border-color:#a7f3d0;color:#047857}
.analytics-compare-badge.is-negative{background:#fef2f2;border-color:#fecaca;color:#b91c1c}
.analytics-compare-badge.is-neutral{background:#f8fafc;border-color:rgba(148,163,184,.18);color:#475569}
.analytics-kpi-card.tone-orange .analytics-compare-badge,.analytics-kpi-card.tone-teal .analytics-compare-badge,.analytics-kpi-card.tone-slate .analytics-compare-badge{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.22);color:#fff}
.analytics-kpi-card.tone-emerald .analytics-compare-badge{background:rgba(255,255,255,.24);border-color:rgba(6,40,31,.12);color:#06281f}
.analytics-alert-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem}
.analytics-alert-card{display:flex;flex-direction:column;gap:.55rem;padding:1rem 1.05rem;border-radius:20px;border:1px solid rgba(148,163,184,.18);background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(248,250,252,.95));box-shadow:0 12px 28px rgba(15,23,42,.04)}
.analytics-alert-card.is-normal{background:linear-gradient(180deg,rgba(236,253,245,.98),rgba(255,255,255,.94));border-color:rgba(5,150,105,.18)}
.analytics-alert-card.is-watch{background:linear-gradient(180deg,rgba(255,247,237,.98),rgba(255,255,255,.94));border-color:rgba(217,119,6,.2)}
.analytics-alert-card.is-critical{background:linear-gradient(180deg,rgba(254,242,242,.98),rgba(255,255,255,.94));border-color:rgba(220,38,38,.2)}
.analytics-alert-label{display:inline-flex;align-items:center;gap:.45rem;font-size:.74rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
.analytics-alert-value{font-size:clamp(1.2rem,2.4vw,1.7rem);line-height:1.12;font-weight:900;color:#0f172a;letter-spacing:-.03em;overflow-wrap:anywhere}
.analytics-alert-meta{font-size:.84rem;color:#475569;line-height:1.52}
.analytics-alert-row{display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap}
.analytics-alert-list{display:grid;gap:.55rem}
.analytics-alert-item{display:flex;justify-content:space-between;gap:.8rem;align-items:flex-start;padding:.72rem .82rem;border-radius:14px;background:#fff;border:1px solid rgba(148,163,184,.18)}
.analytics-alert-item strong{display:block;font-size:.88rem}
.analytics-alert-item span{display:block;font-size:.77rem;color:#64748b;line-height:1.45}
.analytics-alert-item > div:first-child{min-width:0;flex:1}
.analytics-print-report{display:none;gap:1rem;padding:1rem;border-radius:30px;background:linear-gradient(180deg,#fffaf4 0%,#f8fafc 100%)}
.analytics-print-header{display:grid;gap:1rem;padding:1.35rem 1.4rem;border-radius:28px;background:linear-gradient(180deg,#ffffff 0%,#fffaf4 100%);border:1px solid rgba(148,163,184,.2);color:#0f172a;box-shadow:0 22px 44px rgba(15,23,42,.08);position:relative;overflow:hidden}
.analytics-print-header:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:6px;background:linear-gradient(90deg,#f97316 0%,#fb923c 48%,#475569 100%)}
.analytics-print-brand{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.75fr);align-items:stretch;gap:1rem}
.analytics-print-mark{display:flex;align-items:center;gap:.75rem}
.analytics-print-mark-badge{width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,#f97316,#fb923c);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:1.1rem;box-shadow:0 16px 32px rgba(249,115,22,.28)}
.analytics-print-mark strong{display:block;font-size:1.45rem;line-height:1.05;letter-spacing:-.03em;color:#0f172a}
.analytics-print-mark span{display:block;font-size:.82rem;color:#64748b;line-height:1.45}
.analytics-print-meta{text-align:left;display:grid;align-content:center;gap:.32rem;font-size:.82rem;color:#64748b;padding:1rem 1.1rem;border-radius:22px;background:linear-gradient(135deg,#fff7ed,#ffffff 72%);border:1px solid rgba(249,115,22,.18);box-shadow:inset 0 0 0 1px rgba(255,255,255,.72)}
.analytics-print-meta strong{font-size:1.28rem;line-height:1.15;color:#0f172a;letter-spacing:-.03em}
.analytics-print-section{display:grid;gap:.8rem;padding:1rem 0}
.analytics-print-section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;padding-bottom:.45rem;border-bottom:1px solid rgba(148,163,184,.28)}
.analytics-print-section-head h2{margin:0;font-size:1rem;font-weight:800;color:#0f172a}
.analytics-print-section-head span{font-size:.8rem;color:#64748b}
.analytics-print-hero-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}
.analytics-print-hero-card{--print-hero-accent:#0f172a;--print-hero-accent-soft:rgba(15,23,42,.14);padding:1rem 1.05rem;border-radius:22px;background:linear-gradient(180deg,var(--print-hero-accent-soft),#ffffff 48%);color:#0f172a;display:grid;gap:.58rem;min-height:148px;box-shadow:0 16px 30px rgba(15,23,42,.06);border:1px solid rgba(226,232,240,.95);position:relative;overflow:hidden}
.analytics-print-hero-card:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:5px;background:linear-gradient(90deg,var(--print-hero-accent),transparent 84%)}
.analytics-print-hero-card:after{content:"";position:absolute;top:-36px;right:-30px;width:108px;height:108px;border-radius:999px;background:radial-gradient(circle,var(--print-hero-accent-soft),rgba(255,255,255,0) 72%);pointer-events:none}
.analytics-print-hero-top{display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem;position:relative;z-index:1}
.analytics-print-hero-top > div:first-child{min-width:0;flex:1}
.analytics-print-hero-icon{width:40px;height:40px;border-radius:14px;background:#fff;display:inline-flex;align-items:center;justify-content:center;color:var(--print-hero-accent);box-shadow:inset 0 0 0 1px rgba(255,255,255,.8),0 10px 18px rgba(15,23,42,.06);flex-shrink:0}
.analytics-print-hero-label{display:block;font-size:.73rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
.analytics-print-hero-card strong{font-size:1.52rem;line-height:1.08;letter-spacing:-.03em;color:#0f172a;position:relative;z-index:1}
.analytics-print-hero-card small{font-size:.83rem;line-height:1.5;color:#475569;position:relative;z-index:1}
.analytics-print-hero-chip-row{display:flex;gap:.45rem;flex-wrap:wrap;margin-top:auto;position:relative;z-index:1}
.analytics-print-hero-chip{display:inline-flex;align-items:center;gap:.36rem;padding:.4rem .62rem;border-radius:999px;background:#fff;border:1px solid rgba(148,163,184,.18);font-size:.73rem;font-weight:700;color:#334155}
.analytics-print-hero-chip i{color:var(--print-hero-accent)}
.analytics-print-brief-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem}
.analytics-print-brief-card{--print-brief-accent:#f97316;--print-brief-soft:rgba(249,115,22,.12);padding:1rem 1.05rem;border-radius:20px;border:1px solid rgba(226,232,240,.9);background:linear-gradient(180deg,var(--print-brief-soft),#fff 48%);display:grid;gap:.5rem;box-shadow:0 14px 26px rgba(15,23,42,.04);position:relative;overflow:hidden}
.analytics-print-brief-card:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:4px;background:linear-gradient(90deg,var(--print-brief-accent),transparent 84%)}
.analytics-print-brief-card span{font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
.analytics-print-brief-card strong{font-size:1rem;line-height:1.25;color:#0f172a;letter-spacing:-.02em}
.analytics-print-brief-card p{margin:0;font-size:.78rem;line-height:1.55;color:#475569}
.analytics-print-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem}
.analytics-print-kpi{--print-kpi-accent:#f97316;--print-kpi-soft:rgba(249,115,22,.12);padding:.9rem .95rem;border-radius:18px;border:1px solid rgba(226,232,240,.9);background:linear-gradient(180deg,var(--print-kpi-soft),#fff 46%);display:grid;gap:.42rem;position:relative;overflow:hidden;box-shadow:0 12px 22px rgba(15,23,42,.04)}
.analytics-print-kpi:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:4px;background:linear-gradient(90deg,var(--print-kpi-accent),transparent 84%)}
.analytics-print-kpi-head{display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem}
.analytics-print-kpi-head span{font-size:.72rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#475569}
.analytics-print-kpi-head i{width:30px;height:30px;border-radius:11px;background:#fff;display:inline-flex;align-items:center;justify-content:center;color:var(--print-kpi-accent);box-shadow:inset 0 0 0 1px rgba(255,255,255,.7)}
.analytics-print-kpi strong{font-size:1.28rem;line-height:1.08;color:#0f172a}
.analytics-print-kpi small{font-size:.78rem;color:#475569;line-height:1.45}
.analytics-print-kpi .analytics-compare-badge{width:max-content}
.analytics-print-donut-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem}
.analytics-print-donut-card{--donut-card-accent:#f97316;--donut-card-soft:rgba(249,115,22,.12);padding:1rem .95rem;border-radius:20px;border:1px solid rgba(226,232,240,.9);background:linear-gradient(180deg,var(--donut-card-soft),#fff 44%);display:grid;gap:.85rem;align-content:start;position:relative;overflow:hidden;box-shadow:0 14px 26px rgba(15,23,42,.04)}
.analytics-print-donut-card:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:4px;background:linear-gradient(90deg,var(--donut-card-accent),transparent 82%)}
.analytics-print-donut-top{display:grid;justify-items:center;gap:.75rem;text-align:center}
.analytics-print-donut{--donut-gradient:conic-gradient(#f97316 0 100%);position:relative;width:122px;height:122px;border-radius:999px;background:var(--donut-gradient);display:grid;place-items:center;box-shadow:0 14px 28px rgba(15,23,42,.08), inset 0 0 0 1px rgba(255,255,255,.35)}
.analytics-print-donut::before{content:"";width:80px;height:80px;border-radius:999px;background:#fff;box-shadow:inset 0 0 0 1px rgba(226,232,240,.92)}
.analytics-print-donut-center{position:absolute;inset:0;display:grid;place-items:center;text-align:center}
.analytics-print-donut-center strong{display:block;font-size:1.08rem;font-weight:900;color:#0f172a;letter-spacing:-.03em;line-height:1.05}
.analytics-print-donut-center span{display:block;font-size:.63rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;line-height:1.2}
.analytics-print-donut-card strong{font-size:.88rem;color:#0f172a;line-height:1.3}
.analytics-print-donut-card span{font-size:.77rem;color:#64748b;line-height:1.45}
.analytics-print-donut-band{display:flex;height:9px;border-radius:999px;overflow:hidden;background:rgba(226,232,240,.84);box-shadow:inset 0 0 0 1px rgba(226,232,240,.92)}
.analytics-print-donut-band-segment{height:100%}
.analytics-print-donut-legend{display:grid;gap:.42rem}
.analytics-print-donut-legend-item{display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem;font-size:.74rem;color:#475569}
.analytics-print-donut-legend-main{display:flex;align-items:flex-start;gap:.45rem;min-width:0;flex:1}
.analytics-print-donut-swatch{width:10px;height:10px;border-radius:999px;flex-shrink:0;margin-top:.22rem}
.analytics-print-donut-legend-item strong{font-size:.74rem;color:#0f172a;line-height:1.35}
.analytics-print-donut-legend-item span{font-size:.72rem;color:#64748b;line-height:1.35}
.analytics-print-donut-share{font-weight:900;color:#0f172a;white-space:nowrap}
.analytics-print-bar-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem}
.analytics-print-bar-card{--print-bar-accent:#475569;--print-bar-soft:rgba(71,85,105,.12);padding:.95rem 1rem;border-radius:20px;border:1px solid rgba(226,232,240,.9);background:linear-gradient(180deg,var(--print-bar-soft),#fff 44%);display:grid;gap:.75rem;box-shadow:0 14px 26px rgba(15,23,42,.04)}
.analytics-print-bar-card h3{margin:0;font-size:.88rem;font-weight:800;color:#0f172a}
.analytics-print-bar-card span{font-size:.76rem;color:#64748b;line-height:1.45}
.analytics-visual-panel{display:grid;gap:1rem}
.analytics-visual-panel .analytics-print-donut-grid{gap:.8rem}
.analytics-visual-panel .analytics-print-donut-card{height:100%;align-content:start}
.analytics-visual-panel .analytics-chart-note{margin-top:0}
.analytics-print-bar-list{display:grid;gap:.58rem}
.analytics-print-bar-row{display:grid;gap:.26rem}
.analytics-print-bar-head{display:flex;justify-content:space-between;gap:.65rem;align-items:flex-end}
.analytics-print-bar-head strong{font-size:.77rem;color:#0f172a}
.analytics-print-bar-head span{font-size:.73rem;color:#475569}
.analytics-print-bar-track{height:10px;border-radius:999px;background:rgba(226,232,240,.92);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(226,232,240,.96)}
.analytics-print-bar-fill{display:block;height:100%;border-radius:999px}
.analytics-print-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:.9rem}
.analytics-print-card{padding:.95rem 1rem;border-radius:20px;border:1px solid rgba(226,232,240,.9);background:#fff;display:grid;gap:.6rem;break-inside:avoid;box-shadow:0 14px 26px rgba(15,23,42,.04)}
.analytics-print-card.is-critical{border-color:rgba(220,38,38,.24);background:linear-gradient(180deg,#fef2f2,#fff)}
.analytics-print-card.is-watch{border-color:rgba(217,119,6,.22);background:linear-gradient(180deg,#fff7ed,#fff)}
.analytics-print-card.is-normal{border-color:rgba(5,150,105,.18);background:linear-gradient(180deg,#ecfdf5,#fff)}
.analytics-print-card h3{margin:0;font-size:.88rem;font-weight:800;color:#0f172a}
.analytics-print-list{display:grid;gap:.55rem}
.analytics-print-list-item{display:flex;justify-content:space-between;gap:.8rem;align-items:flex-start;padding:.62rem .7rem;border-radius:14px;background:#f8fafc;border:1px solid rgba(226,232,240,.92)}
.analytics-print-list-item strong{display:block;font-size:.84rem;color:#0f172a}
.analytics-print-list-item span{display:block;font-size:.76rem;color:#64748b;line-height:1.45}
.analytics-print-list-item > div:first-child{min-width:0;flex:1}
.analytics-print-page-break{break-before:auto;page-break-before:auto}
.analytics-print-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid rgba(226,232,240,.92);border-radius:18px;overflow:hidden}
.analytics-print-table th,.analytics-print-table td{padding:.62rem .68rem;border-bottom:1px solid rgba(226,232,240,.9);text-align:left;vertical-align:top;font-size:.77rem;line-height:1.45}
.analytics-print-table th{font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:#64748b;background:#f8fafc}
.analytics-print-table tbody tr:last-child td{border-bottom:none}
.analytics-print-foot{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding-top:.8rem;border-top:1px solid rgba(226,232,240,.9);font-size:.76rem;color:#64748b}
.analytics-print-foot--header{padding-top:0;border-top:none;flex-wrap:wrap}
.analytics-print-foot--header span{display:inline-flex;align-items:center;padding:.48rem .74rem;border-radius:999px;background:#ffffff;border:1px solid rgba(148,163,184,.16);box-shadow:0 10px 18px rgba(15,23,42,.04);color:#475569}
@page{size:A4 landscape;margin:14mm}
@media print{
body.analytics-print-mode{background:#fff!important}
body.analytics-print-mode #offline-banner,
body.analytics-print-mode .navbar,
body.analytics-print-mode #sync-status-strip,
body.analytics-print-mode #search-container,
body.analytics-print-mode #search-results-overlay,
body.analytics-print-mode .analytics-toolbar,
body.analytics-print-mode .analytics-specialty-row,
body.analytics-print-mode .analytics-hero-strip,
body.analytics-print-mode .analytics-kpi-grid,
body.analytics-print-mode .analytics-story-grid,
body.analytics-print-mode .analytics-grid,
body.analytics-print-mode .analytics-mini-grid,
body.analytics-print-mode .analytics-alert-grid,
body.analytics-print-mode .analytics-detail-root{display:none!important}
body.analytics-print-mode #main-content{padding:0!important;margin:0!important;max-width:none!important}
body.analytics-print-mode .analytics-dashboard{display:block!important;padding:0!important}
body.analytics-print-mode .analytics-panel--hero{box-shadow:none!important;border:none!important;background:#fff!important;padding:0!important}
body.analytics-print-mode .analytics-panel--hero:before,
body.analytics-print-mode .analytics-panel--hero:after{display:none!important}
body.analytics-print-mode .analytics-hero-top{display:none!important}
body.analytics-print-mode .analytics-print-report{display:grid!important;gap:1rem;color:#0f172a}
body.analytics-print-mode .analytics-print-report,
body.analytics-print-mode .analytics-print-report *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body.analytics-print-mode .analytics-print-page-break{break-before:page;page-break-before:always}
body.analytics-print-mode .analytics-print-report{gap:.7rem!important}
body.analytics-print-mode .analytics-print-header{padding:1rem 1.05rem!important;gap:.7rem!important}
body.analytics-print-mode .analytics-print-foot--header{padding-top:0!important;gap:.45rem!important}
body.analytics-print-mode .analytics-print-foot--header span{padding:.36rem .58rem!important;font-size:.72rem!important}
body.analytics-print-mode .analytics-print-section{padding:.55rem 0!important;gap:.45rem!important}
body.analytics-print-mode .analytics-print-section-head{padding-bottom:.3rem!important}
body.analytics-print-mode .analytics-print-section-head h2{font-size:.92rem!important}
body.analytics-print-mode .analytics-print-section-head span{font-size:.74rem!important}
body.analytics-print-mode .analytics-print-hero-grid,
body.analytics-print-mode .analytics-print-kpis,
body.analytics-print-mode .analytics-print-donut-grid,
body.analytics-print-mode .analytics-print-brief-grid,
body.analytics-print-mode .analytics-print-bar-grid{gap:.45rem!important}
body.analytics-print-mode .analytics-print-hero-card,
body.analytics-print-mode .analytics-print-kpi,
body.analytics-print-mode .analytics-print-donut-card,
body.analytics-print-mode .analytics-print-bar-card,
body.analytics-print-mode .analytics-print-brief-card,
body.analytics-print-mode .analytics-print-list-item{break-inside:avoid!important;page-break-inside:avoid!important}
body.analytics-print-mode .analytics-print-hero-card{min-height:116px!important;padding:.7rem .78rem!important;gap:.42rem!important}
body.analytics-print-mode .analytics-print-kpi,
body.analytics-print-mode .analytics-print-donut-card,
body.analytics-print-mode .analytics-print-bar-card,
body.analytics-print-mode .analytics-print-brief-card{padding:.72rem .78rem!important}
body.analytics-print-mode .analytics-print-hero-card strong{font-size:1.2rem!important}
body.analytics-print-mode .analytics-print-hero-card small{font-size:.74rem!important;line-height:1.28!important}
body.analytics-print-mode .analytics-print-hero-label{font-size:.72rem!important}
body.analytics-print-mode .analytics-print-hero-icon{width:42px!important;height:42px!important;border-radius:14px!important}
body.analytics-print-mode .analytics-print-hero-chip-row{gap:.28rem!important}
body.analytics-print-mode .analytics-print-hero-chip{padding:.25rem .46rem!important;font-size:.64rem!important;gap:.24rem!important}
body.analytics-print-mode .analytics-print-kpi strong{font-size:1.16rem!important}
body.analytics-print-mode .analytics-print-donut{width:104px!important;height:104px!important}
body.analytics-print-mode .analytics-print-donut::before{width:68px!important;height:68px!important}
body.analytics-print-equipment-mode{background:#fff!important}
body.analytics-print-equipment-mode #offline-banner,
body.analytics-print-equipment-mode .navbar,
body.analytics-print-equipment-mode #sync-status-strip,
body.analytics-print-equipment-mode #search-container,
body.analytics-print-equipment-mode #search-results-overlay,
body.analytics-print-equipment-mode .analytics-dashboard{display:none!important}
body.analytics-print-equipment-mode #main-content{padding:0!important;margin:0!important;max-width:none!important}
body.analytics-print-equipment-mode .analytics-equipment-print-shell{display:grid!important;gap:1rem;color:#0f172a}
body.analytics-print-equipment-mode .analytics-equipment-print-shell,
body.analytics-print-equipment-mode .analytics-equipment-print-shell *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body.analytics-print-equipment-mode .analytics-print-page-break{break-before:page;page-break-before:always}
body.analytics-print-mode .panel{box-shadow:none!important;border:none!important;background:transparent!important}
body.analytics-print-mode .analytics-print-section,
body.analytics-print-mode .analytics-print-card,
body.analytics-print-mode .analytics-print-table,
body.analytics-print-mode .analytics-print-header,
body.analytics-print-equipment-mode .analytics-equipment-print-section,
body.analytics-print-equipment-mode .analytics-equipment-print-card,
body.analytics-print-equipment-mode .analytics-equipment-print-table,
body.analytics-print-equipment-mode .analytics-equipment-print-hero{break-inside:avoid}
}
.analytics-story-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}
.analytics-story-card{display:flex;flex-direction:column;gap:.55rem;min-height:168px}
.analytics-story-card--accent{background:linear-gradient(135deg,#fff7ed,#ffffff);border-color:rgba(249,115,22,.16)}
.analytics-story-label{font-size:.74rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
.analytics-story-value{font-size:clamp(1.2rem,2.7vw,1.7rem);line-height:1.12;font-weight:900;color:#0f172a;letter-spacing:-.03em;overflow-wrap:anywhere}
.analytics-story-sub{font-size:.9rem;color:#475569;line-height:1.55}
.analytics-story-meta{margin-top:auto;display:flex;gap:.55rem;flex-wrap:wrap}
.analytics-story-chip{display:inline-flex;align-items:center;gap:.4rem;padding:.45rem .65rem;border-radius:999px;background:#f8fafc;border:1px solid rgba(148,163,184,.18);font-size:.77rem;font-weight:700;color:#475569}
.analytics-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}
.analytics-grid--charts{grid-template-columns:repeat(2,minmax(0,1fr))}
.analytics-grid--bottom{align-items:start}
.analytics-span-2{grid-column:span 2}
.analytics-panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem;margin-bottom:.95rem}
.analytics-panel-head h3{margin:0;font-size:1.02rem;font-weight:800;color:#0f172a}
.analytics-panel-head span{font-size:.8rem;color:var(--text-muted);line-height:1.45}
.analytics-panel-head-copy{display:grid;gap:.32rem}
.analytics-panel-kicker{font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#c2410c}
.analytics-chart-wrap{position:relative;height:300px}
.analytics-chart-wrap--wide{height:320px}
.analytics-chart-wrap--small{height:250px}
.analytics-chart-note{display:flex;justify-content:space-between;gap:.7rem;flex-wrap:wrap;margin-top:.9rem;padding-top:.8rem;border-top:1px solid rgba(226,232,240,.92);font-size:.78rem;color:#64748b}
.analytics-chart-note strong{color:#0f172a}
.analytics-reading-list,.analytics-ranking-list{display:grid;gap:.7rem}
.analytics-reading-item,.analytics-ranking-item{display:flex;justify-content:space-between;gap:.8rem;align-items:flex-start;padding:.85rem .95rem;border-radius:16px;background:#f8fafc;border:1px solid rgba(148,163,184,.18);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.analytics-reading-item:hover,.analytics-ranking-item:hover{transform:translateY(-1px);box-shadow:0 14px 28px rgba(15,23,42,.08);border-color:rgba(249,115,22,.18)}
.analytics-reading-item strong,.analytics-ranking-item strong{display:block;font-size:.92rem}
.analytics-reading-item span,.analytics-ranking-item span{display:block;font-size:.76rem;color:var(--text-muted)}
.analytics-reading-item > div:first-child,.analytics-ranking-item > div:last-child{min-width:0;flex:1}
.analytics-reading-item{--reading-accent:#94a3b8;--reading-soft:rgba(148,163,184,.12);--reading-border:rgba(148,163,184,.22)}
.analytics-reading-item.is-normal{background:linear-gradient(135deg,rgba(236,253,245,.82),#fff);border-color:rgba(5,150,105,.2)}
.analytics-reading-item.is-watch{background:linear-gradient(135deg,rgba(255,247,237,.92),#fff);border-color:rgba(217,119,6,.24)}
.analytics-reading-item.is-critical{background:linear-gradient(135deg,rgba(254,242,242,.92),#fff);border-color:rgba(220,38,38,.24)}
.analytics-reading-main{display:grid;gap:.42rem}
.analytics-reading-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem}
.analytics-reading-badges{display:flex;flex-direction:column;align-items:flex-end;gap:.45rem}
.analytics-reading-meta{display:flex;gap:.32rem .65rem;flex-wrap:wrap}
.analytics-reading-value{font-size:1rem;font-weight:900;white-space:nowrap;text-align:right;line-height:1.15}
.analytics-reading-value.is-vib{color:#f97316}
.analytics-reading-value.is-temp{color:#9a3412}
.analytics-status-badge{display:inline-flex;align-items:center;gap:.36rem;padding:.35rem .58rem;border-radius:999px;font-size:.72rem;font-weight:800;line-height:1.1;border:1px solid transparent}
.analytics-status-badge.is-normal{background:#ecfdf5;color:#047857;border-color:#a7f3d0}
.analytics-status-badge.is-watch{background:#fff7ed;color:#b45309;border-color:#fdba74}
.analytics-status-badge.is-critical{background:#fef2f2;color:#b91c1c;border-color:#fca5a5}
.analytics-mini-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem}
.analytics-mini-card{display:flex;flex-direction:column;gap:.4rem;padding:1rem;background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(248,250,252,.9));border:1px solid rgba(148,163,184,.16)}
.analytics-mini-card.is-normal{background:linear-gradient(180deg,rgba(236,253,245,.96),rgba(255,255,255,.94));border-color:rgba(5,150,105,.16)}
.analytics-mini-card.is-watch{background:linear-gradient(180deg,rgba(255,247,237,.96),rgba(255,255,255,.94));border-color:rgba(217,119,6,.2)}
.analytics-mini-card.is-critical{background:linear-gradient(180deg,rgba(254,242,242,.96),rgba(255,255,255,.94));border-color:rgba(220,38,38,.2)}
.analytics-mini-top{display:flex;justify-content:space-between;align-items:flex-start;gap:.7rem}
.analytics-mini-label{font-size:.76rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
.analytics-mini-card strong{font-size:1.3rem;line-height:1.08;letter-spacing:-.04em}
.analytics-mini-card span{font-size:.82rem;color:var(--text-muted);line-height:1.45}
.analytics-table-wrap{overflow:auto;border:1px solid rgba(226,232,240,.92);border-radius:16px}
.analytics-table{width:100%;border-collapse:collapse;min-width:840px;background:#fff}
.analytics-table th,.analytics-table td{padding:.85rem .78rem;text-align:left;border-bottom:1px solid rgba(226,232,240,.9);font-size:.84rem;vertical-align:middle}
.analytics-table th{font-size:.76rem;text-transform:uppercase;letter-spacing:.04em;color:#64748b;background:#f8fafc}
.analytics-table tbody tr:hover{background:#fff7ed}
.analytics-empty-cell,.analytics-empty{text-align:center;color:var(--text-muted);padding:1rem 0}
.analytics-link-btn{background:none;border:none;padding:0;color:#ea580c;font-weight:700;cursor:pointer;text-align:left}
.analytics-link-btn:hover{text-decoration:underline}
.analytics-type-badge{--analytics-accent:#64748b;--analytics-accent-soft:rgba(148,163,184,.12);--analytics-accent-border:rgba(148,163,184,.24);display:inline-flex;align-items:center;padding:.34rem .62rem;border-radius:999px;font-size:.72rem;font-weight:800;border:1px solid var(--analytics-accent-border);background:var(--analytics-accent-soft);color:var(--analytics-accent)}
.analytics-ranking-pos{width:28px;height:28px;border-radius:999px;background:#fff7ed;color:#c2410c;display:inline-flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:900;flex-shrink:0}
.analytics-clickable{cursor:pointer}
.analytics-clickable:hover{transform:translateY(-1px);box-shadow:0 16px 28px rgba(15,23,42,.08);border-color:rgba(249,115,22,.22)}
.analytics-detail-root{position:fixed;inset:0;z-index:1400;pointer-events:none;height:100dvh}
.analytics-detail-root.is-open{pointer-events:none}
.analytics-detail-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.42);opacity:0;transition:opacity .22s ease;pointer-events:none}
.analytics-detail-root.is-open .analytics-detail-backdrop{opacity:0}
.analytics-detail-drawer{position:absolute;top:16px;right:0;width:min(560px,100vw);height:auto;min-height:220px;max-height:calc(100dvh - 32px);background:#fff;border-radius:24px 0 0 24px;box-shadow:-20px 0 60px rgba(15,23,42,.18);transform:translateX(102%);transition:transform .24s ease;display:flex;flex-direction:column;padding-bottom:4.5rem;padding-bottom:calc(env(safe-area-inset-bottom, 0px) + 4.5rem);pointer-events:auto;overflow:hidden}
.analytics-detail-root.is-open .analytics-detail-drawer{transform:translateX(0)}
.analytics-detail-head{padding:1.1rem 1.15rem .95rem;border-bottom:1px solid rgba(226,232,240,.9);background:linear-gradient(180deg,#fffaf5,#ffffff)}
.analytics-detail-title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem}
.analytics-detail-title-row > div:first-child{min-width:0;flex:1}
.analytics-detail-title{margin:0;font-size:1.12rem;font-weight:800;color:#0f172a;line-height:1.2;overflow-wrap:anywhere}
.analytics-detail-subtitle{margin-top:.35rem;font-size:.84rem;color:#64748b;line-height:1.5;overflow-wrap:anywhere}
.analytics-detail-actions{display:flex;gap:.55rem;flex-wrap:wrap;margin-top:.85rem}
.analytics-detail-action-btn{display:inline-flex;align-items:center;gap:.45rem;padding:.48rem .78rem;border:none;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:.76rem;font-weight:800;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(249,115,22,.16)}
.analytics-detail-action-btn:hover{background:#ffedd5}
.analytics-detail-close{width:38px;height:38px;border:none;border-radius:12px;background:#fff7ed;color:#c2410c;cursor:pointer;font-size:1rem;display:inline-flex;align-items:center;justify-content:center}
.analytics-detail-close:hover{background:#ffedd5}
.analytics-detail-summary{display:flex;gap:.55rem;flex-wrap:wrap;margin-top:.85rem}
.analytics-detail-summary-chip{display:inline-flex;align-items:center;gap:.42rem;padding:.45rem .72rem;border-radius:999px;background:#fff;border:1px solid rgba(148,163,184,.2);font-size:.77rem;font-weight:700;color:#475569;line-height:1.35;white-space:normal}
.analytics-detail-body{padding:1rem 1rem 5rem;padding:1rem 1rem calc(env(safe-area-inset-bottom, 0px) + 5rem);overflow-y:auto;display:grid;gap:1rem;background:#f8fafc;scroll-padding-bottom:5rem}
.analytics-detail-section{display:grid;gap:.7rem}
.analytics-detail-section-head{display:flex;justify-content:space-between;align-items:center;gap:.75rem}
.analytics-detail-section-head h4{margin:0;font-size:.95rem;font-weight:800;color:#0f172a}
.analytics-detail-section-head span{font-size:.78rem;color:#64748b}
.analytics-detail-card{background:#fff;border:1px solid rgba(226,232,240,.92);border-radius:16px;padding:.9rem .95rem;display:grid;gap:.55rem;box-shadow:0 10px 20px rgba(15,23,42,.04)}
.analytics-detail-card.is-normal{border-color:rgba(5,150,105,.18);background:linear-gradient(135deg,rgba(236,253,245,.84),#fff)}
.analytics-detail-card.is-watch{border-color:rgba(217,119,6,.22);background:linear-gradient(135deg,rgba(255,247,237,.9),#fff)}
.analytics-detail-card.is-critical{border-color:rgba(220,38,38,.22);background:linear-gradient(135deg,rgba(254,242,242,.9),#fff)}
.analytics-detail-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:.7rem;flex-wrap:wrap}
.analytics-detail-card-top > div:first-child{min-width:0;flex:1}
.analytics-detail-card-title{margin:0;font-size:.95rem;font-weight:800;color:#0f172a}
.analytics-detail-card-meta{display:flex;gap:.45rem .7rem;flex-wrap:wrap;font-size:.79rem;color:#64748b}
.analytics-detail-card-text{font-size:.83rem;color:#475569;line-height:1.5}
.analytics-detail-card-text strong{color:#0f172a}
.analytics-detail-equipment-btn{border:none;background:none;padding:0;color:#ea580c;font-weight:800;font-size:.95rem;text-align:left;cursor:pointer;display:block;width:100%;line-height:1.3;white-space:normal;overflow-wrap:anywhere}
.analytics-detail-equipment-btn:hover{text-decoration:underline}
.analytics-detail-grid{display:grid;gap:.7rem;padding-bottom:.35rem}
.analytics-detail-stat{background:#fff;border:1px solid rgba(226,232,240,.92);border-radius:16px;padding:.85rem .95rem;display:flex;justify-content:space-between;gap:.8rem;align-items:flex-start;box-shadow:0 10px 20px rgba(15,23,42,.04)}
.analytics-detail-stat > div:first-child{min-width:0;flex:1}
.analytics-detail-stat strong{display:block;font-size:.92rem;color:#0f172a}
.analytics-detail-stat span{display:block;font-size:.79rem;color:#64748b;line-height:1.45}
.analytics-equipment-print-shell{display:none;gap:1rem;padding:1rem;border-radius:30px;background:linear-gradient(180deg,#fffaf4 0%,#f8fafc 100%)}
.analytics-equipment-print-hero{display:grid;gap:1rem;padding:1.3rem 1.35rem;border-radius:28px;background:linear-gradient(180deg,#ffffff 0%,#fffaf4 100%);border:1px solid rgba(226,232,240,.95);box-shadow:0 22px 44px rgba(15,23,42,.08);position:relative;overflow:hidden}
.analytics-equipment-print-hero:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:6px;background:linear-gradient(90deg,#f97316 0%,#fb923c 56%,#475569 100%)}
.analytics-equipment-print-brand{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap;position:relative;z-index:1}
.analytics-equipment-print-mark{display:flex;align-items:center;gap:.75rem}
.analytics-equipment-print-badge{width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,#f97316,#fb923c);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:1.1rem;box-shadow:0 16px 32px rgba(249,115,22,.28)}
.analytics-equipment-print-mark strong{display:block;font-size:1.45rem;line-height:1.05;color:#0f172a;letter-spacing:-.03em}
.analytics-equipment-print-mark span{display:block;font-size:.82rem;color:#64748b;line-height:1.45}
.analytics-equipment-print-meta{display:grid;gap:.28rem;padding:1rem 1.05rem;border-radius:22px;background:linear-gradient(135deg,#fff7ed,#ffffff 72%);border:1px solid rgba(249,115,22,.18);font-size:.82rem;color:#64748b;min-width:250px}
.analytics-equipment-print-meta strong{font-size:1.22rem;color:#0f172a;line-height:1.15}
.analytics-equipment-print-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:.75rem}
.analytics-equipment-print-kpi{padding:.9rem .95rem;border-radius:18px;background:#fff;border:1px solid rgba(226,232,240,.92);box-shadow:0 12px 24px rgba(15,23,42,.04);display:grid;gap:.36rem}
.analytics-equipment-print-kpi span{font-size:.72rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#64748b}
.analytics-equipment-print-kpi strong{font-size:1.18rem;color:#0f172a;line-height:1.08}
.analytics-equipment-print-kpi small{font-size:.76rem;color:#64748b;line-height:1.45}
.analytics-equipment-print-grid{display:grid;grid-template-columns:1.2fr .95fr;gap:.9rem}
.analytics-equipment-print-section{display:grid;gap:.75rem;padding:1rem 0}
.analytics-equipment-print-card{padding:1rem 1.05rem;border-radius:20px;background:#fff;border:1px solid rgba(226,232,240,.92);box-shadow:0 14px 26px rgba(15,23,42,.04);display:grid;gap:.6rem}
.analytics-equipment-print-card h3{margin:0;font-size:.92rem;font-weight:800;color:#0f172a}
.analytics-equipment-print-card p{margin:0;font-size:.8rem;line-height:1.55;color:#475569}
.analytics-equipment-print-list{display:grid;gap:.55rem}
.analytics-equipment-print-list-item{display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;padding:.62rem .7rem;border-radius:14px;background:#f8fafc;border:1px solid rgba(226,232,240,.92)}
.analytics-equipment-print-list-item strong{display:block;font-size:.84rem;color:#0f172a}
.analytics-equipment-print-list-item span{display:block;font-size:.76rem;color:#64748b;line-height:1.45}
.analytics-equipment-print-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid rgba(226,232,240,.92);border-radius:18px;overflow:hidden}
.analytics-equipment-print-table th,.analytics-equipment-print-table td{padding:.62rem .68rem;border-bottom:1px solid rgba(226,232,240,.9);text-align:left;vertical-align:top;font-size:.77rem;line-height:1.45}
.analytics-equipment-print-table th{font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:#64748b;background:#f8fafc}
.analytics-equipment-print-foot{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding-top:.8rem;border-top:1px solid rgba(226,232,240,.9);font-size:.76rem;color:#64748b}
@media (max-width: 1200px){.analytics-hero-strip{grid-template-columns:1fr 1fr}.analytics-hero-callout{grid-column:span 2}.analytics-story-grid,.analytics-alert-grid{grid-template-columns:1fr 1fr}.analytics-kpi-grid,.analytics-mini-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.analytics-grid{grid-template-columns:1fr 1fr}.analytics-span-2{grid-column:span 2}.analytics-print-brand{grid-template-columns:1fr}.analytics-print-hero-grid,.analytics-print-brief-grid{grid-template-columns:1fr 1fr}.analytics-print-bar-grid{grid-template-columns:1fr 1fr}}
@media (max-width: 780px){.analytics-hero-top{flex-direction:column}.analytics-range-summary{align-items:flex-start;min-width:unset;width:100%}.analytics-toolbar{align-items:stretch}.analytics-date-fields,.analytics-toolbar-actions{width:100%}.analytics-date-fields label{flex:1}.analytics-date-fields input{min-width:0}.analytics-toolbar-actions .analytics-toolbar-btn{flex:1}.analytics-hero-strip,.analytics-kpi-grid,.analytics-story-grid,.analytics-grid,.analytics-mini-grid,.analytics-alert-grid,.analytics-print-kpis,.analytics-print-grid,.analytics-print-donut-grid,.analytics-print-hero-grid,.analytics-print-brief-grid,.analytics-print-bar-grid,.analytics-equipment-print-kpis,.analytics-equipment-print-grid{grid-template-columns:1fr}.analytics-hero-callout,.analytics-span-2{grid-column:span 1}.analytics-section-headline,.analytics-chart-note{flex-direction:column;align-items:flex-start}.analytics-chart-wrap,.analytics-chart-wrap--small,.analytics-chart-wrap--wide{height:240px}.analytics-detail-drawer{top:0!important;width:100vw;height:100dvh;min-height:100dvh;max-height:100dvh;border-radius:0;padding-bottom:5.5rem;padding-bottom:calc(env(safe-area-inset-bottom, 0px) + 5.5rem)}.analytics-detail-body{padding-bottom:6rem;padding-bottom:calc(env(safe-area-inset-bottom, 0px) + 6rem)}.analytics-detail-card-top,.analytics-detail-stat,.analytics-reading-item,.analytics-ranking-item,.analytics-print-foot,.analytics-equipment-print-foot,.analytics-equipment-print-brand{gap:.6rem;flex-direction:column;align-items:flex-start}.analytics-reading-head,.analytics-reading-badges,.analytics-kpi-foot{flex-direction:column;align-items:flex-start}.analytics-kpi-spark{width:100%;flex-basis:auto}.analytics-reading-value{white-space:normal;text-align:left}.analytics-type-badge,.analytics-range-compare{max-width:100%;white-space:normal;line-height:1.3}.analytics-print-meta,.analytics-equipment-print-meta{text-align:left;min-width:unset;width:100%}}
        `;
        document.head.appendChild(style);
    }

    function esc(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function startOfDay(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function endOfDay(date) {
        const d = new Date(date);
        d.setHours(23, 59, 59, 999);
        return d;
    }

    function isoDate(date) {
        return date.toISOString().slice(0, 10);
    }

    function formatDate(date) {
        return new Date(date).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function formatNumber(value, decimals) {
        return Number(value || 0).toLocaleString('es-CL', {
            minimumFractionDigits: decimals || 0,
            maximumFractionDigits: decimals || 0
        });
    }

    function hexToRgba(hex, alpha) {
        const safe = String(hex || '').replace('#', '');
        if (safe.length !== 6) return `rgba(148,163,184,${alpha})`;
        const int = parseInt(safe, 16);
        const r = (int >> 16) & 255;
        const g = (int >> 8) & 255;
        const b = int & 255;
        return `rgba(${r},${g},${b},${alpha})`;
    }

    function normalizeSeries(values) {
        const valid = values.filter(value => Number.isFinite(value));
        if (!valid.length) return [];
        let last = valid[0];
        return values.map(value => {
            if (Number.isFinite(value)) {
                last = Number(value);
                return last;
            }
            return last;
        });
    }

    function buildSparklineSvg(values, color, fillAlpha) {
        const normalized = normalizeSeries(values);
        if (!normalized.length) return '';
        const width = 132;
        const height = 34;
        const pad = 2;
        const min = Math.min(...normalized);
        const max = Math.max(...normalized);
        const range = max - min || 1;
        const points = normalized.map((value, index) => {
            const x = pad + (index * ((width - pad * 2) / Math.max(normalized.length - 1, 1)));
            const y = height - pad - (((value - min) / range) * (height - pad * 2));
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ');
        const firstPoint = points.split(' ')[0]?.split(',') || [pad, height - pad];
        const lastPoint = points.split(' ').slice(-1)[0]?.split(',') || [width - pad, height - pad];
        const area = `M ${firstPoint[0]} ${height - pad} L ${points.replace(/ /g, ' L ')} L ${lastPoint[0]} ${height - pad} Z`;
        return `
<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
  <path d="${area}" fill="${hexToRgba(color, fillAlpha ?? 0.14)}"></path>
  <polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
</svg>`;
    }

    function getTrendMeta(values) {
        const normalized = normalizeSeries(values);
        if (normalized.length < 2) {
            return { label: 'Estable', className: 'is-flat', icon: 'fa-minus' };
        }
        const last = normalized[normalized.length - 1];
        const prev = normalized[normalized.length - 2];
        const diff = last - prev;
        const base = Math.max(Math.abs(prev), 1);
        const pct = Math.abs((diff / base) * 100);
        if (Math.abs(diff) < 0.01) return { label: 'Estable', className: 'is-flat', icon: 'fa-minus' };
        if (diff > 0) return { label: `Al alza ${formatNumber(pct, 0)}%`, className: 'is-up', icon: 'fa-arrow-trend-up' };
        return { label: `A la baja ${formatNumber(pct, 0)}%`, className: 'is-down', icon: 'fa-arrow-trend-down' };
    }

    function getMetricStatus(type, value) {
        const numeric = Number(value || 0);
        if (type === 'vibracion') {
            if (numeric >= 4.5) return { label: 'Atencion', className: 'is-critical', cardClass: 'is-critical', color: '#dc2626' };
            if (numeric >= 3.2) return { label: 'Seguimiento', className: 'is-watch', cardClass: 'is-watch', color: '#d97706' };
            return { label: 'Controlado', className: 'is-normal', cardClass: 'is-normal', color: '#059669' };
        }
        if (numeric >= 80) return { label: 'Atencion', className: 'is-critical', cardClass: 'is-critical', color: '#dc2626' };
        if (numeric >= 65) return { label: 'Seguimiento', className: 'is-watch', cardClass: 'is-watch', color: '#d97706' };
        return { label: 'Controlado', className: 'is-normal', cardClass: 'is-normal', color: '#059669' };
    }

    function summarizeCondition(measures) {
        let critical = 0;
        let watch = 0;
        measures.forEach(item => {
            const status = getMetricStatus(item.type, item.value);
            if (status.className === 'is-critical') critical += 1;
            else if (status.className === 'is-watch') watch += 1;
        });
        if (critical > 0) {
            return {
                label: 'Atencion',
                className: 'is-critical',
                note: `${formatNumber(critical)} lectura(s) en zona critica`
            };
        }
        if (watch > 0) {
            return {
                label: 'Seguimiento',
                className: 'is-watch',
                note: `${formatNumber(watch)} lectura(s) para seguimiento`
            };
        }
        return {
            label: 'Controlado',
            className: 'is-normal',
            note: measures.length ? 'Sin alertas relevantes en el rango' : 'Sin mediciones en el rango'
        };
    }

    function getComparisonMeta(current, previous, decimals, options) {
        const settings = options || {};
        const currentValue = Number(current || 0);
        const previousValue = Number(previous || 0);
        const precision = Number.isFinite(decimals) ? decimals : 0;
        const threshold = Math.pow(10, -(precision + 1));
        const diff = currentValue - previousValue;
        const absDiff = Math.abs(diff);
        const invert = !!settings.invert;
        const suffix = settings.suffix ? ` ${settings.suffix}` : '';

        if (absDiff < threshold) {
            return {
                label: 'Sin cambio relevante',
                shortLabel: '0 vs ant.',
                className: 'is-neutral',
                icon: 'fa-minus'
            };
        }

        const sign = diff > 0 ? '+' : '-';
        const pct = previousValue === 0 ? null : Math.abs((diff / previousValue) * 100);
        const semanticClass = diff > 0
            ? (invert ? 'is-negative' : 'is-positive')
            : (invert ? 'is-positive' : 'is-negative');

        return {
            label: `${sign}${formatNumber(absDiff, precision)}${suffix} vs periodo anterior${pct !== null ? ` (${sign}${formatNumber(pct, 0)}%)` : ''}`,
            shortLabel: `${sign}${formatNumber(absDiff, precision)}${suffix} vs ant.`,
            className: semanticClass,
            icon: diff > 0 ? 'fa-arrow-up' : 'fa-arrow-down'
        };
    }

    function buildPrintDonutCard(config) {
        const segments = (config.segments || []).filter(segment => Number(segment.value || 0) > 0);
        const total = segments.reduce((acc, segment) => acc + Number(segment.value || 0), 0);
        const safeSegments = total
            ? segments
            : [{ label: 'Sin datos', value: 1, color: '#cbd5e1', shareLabel: '0%' }];
        const accent = config.accent || safeSegments[0]?.color || '#f97316';
        const extraClass = config.className ? ` ${config.className}` : '';
        const extraAttrs = config.attrs ? ` ${config.attrs}` : '';
        const bandHtml = safeSegments.map(segment => `<span class="analytics-print-donut-band-segment" style="flex:${Math.max(Number(segment.value || 0), 1)};background:${segment.color};"></span>`).join('');

        let cursor = 0;
        const gradientParts = safeSegments.map(segment => {
            const value = Number(segment.value || 0);
            const slice = total ? (value / total) * 100 : 100;
            const start = cursor;
            const end = Math.min(cursor + slice, 100);
            cursor = end;
            return `${segment.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
        });

        const legendHtml = safeSegments.map(segment => {
            const value = Number(segment.value || 0);
            const share = total ? Math.round((value / total) * 100) : 0;
            return `
<div class="analytics-print-donut-legend-item">
  <div class="analytics-print-donut-legend-main">
    <span class="analytics-print-donut-swatch" style="background:${segment.color};"></span>
    <div>
      <strong>${esc(segment.label)}</strong>
      <span>${esc(segment.meta || '')}</span>
    </div>
  </div>
  <span class="analytics-print-donut-share">${esc(segment.shareLabel || `${share}%`)}</span>
</div>`;
        }).join('');

        return `
<article class="analytics-print-donut-card${extraClass}"${extraAttrs} style="--donut-card-accent:${accent};--donut-card-soft:${hexToRgba(accent, 0.12)};">
  <div class="analytics-print-donut-top">
    <div class="analytics-print-donut" style="--donut-gradient:conic-gradient(${gradientParts.join(', ')});">
      <div class="analytics-print-donut-center">
        <div>
          <strong>${esc(config.centerValue || formatNumber(total))}</strong>
          <span>${esc(config.centerLabel || 'Total')}</span>
        </div>
      </div>
    </div>
    <div>
      <strong>${esc(config.title)}</strong>
      <span>${esc(config.meta || '')}</span>
    </div>
  </div>
  <div class="analytics-print-donut-band">${bandHtml}</div>
  <div class="analytics-print-donut-legend">${legendHtml}</div>
</article>`;
    }

    function normalizePrintCopy(value) {
        return String(value == null ? '' : value)
            .replace(/\s*[Â]?·\s*/g, ' / ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function buildPrintBarCard(config) {
        const entries = (config.entries || []).filter(entry => Number(entry.value || 0) > 0);
        const safeEntries = entries.length
            ? entries
            : [{ label: 'Sin datos', value: 0, color: '#cbd5e1', valueLabel: '0' }];
        const max = Math.max(...safeEntries.map(entry => Number(entry.value || 0)), 1);
        const accent = config.accent || safeEntries[0]?.color || '#2563eb';
        const rowsHtml = safeEntries.map(entry => {
            const value = Number(entry.value || 0);
            const width = Math.max((value / max) * 100, value > 0 ? 14 : 0);
            return `
<div class="analytics-print-bar-row">
  <div class="analytics-print-bar-head">
    <strong>${esc(entry.label)}</strong>
    <span>${esc(normalizePrintCopy(entry.valueLabel || formatNumber(value)))}</span>
  </div>
  <div class="analytics-print-bar-track">
    <span class="analytics-print-bar-fill" style="width:${width.toFixed(2)}%;background:${entry.color || accent};"></span>
  </div>
</div>`;
        }).join('');

        return `
<article class="analytics-print-bar-card" style="--print-bar-accent:${accent};--print-bar-soft:${hexToRgba(accent, 0.12)};">
  <div>
    <h3>${esc(config.title)}</h3>
    <span>${esc(config.meta || '')}</span>
  </div>
  <div class="analytics-print-bar-list">${rowsHtml}</div>
</article>`;
    }

    function getAccentColor(type) {
        return TYPE_COLORS[type] || TYPE_COLORS.Otros;
    }

    function buildAccentVars(color, soft, border) {
        return `--analytics-accent:${color};--analytics-accent-soft:${hexToRgba(color, soft ?? 0.14)};--analytics-accent-border:${hexToRgba(color, border ?? 0.24)};`;
    }

    function renderTypeBadge(type, label) {
        return `<span class="analytics-type-badge" data-type="${esc(type)}" style="${buildAccentVars(getAccentColor(type), 0.12, 0.24)}">${esc(label || type)}</span>`;
    }

    function getState() {
        if (typeof estado !== 'undefined' && estado) return estado;
        if (window.estado) return window.estado;
        return null;
    }

    function parseNum(value) {
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : 0;
    }

    function parseDate(record) {
        const raw = record.created_at || record.fecha_creacion || record.fecha_completada || record.fecha_termino || record.fecha;
        const d = raw ? new Date(raw) : null;
        return d && !Number.isNaN(d.getTime()) ? d : null;
    }

    function getUnitFromTitle(text) {
        const m = String(text || '').match(/^\[([^\]]+)\]/);
        return m ? m[1].trim() : '';
    }

    function getEquipmentFromTitle(text) {
        return String(text || '').replace(/^\[[^\]]+\]\s*/, '').replace(/\s*\([^)]+\)\s*$/, '').trim();
    }

    function classify(text) {
        const t = String(text || '').toLowerCase();
        if (t.includes('vibrac')) return 'Vibraciones';
        if (t.includes('termog')) return 'Termografia';
        if (t.includes('lubric') || t.includes('aceite')) return 'Lubricacion';
        if (t.includes('end') || t.includes('tintas')) return 'END';
        if (t.includes('espesor')) return 'Espesores';
        if (t.includes('dureza')) return 'Dureza';
        return 'Otros';
    }

    function getWorkTypes(record) {
        if (Array.isArray(record.tipos_trabajo) && record.tipos_trabajo.length) return record.tipos_trabajo;
        if (Array.isArray(record.tiposSeleccionados) && record.tiposSeleccionados.length) return record.tiposSeleccionados;
        const base = String(record.tipo || record.tarea || '');
        const m = base.match(/\(([^)]+)\)\s*$/);
        return m ? m[1].split(',').map(x => x.trim()).filter(Boolean) : [];
    }

    function resolveEquipment(name, unit, id) {
        const state = getState();
        const equipos = (state && state.equipos) || [];
        if (id) {
            const direct = equipos.find(eq => String(eq.id) === String(id));
            if (direct) return direct;
        }
        const n = String(name || '').trim().toLowerCase();
        const u = String(unit || '').trim().toLowerCase();
        const sameUnit = equipos.filter(eq =>
            String(eq.activo || '').trim().toLowerCase() === n &&
            (!u || String(eq.ubicacion || '').trim().toLowerCase() === u)
        );
        return sameUnit[0] || equipos.find(eq => String(eq.activo || '').trim().toLowerCase() === n) || null;
    }

    function getGranularity(from, to) {
        const days = Math.max(1, Math.round((to - from) / 86400000) + 1);
        if (days > 120) return 'month';
        if (days > 45) return 'week';
        return 'day';
    }

    function weekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function periodKey(date, granularity) {
        if (granularity === 'month') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (granularity === 'week') return isoDate(weekStart(date));
        return isoDate(date);
    }

    function periodLabel(key, granularity) {
        if (granularity === 'month') {
            const [y, m] = key.split('-').map(Number);
            return new Date(y, m - 1, 1).toLocaleDateString('es-CL', { month: 'short', year: '2-digit' });
        }
        if (granularity === 'week') {
            const d = new Date(`${key}T00:00:00`);
            return `Sem ${d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}`;
        }
        return new Date(`${key}T00:00:00`).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
    }

    function buildBaseData() {
        const state = getState();
        const equipos = (state && state.equipos) || [];
        const tasks = ((state && state.historialTareas) || []).map(record => {
            const date = parseDate(record);
            if (!date) return null;
            const title = String(record.tipo || record.tarea || '');
            const unit = record.ubicacion || getUnitFromTitle(title) || '';
            const equipment = getEquipmentFromTitle(title) || 'Trabajo sin equipo';
            const types = getWorkTypes(record);
            const techs = Array.isArray(record.ayudantes_nombres)
                ? record.ayudantes_nombres
                : String(record.ayudantes_nombres || '').split(',').map(x => x.trim()).filter(Boolean);
            const eq = resolveEquipment(equipment, unit, record.equipo_id);
            return {
                id: record.id,
                date,
                unit,
                equipment,
                specialty: classify(types[0] || title),
                typesText: types.length ? types.join(', ') : classify(title),
                leader: record.lider_nombre || 'Sin lider',
                helpers: techs,
                hh: parseNum(record.hh_trabajo),
                ot: record.ot_numero || '',
                aviso: record.numero_aviso || '',
                equipmentId: eq ? eq.id : record.equipo_id || '',
                actions: record.acciones_realizadas || '',
                observations: record.observaciones || record.descripcion || '',
                analysis: record.analisis || '',
                recommendation: record.recomendacion_analista || record.accion_analista || '',
                rawTitle: title
            };
        }).filter(Boolean);

        const measures = ((state && state.historialMediciones) || []).map(record => {
            const date = parseDate(record);
            if (!date) return null;
            const eq = equipos.find(item => String(item.id) === String(record.equipo_id)) || null;
            return {
                id: record.id,
                date,
                type: record.tipo === 'termografia' ? 'termografia' : 'vibracion',
                value: parseNum(record.valor),
                point: record.punto_medicion || record.componente || 'General',
                tech: record.tecnico_nombre || '',
                equipment: eq ? eq.activo : (record.equipo_nombre || 'Equipo'),
                unit: eq ? eq.ubicacion : '',
                equipmentId: eq ? eq.id : record.equipo_id || '',
                observation: record.observaciones || record.notas || '',
                unitLabel: record.unidad || (record.tipo === 'termografia' ? 'C' : 'mm/s')
            };
        }).filter(Boolean);

        return { tasks, measures };
    }

    function openEquipment(name, unit, id) {
        const eq = resolveEquipment(name, unit, id);
        if (!eq) return;
        const state = getState();
        const sameUnit = ((state && state.equipos) || []).filter(item =>
            String(item.activo || '').trim().toLowerCase() === String(name || '').trim().toLowerCase() &&
            String(item.ubicacion || '').trim().toLowerCase() === String(unit || '').trim().toLowerCase()
        );
        if (sameUnit.length > 1 && window.elegirComponenteYAbrirFicha) window.elegirComponenteYAbrirFicha(eq.id, unit);
        else if (window.abrirFichaTecnica) window.abrirFichaTecnica(eq.id);
    }

    function renderDashboard() {
        injectStyles();
        const host = typeof mainContent !== 'undefined' ? mainContent : document.getElementById('main-content');
        const state = getState();
        if (!host || !state) return;

        charts.forEach(chart => { try { chart.destroy(); } catch (_) {} });
        charts.length = 0;

        const { tasks: tasksBase, measures: measuresBase } = buildBaseData();
        const today = startOfDay(new Date());
        let from = new Date(today);
        from.setDate(from.getDate() - 29);
        let to = new Date(today);
        let preset = 'mensual';

        function setPreset(nextPreset) {
            preset = nextPreset;
            to = new Date(today);
            from = new Date(today);
            if (nextPreset === 'semanal') from.setDate(from.getDate() - 6);
            else if (nextPreset === 'anual') from.setDate(from.getDate() - 364);
            else from.setDate(from.getDate() - 29);
        }

        function draw() {
            charts.forEach(chart => { try { chart.destroy(); } catch (_) {} });
            charts.length = 0;

            const rangeStart = startOfDay(from);
            const rangeEnd = endOfDay(to);
            const rangeDays = Math.max(1, Math.round((rangeEnd - rangeStart) / 86400000) + 1);
            const previousRangeEnd = endOfDay(new Date(rangeStart.getTime() - 86400000));
            const previousRangeStart = startOfDay(new Date(previousRangeEnd.getTime() - ((rangeDays - 1) * 86400000)));

            const tasks = tasksBase.filter(item => item.date >= rangeStart && item.date <= rangeEnd).sort((a, b) => b.date - a.date);
            const measures = measuresBase.filter(item => item.date >= rangeStart && item.date <= rangeEnd).sort((a, b) => b.date - a.date);
            const previousTasks = tasksBase.filter(item => item.date >= previousRangeStart && item.date <= previousRangeEnd);
            const previousMeasures = measuresBase.filter(item => item.date >= previousRangeStart && item.date <= previousRangeEnd);

            function equipmentKeyFor(item) {
                return item.equipmentId ? `id:${item.equipmentId}` : `${item.unit || 'Sin unidad'}::${item.equipment || 'Sin equipo'}`;
            }

            function buildCountMap(items, getter) {
                const map = new Map();
                items.forEach(item => {
                    const key = getter(item) || 'Sin dato';
                    map.set(key, (map.get(key) || 0) + 1);
                });
                return map;
            }

            const previousByType = buildCountMap(previousTasks, item => item.specialty);
            const previousByUnit = buildCountMap(previousTasks, item => item.unit || 'Sin unidad');
            const previousActiveEquipments = new Set(previousTasks.map(equipmentKeyFor));
            previousMeasures.forEach(item => previousActiveEquipments.add(equipmentKeyFor(item)));
            const previousParticipants = new Set();
            previousTasks.forEach(item => {
                if (item.leader) previousParticipants.add(item.leader);
                item.helpers.forEach(name => {
                    if (name) previousParticipants.add(name);
                });
            });
            previousMeasures.forEach(item => {
                if (item.tech) previousParticipants.add(item.tech);
            });
            const previousOts = new Set(previousTasks.map(item => item.ot).filter(Boolean));
            const previousAvisos = previousTasks.filter(item => item.aviso).length;
            const previousHh = previousTasks.reduce((acc, item) => acc + (item.hh || 0), 0);
            const previousCriticalMeasures = previousMeasures.filter(item => getMetricStatus(item.type, item.value).className === 'is-critical');
            const previousWatchMeasures = previousMeasures.filter(item => getMetricStatus(item.type, item.value).className === 'is-watch');

            const byType = new Map();
            const byUnit = new Map();
            const byEquipment = new Map();
            const byLeader = new Map();
            const hhByType = new Map();
            const hhByUnit = new Map();
            const hhByLeader = new Map();
            const participants = new Set();
            const activeEquipments = new Set();
            const participantStats = new Map();
            const equipmentStats = new Map();
            const otStats = new Map();
            let hh = 0;
            let avisos = 0;
            const ots = new Set();

            function ensureEquipmentStat(item) {
                const key = equipmentKeyFor(item);
                if (!equipmentStats.has(key)) {
                    equipmentStats.set(key, {
                        key,
                        equipment: item.equipment || 'Sin equipo',
                        unit: item.unit || 'Sin unidad',
                        equipmentId: item.equipmentId || '',
                        tasks: 0,
                        measures: 0,
                        hh: 0,
                        latest: item.date || null
                    });
                }
                return equipmentStats.get(key);
            }

            function recordParticipant(name, mode, item) {
                const clean = String(name || '').trim();
                if (!clean) return;
                if (!participantStats.has(clean)) {
                    participantStats.set(clean, {
                        name: clean,
                        leaderCount: 0,
                        helperCount: 0,
                        measureCount: 0,
                        hh: 0,
                        units: new Set(),
                        latest: item.date || null
                    });
                }
                const stat = participantStats.get(clean);
                if (mode === 'leader') {
                    stat.leaderCount += 1;
                    stat.hh += item.hh || 0;
                } else if (mode === 'helper') {
                    stat.helperCount += 1;
                    stat.hh += item.hh || 0;
                } else if (mode === 'measure') {
                    stat.measureCount += 1;
                }
                if (item.unit) stat.units.add(item.unit);
                if (!stat.latest || (item.date && item.date > stat.latest)) stat.latest = item.date;
            }

            tasks.forEach(item => {
                byType.set(item.specialty, (byType.get(item.specialty) || 0) + 1);
                byUnit.set(item.unit || 'Sin unidad', (byUnit.get(item.unit || 'Sin unidad') || 0) + 1);
                byEquipment.set(item.equipment, (byEquipment.get(item.equipment) || 0) + 1);
                byLeader.set(item.leader, (byLeader.get(item.leader) || 0) + 1);
                hhByType.set(item.specialty, (hhByType.get(item.specialty) || 0) + (item.hh || 0));
                hhByUnit.set(item.unit || 'Sin unidad', (hhByUnit.get(item.unit || 'Sin unidad') || 0) + (item.hh || 0));
                hhByLeader.set(item.leader || 'Sin lider', (hhByLeader.get(item.leader || 'Sin lider') || 0) + (item.hh || 0));
                hh += item.hh;
                if (item.aviso) avisos += 1;
                if (item.ot) ots.add(item.ot);
                if (item.leader) participants.add(item.leader);
                item.helpers.forEach(name => participants.add(name));
                activeEquipments.add(equipmentKeyFor(item));

                const equipmentStat = ensureEquipmentStat(item);
                equipmentStat.tasks += 1;
                equipmentStat.hh += item.hh || 0;
                if (!equipmentStat.latest || item.date > equipmentStat.latest) equipmentStat.latest = item.date;

                recordParticipant(item.leader, 'leader', item);
                item.helpers.forEach(name => recordParticipant(name, 'helper', item));

                if (item.ot) {
                    if (!otStats.has(item.ot)) {
                        otStats.set(item.ot, {
                            ot: item.ot,
                            count: 0,
                            hh: 0,
                            units: new Set(),
                            equipments: new Set(),
                            avisos: new Set(),
                            latest: item.date || null,
                            sampleTaskId: item.id || ''
                        });
                    }
                    const stat = otStats.get(item.ot);
                    stat.count += 1;
                    stat.hh += item.hh || 0;
                    if (item.unit) stat.units.add(item.unit);
                    if (item.equipment) stat.equipments.add(item.equipment);
                    if (item.aviso) stat.avisos.add(item.aviso);
                    if (!stat.latest || item.date > stat.latest) stat.latest = item.date;
                }
            });

            measures.forEach(item => {
                if (item.tech) participants.add(item.tech);
                if (item.equipment) activeEquipments.add(equipmentKeyFor(item));
                const equipmentStat = ensureEquipmentStat(item);
                equipmentStat.measures += 1;
                if (!equipmentStat.latest || item.date > equipmentStat.latest) equipmentStat.latest = item.date;
                recordParticipant(item.tech, 'measure', item);
            });

            const topUnit = [...byUnit.entries()].sort((a, b) => b[1] - a[1])[0];
            const topType = [...byType.entries()].sort((a, b) => b[1] - a[1])[0];
            const topLeaders = [...byLeader.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
            const topEquipments = [...byEquipment.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
            const maxVib = measures.filter(item => item.type === 'vibracion').sort((a, b) => b.value - a.value)[0] || null;
            const maxTemp = measures.filter(item => item.type === 'termografia').sort((a, b) => b.value - a.value)[0] || null;
            const topEquipment = topEquipments[0] || null;
            const tasksPerDay = tasks.length / rangeDays;
            const measuresPerDay = measures.length / rangeDays;
            const avgHhPerTask = tasks.length ? hh / tasks.length : 0;
            const heroSpecialties = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
            const latestTask = tasks[0] || null;
            const equipmentList = [...equipmentStats.values()].sort((a, b) => ((b.tasks + b.measures) - (a.tasks + a.measures)) || (b.hh - a.hh));
            const participantList = [...participantStats.values()].sort((a, b) => ((b.leaderCount + b.helperCount + b.measureCount) - (a.leaderCount + a.helperCount + a.measureCount)) || (b.hh - a.hh));
            const otList = [...otStats.values()].sort((a, b) => (b.latest?.getTime?.() || 0) - (a.latest?.getTime?.() || 0));
            const topEquipmentStat = topEquipment ? equipmentList.find(stat => stat.equipment === topEquipment[0]) || null : null;
            const conditionSummary = summarizeCondition(measures);
            const previousConditionSummary = summarizeCondition(previousMeasures);
            const maxVibStatus = maxVib ? getMetricStatus('vibracion', maxVib.value) : null;
            const maxTempStatus = maxTemp ? getMetricStatus('termografia', maxTemp.value) : null;
            const conditionHeadlineStatus = maxTempStatus || maxVibStatus || conditionSummary;
            const criticalMeasures = measures.filter(item => getMetricStatus(item.type, item.value).className === 'is-critical');
            const watchMeasures = measures.filter(item => getMetricStatus(item.type, item.value).className === 'is-watch');
            const recurrentEquipments = equipmentList.filter(stat => (stat.tasks + stat.measures) >= 3 || stat.tasks >= 2);
            const criticalEquipmentSet = new Set(criticalMeasures.map(item => equipmentKeyFor(item)));
            const previousAvgHhPerTask = previousTasks.length ? previousHh / previousTasks.length : 0;
            const comparisonCards = {
                tasks: getComparisonMeta(tasks.length, previousTasks.length, 0),
                measures: getComparisonMeta(measures.length, previousMeasures.length, 0),
                hh: getComparisonMeta(hh, previousHh, 1),
                ots: getComparisonMeta(ots.size, previousOts.size, 0),
                activeEquipments: getComparisonMeta(activeEquipments.size, previousActiveEquipments.size, 0),
                participants: getComparisonMeta(participants.size, previousParticipants.size, 0),
                topUnit: getComparisonMeta(topUnit ? topUnit[1] : 0, topUnit ? (previousByUnit.get(topUnit[0]) || 0) : 0, 0),
                topType: getComparisonMeta(topType ? topType[1] : 0, topType ? (previousByType.get(topType[0]) || 0) : 0, 0),
                tasksPerDay: getComparisonMeta(tasksPerDay, previousTasks.length / rangeDays, 1),
                avgHhPerTask: getComparisonMeta(avgHhPerTask, previousAvgHhPerTask, 1),
                critical: getComparisonMeta(criticalMeasures.length, previousCriticalMeasures.length, 0, { invert: true }),
                watch: getComparisonMeta(watchMeasures.length, previousWatchMeasures.length, 0, { invert: true }),
                condition: getComparisonMeta(
                    criticalMeasures.length + watchMeasures.length,
                    previousCriticalMeasures.length + previousWatchMeasures.length,
                    0,
                    { invert: true }
                )
            };
            const conditionHeadline = maxTemp
                ? {
                    label: 'Temperatura pico',
                    value: `${formatNumber(maxTemp.value, 1)} C`,
                    meta: `${esc(maxTemp.equipment || 'Sin equipo')} &middot; ${esc(maxTemp.unit || 'Sin unidad')}`
                }
                : maxVib
                    ? {
                        label: 'Vibracion pico',
                        value: `${formatNumber(maxVib.value, 2)} mm/s`,
                        meta: `${esc(maxVib.equipment || 'Sin equipo')} &middot; ${esc(maxVib.unit || 'Sin unidad')}`
                    }
                    : {
                        label: 'Condicion destacada',
                        value: 'Sin datos',
                        meta: 'Aun no hay mediciones en el rango.'
                    };
            const priorityAlerts = [
                criticalMeasures[0]
                    ? {
                        drill: 'measure',
                        measureId: criticalMeasures[0].id || '',
                        title: criticalMeasures[0].equipment,
                        meta: `${criticalMeasures[0].unit || 'Sin unidad'} &middot; ${criticalMeasures[0].point}`,
                        value: `${formatNumber(criticalMeasures[0].value, criticalMeasures[0].type === 'vibracion' ? 2 : 1)} ${criticalMeasures[0].type === 'vibracion' ? 'mm/s' : 'C'}`
                    }
                    : null,
                watchMeasures[0]
                    ? {
                        drill: 'measure',
                        measureId: watchMeasures[0].id || '',
                        title: watchMeasures[0].equipment,
                        meta: `${watchMeasures[0].unit || 'Sin unidad'} &middot; seguimiento activo`,
                        value: `${formatNumber(watchMeasures[0].value, watchMeasures[0].type === 'vibracion' ? 2 : 1)} ${watchMeasures[0].type === 'vibracion' ? 'mm/s' : 'C'}`
                    }
                    : null,
                recurrentEquipments[0]
                    ? {
                        drill: 'equipment',
                        id: recurrentEquipments[0].equipmentId || '',
                        name: recurrentEquipments[0].equipment,
                        unit: recurrentEquipments[0].unit,
                        title: recurrentEquipments[0].equipment,
                        meta: `${recurrentEquipments[0].unit || 'Sin unidad'} &middot; ${formatNumber(recurrentEquipments[0].measures)} medicion(es)`,
                        value: `${formatNumber(recurrentEquipments[0].tasks)} trabajo(s)`
                    }
                    : null
            ].filter(Boolean);

            const granularity = getGranularity(rangeStart, rangeEnd);
            const series = new Map();
            tasks.forEach(item => {
                const key = periodKey(item.date, granularity);
                if (!series.has(key)) series.set(key, {
                    jobs: 0,
                    hh: 0,
                    measureCount: 0,
                    vibSum: 0,
                    vibCount: 0,
                    tempSum: 0,
                    tempCount: 0,
                    otSet: new Set(),
                    equipmentSet: new Set(),
                    participantSet: new Set(),
                    unitMap: new Map(),
                    specialtyMap: new Map()
                });
                const current = series.get(key);
                current.jobs += 1;
                current.hh += item.hh;
                if (item.ot) current.otSet.add(item.ot);
                current.equipmentSet.add(equipmentKeyFor(item));
                if (item.leader) current.participantSet.add(item.leader);
                item.helpers.forEach(name => {
                    if (name) current.participantSet.add(name);
                });
                current.unitMap.set(item.unit || 'Sin unidad', (current.unitMap.get(item.unit || 'Sin unidad') || 0) + 1);
                current.specialtyMap.set(item.specialty, (current.specialtyMap.get(item.specialty) || 0) + 1);
            });
            measures.forEach(item => {
                const key = periodKey(item.date, granularity);
                if (!series.has(key)) series.set(key, {
                    jobs: 0,
                    hh: 0,
                    measureCount: 0,
                    vibSum: 0,
                    vibCount: 0,
                    tempSum: 0,
                    tempCount: 0,
                    otSet: new Set(),
                    equipmentSet: new Set(),
                    participantSet: new Set(),
                    unitMap: new Map(),
                    specialtyMap: new Map()
                });
                const current = series.get(key);
                current.measureCount += 1;
                current.equipmentSet.add(equipmentKeyFor(item));
                if (item.tech) current.participantSet.add(item.tech);
                if (item.type === 'vibracion') {
                    current.vibSum += item.value;
                    current.vibCount += 1;
                } else {
                    current.tempSum += item.value;
                    current.tempCount += 1;
                }
            });

            const keys = [...series.keys()].sort();
            const labels = keys.map(key => periodLabel(key, granularity));
            const jobs = keys.map(key => series.get(key).jobs);
            const hhSeries = keys.map(key => Number(series.get(key).hh.toFixed(1)));
            const measureSeries = keys.map(key => series.get(key).measureCount);
            const otSeries = keys.map(key => series.get(key).otSet.size);
            const equipmentSeries = keys.map(key => series.get(key).equipmentSet.size);
            const participantSeries = keys.map(key => series.get(key).participantSet.size);
            const vibSeries = keys.map(key => {
                const item = series.get(key);
                return item.vibCount ? Number((item.vibSum / item.vibCount).toFixed(2)) : null;
            });
            const tempSeries = keys.map(key => {
                const item = series.get(key);
                return item.tempCount ? Number((item.tempSum / item.tempCount).toFixed(1)) : null;
            });
            const vibPoints = keys
                .map((key, index) => ({ key, label: labels[index], value: vibSeries[index] }))
                .filter(point => point.value != null && Number.isFinite(Number(point.value)));
            const tempPoints = keys
                .map((key, index) => ({ key, label: labels[index], value: tempSeries[index] }))
                .filter(point => point.value != null && Number.isFinite(Number(point.value)));
            const vibChartKeys = vibPoints.map(point => point.key);
            const vibChartLabels = vibPoints.map(point => point.label);
            const vibChartSeries = vibPoints.map(point => Number(point.value));
            const tempChartKeys = tempPoints.map(point => point.key);
            const tempChartLabels = tempPoints.map(point => point.label);
            const tempChartSeries = tempPoints.map(point => Number(point.value));
            const topUnitSeries = keys.map(key => topUnit ? (series.get(key).unitMap.get(topUnit[0]) || 0) : 0);
            const topTypeSeries = keys.map(key => topType ? (series.get(key).specialtyMap.get(topType[0]) || 0) : 0);
            const getPreviousDefinedValue = (seriesData, index) => {
                for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
                    const candidate = seriesData[cursor];
                    if (candidate != null && Number.isFinite(Number(candidate))) return Number(candidate);
                }
                return null;
            };
            const getLatestDefinedPoint = seriesData => {
                for (let cursor = seriesData.length - 1; cursor >= 0; cursor -= 1) {
                    const candidate = seriesData[cursor];
                    if (candidate != null && Number.isFinite(Number(candidate))) {
                        return { index: cursor, value: Number(candidate) };
                    }
                }
                return null;
            };
            const getPeakPoint = seriesData => {
                let peak = null;
                seriesData.forEach((candidate, index) => {
                    if (candidate == null || !Number.isFinite(Number(candidate))) return;
                    if (!peak || Number(candidate) > peak.value) {
                        peak = { index, value: Number(candidate) };
                    }
                });
                return peak;
            };
            const sharePercent = (value, total) => total ? Math.round((Number(value || 0) / total) * 100) : 0;
            const formatSeriesDelta = (seriesData, index, decimals, unitLabel) => {
                const previousValue = getPreviousDefinedValue(seriesData, index);
                if (previousValue == null) return 'Primer bloque del rango';
                const currentValue = Number(seriesData[index] || 0);
                const delta = currentValue - previousValue;
                const sign = delta > 0 ? '+' : delta < 0 ? '-' : '±';
                return `Vs. bloque previo: ${sign}${formatNumber(Math.abs(delta), decimals)} ${unitLabel}`;
            };
            const formatThresholdGap = (value, watch, critical, decimals, unitLabel) => {
                if (!Number.isFinite(Number(value))) return 'Sin lectura valida';
                const numeric = Number(value);
                if (numeric >= critical) return `Sobre atencion: +${formatNumber(numeric - critical, decimals)} ${unitLabel}`;
                if (numeric >= watch) return `Sobre seguimiento: +${formatNumber(numeric - watch, decimals)} ${unitLabel}`;
                return `Margen a seguimiento: ${formatNumber(watch - numeric, decimals)} ${unitLabel}`;
            };
            const jobsPeak = getPeakPoint(jobs);
            const hhPeak = getPeakPoint(hhSeries);
            const vibLatestPoint = getLatestDefinedPoint(vibSeries);
            const vibPeakPoint = getPeakPoint(vibSeries);
            const tempLatestPoint = getLatestDefinedPoint(tempSeries);
            const tempPeakPoint = getPeakPoint(tempSeries);

            const highlighted = measures.filter(item => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 6);
            const specialtyHtml = heroSpecialties.length
                ? heroSpecialties.map(([name, total]) => `
<button type="button" class="analytics-specialty-pill analytics-clickable" data-drill="specialty" data-specialty="${esc(name)}" style="${buildAccentVars(getAccentColor(name), 0.12, 0.24)}">
  <span class="analytics-specialty-swatch" style="background:${TYPE_COLORS[name] || '#94a3b8'}"></span>
  ${esc(name)}
  <strong>${formatNumber(total)}</strong>
</button>`).join('')
                : '<span class="analytics-specialty-pill is-muted">Sin especialidades registradas en el rango.</span>';
            const normalMeasures = Math.max(measures.length - criticalMeasures.length - watchMeasures.length, 0);
            const vibCount = measures.filter(x => x.type === 'vibracion').length;
            const tempCount = measures.filter(x => x.type === 'termografia').length;
            const unitPalette = ['#f97316', '#fb923c', '#fdba74', '#94a3b8', '#64748b'];
            const hhPalette = ['#f97316', '#fb923c', '#f59e0b', '#94a3b8', '#64748b'];
            const specialtyEntries = [...byType.entries()].sort((a, b) => b[1] - a[1]);
            const unitEntries = [...byUnit.entries()].sort((a, b) => b[1] - a[1]);
            const hhTypeEntries = [...hhByType.entries()].sort((a, b) => b[1] - a[1]);
            const hhUnitEntries = [...hhByUnit.entries()].sort((a, b) => b[1] - a[1]);
            const hhLeaderEntries = [...hhByLeader.entries()].sort((a, b) => b[1] - a[1]);
            const hhEquipmentEntries = equipmentList
                .filter(stat => (stat.hh || 0) > 0)
                .map(stat => ({
                    label: stat.equipment,
                    value: stat.hh || 0,
                    unit: stat.unit || 'Sin unidad',
                    equipmentId: stat.equipmentId || ''
                }))
                .sort((a, b) => b.value - a.value);
            const specialtyTop = specialtyEntries.slice(0, 4);
            const specialtyOther = specialtyEntries.slice(4).reduce((acc, [, value]) => acc + value, 0);
            const specialtyBarOther = specialtyEntries.slice(5).reduce((acc, [, value]) => acc + value, 0);
            const unitTop = unitEntries.slice(0, 4);
            const unitOther = unitEntries.slice(4).reduce((acc, [, value]) => acc + value, 0);
            const unitBarOther = unitEntries.slice(5).reduce((acc, [, value]) => acc + value, 0);
            const topTypePercent = tasks.length ? Math.round(((topType ? topType[1] : 0) / tasks.length) * 100) : 0;
            const topUnitPercent = tasks.length ? Math.round(((topUnit ? topUnit[1] : 0) / tasks.length) * 100) : 0;
            const topHhType = hhTypeEntries[0];
            const topHhUnit = hhUnitEntries[0];
            const topHhTypePercent = hh ? Math.round(((topHhType ? topHhType[1] : 0) / hh) * 100) : 0;
            const topHhUnitPercent = hh ? Math.round(((topHhUnit ? topHhUnit[1] : 0) / hh) * 100) : 0;
            const controlledPercent = measures.length ? Math.round((normalMeasures / measures.length) * 100) : 0;
            const conditionAccent = criticalMeasures.length ? '#ef4444' : (watchMeasures.length ? '#f59e0b' : '#10b981');
            function buildShareSegments(entries, options = {}) {
                const topEntries = entries.slice(0, options.limit || 4);
                const totalBase = Number(options.total ?? hh);
                const used = topEntries.reduce((acc, entry) => {
                    const value = Number(options.valueAccessor ? options.valueAccessor(entry) : (entry.value ?? entry[1] ?? 0));
                    return acc + value;
                }, 0);
                const segments = topEntries.map((entry, index) => {
                    const label = options.labelAccessor ? options.labelAccessor(entry) : (entry.label ?? entry[0] ?? 'Sin dato');
                    const value = Number(options.valueAccessor ? options.valueAccessor(entry) : (entry.value ?? entry[1] ?? 0));
                    return {
                        label,
                        value,
                        color: typeof options.colorAccessor === 'function'
                            ? options.colorAccessor(entry, index)
                            : (options.palette || hhPalette)[index % (options.palette || hhPalette).length],
                        meta: options.metaAccessor ? options.metaAccessor(entry, value, index) : `${formatNumber(value, 1)} HH`
                    };
                });
                const other = Number((totalBase - used).toFixed(1));
                if (other > 0.04) {
                    segments.push({
                        label: 'Otros',
                        value: other,
                        color: '#cbd5e1',
                        meta: options.otherMeta ? options.otherMeta(other) : `${formatNumber(other, 1)} HH`
                    });
                }
                return segments;
            }
            const mixedVisualCardsHtml = [
                buildPrintDonutCard({
                    title: 'HH por especialidad',
                    meta: hh ? 'Distribucion real de horas-hombre por tecnica.' : 'Sin HH declaradas en el rango.',
                    centerValue: `${topHhTypePercent}%`,
                    centerLabel: 'tecnica foco',
                    accent: getAccentColor(topHhType ? topHhType[0] : 'Otros'),
                    segments: buildShareSegments(hhTypeEntries, {
                        colorAccessor: entry => getAccentColor(entry[0]),
                        metaAccessor: (_entry, value) => `${formatNumber(value, 1)} HH`
                    }),
                    className: 'analytics-clickable',
                    attrs: topHhType ? `data-drill="specialty" data-specialty="${esc(topHhType[0])}"` : 'data-drill="hh-all"'
                }),
                buildPrintDonutCard({
                    title: 'HH por unidad',
                    meta: hh ? 'Concentracion de HH por unidad intervenida.' : 'Sin unidades con HH registradas.',
                    centerValue: `${topHhUnitPercent}%`,
                    centerLabel: 'unidad foco',
                    accent: topHhUnit ? unitPalette[0] : '#94a3b8',
                    segments: buildShareSegments(hhUnitEntries, {
                        palette: unitPalette,
                        metaAccessor: (_entry, value) => `${formatNumber(value, 1)} HH`
                    }),
                    className: 'analytics-clickable',
                    attrs: topHhUnit ? `data-drill="unit" data-unit="${esc(topHhUnit[0])}"` : 'data-drill="hh-all"'
                }),
                buildPrintDonutCard({
                    title: 'Trabajos por unidad',
                    meta: tasks.length ? 'Participacion de cierres por unidad dentro del rango.' : 'Sin trabajos cerrados para distribuir.',
                    centerValue: `${topUnitPercent}%`,
                    centerLabel: 'unidad foco',
                    accent: topUnit ? unitPalette[0] : '#94a3b8',
                    segments: buildShareSegments(unitEntries, {
                        total: tasks.length,
                        palette: unitPalette,
                        metaAccessor: (_entry, value) => `${formatNumber(value)} trabajo(s)`,
                        otherMeta: value => `${formatNumber(value)} trabajo(s)`
                    }),
                    className: 'analytics-clickable',
                    attrs: topUnit ? `data-drill="unit" data-unit="${esc(topUnit[0])}"` : 'data-drill="tasks-all"'
                }),
                buildPrintDonutCard({
                    title: 'Tipos de trabajo',
                    meta: tasks.length ? 'Composicion del trabajo ejecutado por especialidad.' : 'Sin trabajos cerrados para distribuir.',
                    centerValue: `${topTypePercent}%`,
                    centerLabel: 'dominante',
                    accent: getAccentColor(topType ? topType[0] : 'Otros'),
                    segments: buildShareSegments(specialtyEntries, {
                        total: tasks.length,
                        colorAccessor: entry => getAccentColor(entry[0]),
                        metaAccessor: (_entry, value) => `${formatNumber(value)} trabajo(s)`,
                        otherMeta: value => `${formatNumber(value)} trabajo(s)`
                    }),
                    className: 'analytics-clickable',
                    attrs: topType ? `data-drill="specialty" data-specialty="${esc(topType[0])}"` : 'data-drill="tasks-all"'
                })
            ].join('');
            const operationKpiCards = [
                { icon: 'fa-list-check', label: 'Trabajos cerrados', value: formatNumber(tasks.length), meta: `${formatNumber(tasksPerDay, 1)} por dia`, drill: 'tasks-all', color: '#f97316', series: jobs, compare: comparisonCards.tasks },
                { icon: 'fa-business-time', label: 'HH registradas', value: formatNumber(hh, 1), meta: `${formatNumber(hh / rangeDays, 1)} HH por dia`, drill: 'hh-all', color: '#fb923c', series: hhSeries, compare: comparisonCards.hh },
                { icon: 'fa-hashtag', label: 'OT cerradas', value: formatNumber(ots.size), meta: `${formatNumber(avisos)} aviso(s)`, drill: 'ots-all', color: '#64748b', series: otSeries, compare: comparisonCards.ots },
                { icon: 'fa-gears', label: 'Equipos intervenidos', value: formatNumber(activeEquipments.size), meta: `${formatNumber(unitEntries.length)} unidad(es) activas`, drill: 'equipments-all', color: '#94a3b8', series: equipmentSeries, compare: comparisonCards.activeEquipments }
            ];
            const conditionKpiCards = [
                { icon: 'fa-wave-square', label: 'Mediciones', value: formatNumber(measures.length), meta: `${measures.filter(x => x.type === 'vibracion').length} vib / ${measures.filter(x => x.type === 'termografia').length} termo`, drill: 'measures-all', color: '#f97316', series: measureSeries, compare: comparisonCards.measures },
                { icon: 'fa-triangle-exclamation', label: 'Lecturas criticas', value: formatNumber(criticalMeasures.length), meta: `${formatNumber(criticalEquipmentSet.size)} equipo(s)`, drill: 'critical-measures', color: '#dc2626', series: measureSeries, compare: comparisonCards.critical },
                { icon: 'fa-binoculars', label: 'Seguimiento activo', value: formatNumber(watchMeasures.length), meta: 'alertas por revisar', drill: 'watch-measures', color: '#d97706', series: measureSeries, compare: comparisonCards.watch },
                { icon: 'fa-shield-halved', label: 'Condicion general', value: conditionSummary.label, meta: conditionSummary.note, drill: 'comparison', color: conditionAccent, series: measureSeries, compare: comparisonCards.condition }
            ];
            const renderKpiCard = card => {
                const trend = getTrendMeta(card.series || []);
                const spark = buildSparklineSvg(card.series || [], card.color || '#94a3b8', 0.12);
                return `
    <article class="analytics-kpi-card analytics-clickable" style="--kpi-accent:${card.color || '#94a3b8'};--kpi-accent-soft:${hexToRgba(card.color || '#94a3b8', 0.12)};--kpi-accent-border:${hexToRgba(card.color || '#94a3b8', 0.22)}" data-drill="${card.drill || ''}" data-unit="${esc(card.unit || '')}" data-specialty="${esc(card.specialty || '')}">
      <div class="analytics-kpi-top">
        <span class="analytics-kpi-label">${card.label}</span>
        <span class="analytics-kpi-icon"><i class="fa-solid ${card.icon}"></i></span>
      </div>
      <strong class="analytics-kpi-value">${card.value}</strong>
      <span class="analytics-kpi-meta">${card.meta}</span>
      <div class="analytics-kpi-foot">
        <div class="analytics-kpi-insights">
          <span class="analytics-kpi-trend ${trend.className}"><i class="fa-solid ${trend.icon}"></i> ${trend.label}</span>
          ${card.compare ? `<span class="analytics-compare-badge ${card.compare.className}"><i class="fa-solid ${card.compare.icon}"></i> ${card.compare.shortLabel}</span>` : ''}
        </div>
        ${spark ? `<span class="analytics-kpi-spark">${spark}</span>` : ''}
      </div>
    </article>`;
            };
            const operationKpiHtml = operationKpiCards.map(renderKpiCard).join('');
            const conditionKpiHtml = conditionKpiCards.map(renderKpiCard).join('');
            const highlightedHtml = highlighted.length === 0
                ? '<p class="analytics-empty">Sin mediciones en el rango.</p>'
                : highlighted.map(item => {
                    const typeName = item.type === 'vibracion' ? 'Vibraciones' : 'Termografia';
                    const status = getMetricStatus(item.type, item.value);
                    return `
<div class="analytics-reading-item analytics-clickable ${status.cardClass}" data-drill="measure" data-measure-id="${esc(item.id || '')}">
  <div class="analytics-reading-main">
    <div class="analytics-reading-head">
      <div>
        <strong>${esc(item.equipment)}</strong>
        <span>${esc(item.unit || 'Sin unidad')} &middot; ${esc(item.point)}</span>
      </div>
      ${renderTypeBadge(typeName, item.type === 'vibracion' ? 'Vibracion' : 'Termografia')}
    </div>
    <div class="analytics-reading-meta">
      <span><i class="fa-regular fa-calendar"></i> ${esc(formatDateTime(item.date))}</span>
      <span><i class="fa-solid fa-user-gear"></i> ${esc(item.tech || 'Sin tecnico')}</span>
    </div>
  </div>
  <div class="analytics-reading-badges">
    <div class="analytics-reading-value ${item.type === 'vibracion' ? 'is-vib' : 'is-temp'}">${formatNumber(item.value, item.type === 'vibracion' ? 2 : 1)} ${item.type === 'vibracion' ? 'mm/s' : 'C'}</div>
    <span class="analytics-status-badge ${status.className}"><i class="fa-solid fa-circle"></i> ${status.label}</span>
  </div>
</div>`;
                }).join('');
            const leaderHtml = topLeaders.length === 0
                ? '<p class="analytics-empty">Sin lideres en el rango.</p>'
                : topLeaders.map(([name, total], index) => `
<div class="analytics-ranking-item analytics-clickable" data-drill="participant" data-name="${esc(name)}">
  <span class="analytics-ranking-pos">${index + 1}</span>
  <div>
    <strong>${esc(name)}</strong>
    <span>${formatNumber(total)} trabajo(s)</span>
  </div>
</div>`).join('');
            const priorityAlertsHtml = priorityAlerts.length
                ? priorityAlerts.map(item => `
<div class="analytics-alert-item analytics-clickable" data-drill="${item.drill}" ${item.measureId ? `data-measure-id="${esc(item.measureId)}"` : ''} ${item.name ? `data-name="${esc(item.name)}"` : ''} ${item.unit ? `data-unit="${esc(item.unit)}"` : ''} ${item.id ? `data-id="${esc(item.id)}"` : ''}>
  <div>
    <strong>${esc(item.title)}</strong>
    <span>${esc(item.meta)}</span>
  </div>
  <strong>${esc(item.value)}</strong>
</div>`).join('')
                : '<p class="analytics-empty">Sin alertas prioritarias en el rango seleccionado.</p>';
            const printDonutCardsHtml = [
                buildPrintDonutCard({
                    title: 'Distribucion por especialidad',
                    meta: tasks.length ? `${formatNumber(tasks.length)} trabajo(s) cerrados en el rango.` : 'Sin trabajos cerrados en el rango.',
                    centerValue: `${topTypePercent}%`,
                    centerLabel: 'dominante',
                    accent: getAccentColor(topType ? topType[0] : 'Otros'),
                    segments: [
                        ...specialtyTop.map(([label, value]) => ({
                            label,
                            value,
                            color: getAccentColor(label),
                            meta: `${formatNumber(value)} trabajo(s)`
                        })),
                        ...(specialtyOther > 0 ? [{
                            label: 'Otras especialidades',
                            value: specialtyOther,
                            color: '#94a3b8',
                            meta: `${formatNumber(specialtyOther)} trabajo(s)`
                        }] : [])
                    ]
                }),
                buildPrintDonutCard({
                    title: 'Distribucion por unidad',
                    meta: unitEntries.length ? `${formatNumber(unitEntries.length)} unidad(es) con actividad.` : 'Sin unidades con actividad en el rango.',
                    centerValue: `${topUnitPercent}%`,
                    centerLabel: 'unidad foco',
                    accent: '#2563eb',
                    segments: [
                        ...unitTop.map(([label, value], index) => ({
                            label,
                            value,
                            color: unitPalette[index % unitPalette.length],
                            meta: `${formatNumber(value)} trabajo(s)`
                        })),
                        ...(unitOther > 0 ? [{
                            label: 'Otras unidades',
                            value: unitOther,
                            color: '#cbd5e1',
                            meta: `${formatNumber(unitOther)} trabajo(s)`
                        }] : [])
                    ]
                }),
                buildPrintDonutCard({
                    title: 'Estado de condicion',
                    meta: measures.length ? `${formatNumber(measures.length)} medicion(es) evaluadas.` : 'Sin mediciones para evaluar condicion.',
                    centerValue: `${controlledPercent}%`,
                    centerLabel: 'controlado',
                    accent: criticalMeasures.length ? '#ef4444' : (watchMeasures.length ? '#f59e0b' : '#10b981'),
                    segments: [
                        { label: 'Controlado', value: normalMeasures, color: '#10b981', meta: `${formatNumber(normalMeasures)} lectura(s)` },
                        { label: 'Seguimiento', value: watchMeasures.length, color: '#f59e0b', meta: `${formatNumber(watchMeasures.length)} lectura(s)` },
                        { label: 'Atencion', value: criticalMeasures.length, color: '#ef4444', meta: `${formatNumber(criticalMeasures.length)} lectura(s)` }
                    ]
                }),
                buildPrintDonutCard({
                    title: 'Mix de mediciones',
                    meta: measures.length ? 'Composicion del levantamiento del periodo.' : 'Sin mediciones registradas en el rango.',
                    centerValue: formatNumber(measures.length),
                    centerLabel: 'mediciones',
                    accent: vibCount >= tempCount ? '#f97316' : '#14b8a6',
                    segments: [
                        { label: 'Vibracion', value: vibCount, color: '#f97316', meta: `${formatNumber(vibCount)} registro(s)` },
                        { label: 'Termografia', value: tempCount, color: '#14b8a6', meta: `${formatNumber(tempCount)} registro(s)` }
                    ]
                })
            ].join('');
            const printHeroTilesHtml = [
                {
                    accent: '#0f172a',
                    icon: 'fa-clipboard-check',
                    eyebrow: 'Pulso operativo',
                    value: `${formatNumber(tasks.length)} cierres`,
                    meta: `${formatNumber(tasksPerDay, 1)} por dia · ${formatNumber(hh, 1)} HH acumuladas`
                },
                {
                    accent: '#2563eb',
                    eyebrow: 'Unidad foco',
                    value: topUnit ? topUnit[0] : 'Sin unidad',
                    meta: topUnit ? `${formatNumber(topUnit[1])} trabajo(s) · ${topUnitPercent}% del total` : 'Sin concentracion de unidad en el rango'
                },
                {
                    accent: getAccentColor(topType ? topType[0] : 'Otros'),
                    eyebrow: 'Especialidad lider',
                    value: topType ? topType[0] : 'Sin especialidad',
                    meta: topType ? `${formatNumber(topType[1])} registro(s) · ${topTypePercent}% del total` : 'Sin especialidad dominante en el rango'
                },
                {
                    accent: conditionAccent,
                    eyebrow: 'Condicion general',
                    value: conditionSummary.label,
                    meta: conditionSummary.note
                }
            ].map(item => `
<article class="analytics-print-hero-card" style="--print-hero-accent:${item.accent};--print-hero-accent-soft:${hexToRgba(item.accent, 0.18)};">
  <span>${esc(item.eyebrow)}</span>
  <strong>${esc(item.value)}</strong>
  <small>${esc(item.meta)}</small>
</article>`).join('');
            const printHeroTilesHtmlEnhanced = [
                {
                    accent: '#0f172a',
                    icon: 'fa-clipboard-check',
                    eyebrow: 'Pulso operativo',
                    value: `${formatNumber(tasks.length)} cierres`,
                    meta: 'Resumen consolidado de cierres ejecutados durante el periodo.',
                    chips: [
                        `${formatNumber(tasksPerDay, 1)} por dia`,
                        `${formatNumber(hh, 1)} HH acumuladas`,
                        comparisonCards.tasks.shortLabel
                    ]
                },
                {
                    accent: '#475569',
                    icon: 'fa-location-dot',
                    eyebrow: 'Unidad foco',
                    value: topUnit ? topUnit[0] : 'Sin unidad',
                    meta: topUnit ? 'Unidad con mayor concentracion operacional dentro del rango.' : 'Sin concentracion de unidad en el rango.',
                    chips: topUnit ? [
                        `${formatNumber(topUnit[1])} trabajo(s)`,
                        `${topUnitPercent}% del total`
                    ] : ['Sin datos consolidados']
                },
                {
                    accent: getAccentColor(topType ? topType[0] : 'Otros'),
                    icon: 'fa-chart-pie',
                    eyebrow: 'Especialidad lider',
                    value: topType ? topType[0] : 'Sin especialidad',
                    meta: topType ? 'Tecnica con mayor volumen de actividad dentro del periodo.' : 'Sin especialidad dominante en el rango.',
                    chips: topType ? [
                        `${formatNumber(topType[1])} registro(s)`,
                        `${topTypePercent}% del total`
                    ] : ['Sin datos consolidados']
                },
                {
                    accent: conditionAccent,
                    icon: 'fa-shield-halved',
                    eyebrow: 'Condicion general',
                    value: conditionSummary.label,
                    meta: 'Lectura global del estado operacional del periodo.',
                    chips: [
                        `${formatNumber(watchMeasures.length)} seguimiento`,
                        `${formatNumber(criticalMeasures.length)} criticas`,
                        comparisonCards.condition.shortLabel
                    ]
                }
            ].map(item => `
<article class="analytics-print-hero-card" style="--print-hero-accent:${item.accent};--print-hero-accent-soft:${hexToRgba(item.accent, 0.18)};">
  <div class="analytics-print-hero-top">
    <div>
      <span class="analytics-print-hero-label">${esc(item.eyebrow)}</span>
    </div>
    <span class="analytics-print-hero-icon"><i class="fa-solid ${item.icon}"></i></span>
  </div>
  <strong>${esc(item.value)}</strong>
  <small>${esc(item.meta)}</small>
  <div class="analytics-print-hero-chip-row">
    ${(item.chips || []).map(chip => `<span class="analytics-print-hero-chip"><i class="fa-solid fa-circle-dot"></i> ${esc(chip)}</span>`).join('')}
  </div>
</article>`).join('');
            const printBriefingHtml = [
                {
                    accent: '#f97316',
                    label: 'Lectura ejecutiva',
                    title: topType ? `${topType[0]} sostiene el mayor volumen del periodo.` : 'Sin tecnica dominante en el rango.',
                    detail: topType
                        ? `${formatNumber(topType[1])} cierre(s) y ${topTypePercent}% de participacion sobre la carga total.`
                        : 'Todavia no hay cierres suficientes para destacar una especialidad.'
                },
                {
                    accent: conditionAccent,
                    label: 'Riesgo tecnico',
                    title: criticalMeasures.length
                        ? `${formatNumber(criticalMeasures.length)} lectura(s) requieren priorizacion.`
                        : watchMeasures.length
                            ? `${formatNumber(watchMeasures.length)} lectura(s) siguen en observacion.`
                            : 'Sin criticidad activa en el periodo.',
                    detail: criticalMeasures.length
                        ? `${formatNumber(criticalEquipmentSet.size)} equipo(s) concentran la mayor presion tecnica del rango.`
                        : watchMeasures.length
                            ? 'Conviene sostener seguimiento para evitar escalamiento en la condicion.'
                            : 'La condicion consolidada permanece controlada y sin alertas urgentes.'
                },
                {
                    accent: '#475569',
                    label: 'Movimiento sugerido',
                    title: topEquipmentStat
                        ? `${topEquipmentStat.equipment} merece foco adicional.`
                        : topUnit
                            ? `Balancear continuidad en ${topUnit[0]}.`
                            : 'Sin foco operativo dominante.',
                    detail: topEquipmentStat
                        ? `${topEquipmentStat.unit || 'Sin unidad'} / ${formatNumber(topEquipmentStat.tasks)} trabajo(s) y ${formatNumber(topEquipmentStat.measures)} medicion(es) consolidadas.`
                        : topUnit
                            ? `${formatNumber(topUnit[1])} trabajo(s) concentrados en la unidad con mayor carga.`
                            : 'No hay suficiente actividad en el rango para proponer foco.'
                }
            ].map(item => `
<article class="analytics-print-brief-card" style="--print-brief-accent:${item.accent};--print-brief-soft:${hexToRgba(item.accent, 0.14)};">
  <span>${esc(item.label)}</span>
  <strong>${esc(item.title)}</strong>
  <p>${esc(item.detail)}</p>
</article>`).join('');
            const printBarChartsHtml = [
                buildPrintBarCard({
                    title: 'Carga por especialidad',
                    meta: 'Participacion de trabajos cerrados por tecnica en el rango.',
                    accent: getAccentColor(topType ? topType[0] : 'Otros'),
                    entries: [
                        ...specialtyEntries.slice(0, 5).map(([label, value]) => ({
                            label,
                            value,
                            color: getAccentColor(label),
                            valueLabel: `${formatNumber(value)} · ${tasks.length ? Math.round((value / tasks.length) * 100) : 0}%`
                        })),
                        ...(specialtyBarOther > 0 ? [{
                            label: 'Otras',
                            value: specialtyBarOther,
                            color: '#94a3b8',
                            valueLabel: `${formatNumber(specialtyBarOther)} · ${tasks.length ? Math.round((specialtyBarOther / tasks.length) * 100) : 0}%`
                        }] : [])
                    ]
                }),
                buildPrintBarCard({
                    title: 'Carga por unidad',
                    meta: 'Unidades con mayor concentracion operacional dentro del periodo.',
                    accent: '#475569',
                    entries: [
                        ...unitEntries.slice(0, 5).map(([label, value], index) => ({
                            label,
                            value,
                            color: unitPalette[index % unitPalette.length],
                            valueLabel: `${formatNumber(value)} · ${tasks.length ? Math.round((value / tasks.length) * 100) : 0}%`
                        })),
                        ...(unitBarOther > 0 ? [{
                            label: 'Otras',
                            value: unitBarOther,
                            color: '#cbd5e1',
                            valueLabel: `${formatNumber(unitBarOther)} · ${tasks.length ? Math.round((unitBarOther / tasks.length) * 100) : 0}%`
                        }] : [])
                    ]
                }),
                buildPrintBarCard({
                    title: 'Lideres con mayor actividad',
                    meta: 'Responsables con mas cierres y cobertura en el rango.',
                    accent: '#334155',
                    entries: topLeaders.slice(0, 5).map(([label, value], index) => ({
                        label,
                        value,
                        color: ['#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1'][index] || '#334155',
                        valueLabel: `${formatNumber(value)} trab.`
                    }))
                })
            ].join('');
            const printKpisHtml = [
                { label: 'Trabajos cerrados', value: formatNumber(tasks.length), meta: `${formatNumber(tasksPerDay, 1)} por dia`, compare: comparisonCards.tasks, accent: '#f97316', icon: 'fa-list-check' },
                { label: 'Mediciones', value: formatNumber(measures.length), meta: `${formatNumber(measuresPerDay, 1)} por dia`, compare: comparisonCards.measures, accent: '#fb923c', icon: 'fa-wave-square' },
                { label: 'HH registradas', value: formatNumber(hh, 1), meta: `${formatNumber(avgHhPerTask, 1)} HH por trabajo`, compare: comparisonCards.hh, accent: '#475569', icon: 'fa-business-time' },
                { label: 'OT cerradas', value: formatNumber(ots.size), meta: `${formatNumber(avisos)} aviso(s)`, compare: comparisonCards.ots, accent: '#334155', icon: 'fa-hashtag' },
                { label: 'Equipos intervenidos', value: formatNumber(activeEquipments.size), meta: 'actividad del rango', compare: comparisonCards.activeEquipments, accent: '#94a3b8', icon: 'fa-gears' },
                { label: 'Personal participante', value: formatNumber(participants.size), meta: 'lideres, apoyo y tecnicos', compare: comparisonCards.participants, accent: '#f59e0b', icon: 'fa-users' },
                { label: 'Lecturas criticas', value: formatNumber(criticalMeasures.length), meta: `${formatNumber(criticalEquipmentSet.size)} equipo(s)`, compare: comparisonCards.critical, accent: '#ef4444', icon: 'fa-triangle-exclamation' },
                { label: 'Seguimiento activo', value: formatNumber(watchMeasures.length), meta: 'alertas por revisar', compare: comparisonCards.watch, accent: '#f59e0b', icon: 'fa-binoculars' }
            ].map(item => `
<article class="analytics-print-kpi" style="--print-kpi-accent:${item.accent};--print-kpi-soft:${hexToRgba(item.accent, 0.12)};">
  <div class="analytics-print-kpi-head">
    <span>${item.label}</span>
    <i class="fa-solid ${item.icon}"></i>
  </div>
  <strong>${item.value}</strong>
  <small>${item.meta}</small>
  <span class="analytics-compare-badge ${item.compare.className}"><i class="fa-solid ${item.compare.icon}"></i> ${item.compare.shortLabel}</span>
</article>`).join('');
            const printAlertsListHtml = [
                ...criticalMeasures.slice(0, 4).map(item => ({
                    stateClass: 'is-critical',
                    title: item.equipment,
                    meta: `${item.unit || 'Sin unidad'} · ${item.point || 'General'} · ${formatDateTime(item.date)}`,
                    value: `${formatNumber(item.value, item.type === 'vibracion' ? 2 : 1)} ${item.type === 'vibracion' ? 'mm/s' : 'C'}`
                })),
                ...watchMeasures.slice(0, 4).map(item => ({
                    stateClass: 'is-watch',
                    title: item.equipment,
                    meta: `${item.unit || 'Sin unidad'} · ${item.point || 'General'} · ${formatDateTime(item.date)}`,
                    value: `${formatNumber(item.value, item.type === 'vibracion' ? 2 : 1)} ${item.type === 'vibracion' ? 'mm/s' : 'C'}`
                }))
            ].slice(0, 6).map(item => `
<div class="analytics-print-list-item">
  <div>
    <strong>${esc(item.title)}</strong>
    <span>${esc(normalizePrintCopy(item.meta))}</span>
  </div>
  <span class="analytics-status-badge ${item.stateClass}"><i class="fa-solid fa-circle"></i> ${esc(item.value)}</span>
</div>`).join('') || '<p class="analytics-empty">Sin alertas activas para este rango.</p>';
            const printEquipmentHtml = topEquipments.slice(0, 6).map(([name, total]) => {
                const stat = equipmentList.find(item => item.equipment === name) || {};
                const statDisplay = normalizePrintCopy(`${stat.unit || 'Sin unidad'} / ${formatNumber(stat.measures || 0)} medicion(es)`);
                return `
<div class="analytics-print-list-item">
  <div>
    <strong>${esc(name)}</strong>
    <span>${esc(stat.unit || 'Sin unidad')} · ${formatNumber(stat.measures || 0)} medicion(es)</span>
  </div>
  <strong>${formatNumber(total)}</strong>
</div>`;
            }).join('') || '<p class="analytics-empty">Sin equipos destacados en el rango.</p>';
            const printLeaderHtml = topLeaders.slice(0, 6).map(([name, total]) => `
<div class="analytics-print-list-item">
  <div>
    <strong>${esc(name)}</strong>
    <span>${formatNumber((participantStats.get(name)?.units.size) || 0)} unidad(es) cubiertas</span>
  </div>
  <strong>${formatNumber(total)} trab.</strong>
</div>`).join('') || '<p class="analytics-empty">Sin lideres destacados en el rango.</p>';
            const printMeetingHighlightsHtml = [
                { title: 'Unidad foco', detail: topUnit ? `${topUnit[0]} con ${formatNumber(topUnit[1])} trabajo(s) en el rango.` : 'Sin unidad dominante en el periodo.' },
                { title: 'Especialidad lider', detail: topType ? `${topType[0]} concentra ${tasks.length ? Math.round((topType[1] / tasks.length) * 100) : 0}% de los cierres.` : 'Sin especialidad dominante.' },
                { title: 'Condicion general', detail: `${conditionSummary.label}. ${conditionSummary.note}` },
                { title: 'Lider con mayor carga', detail: topLeaders[0] ? `${topLeaders[0][0]} lidera con ${formatNumber(topLeaders[0][1])} trabajo(s).` : 'Sin lider destacado.' }
            ].map(item => `
<div class="analytics-print-list-item">
  <div>
    <strong>${esc(item.title)}</strong>
    <span>${esc(item.detail)}</span>
  </div>
</div>`).join('');
            const printMeetingActionsHtml = [
                criticalMeasures.length
                    ? `Priorizar revision sobre ${formatNumber(criticalEquipmentSet.size)} equipo(s) con lecturas criticas.`
                    : 'No hay lecturas criticas; mantener rutina preventiva del periodo.',
                watchMeasures.length
                    ? `Mantener seguimiento sobre ${formatNumber(watchMeasures.length)} lectura(s) en observacion.`
                    : 'Sin lecturas en seguimiento pendientes al cierre del rango.',
                tasks.length
                    ? `Revisar continuidad operacional en ${topUnit ? topUnit[0] : 'la unidad principal'} y balancear carga (${formatNumber(tasksPerDay, 1)} cierres/dia).`
                    : 'No hubo cierres en el periodo; validar planificacion y registros pendientes.',
                measures.length
                    ? `Usar el Excel visual como respaldo de reunion con ${formatNumber(measures.length)} medicion(es) consolidadas.`
                    : 'No hubo mediciones; confirmar si existen datos aun sin sincronizar.'
            ].map(item => `
<div class="analytics-print-list-item">
  <div>
    <strong>Accion sugerida</strong>
    <span>${esc(item)}</span>
  </div>
</div>`).join('');
            const printTasksRows = tasks.slice(0, 12).map(item => `
<tr>
  <td>${esc(formatDate(item.date))}</td>
  <td>${esc(item.unit || '-')}</td>
  <td>${esc(item.equipment)}</td>
  <td>${esc(item.specialty)}</td>
  <td>${esc(item.leader || '-')}</td>
  <td>${esc(item.ot || '-')}</td>
  <td>${formatNumber(item.hh, 1)}</td>
</tr>`).join('') || '<tr><td colspan="7">Sin trabajos cerrados en el rango.</td></tr>';
            const printMeasuresRows = measures.slice(0, 10).map(item => `
<tr>
  <td>${esc(formatDateTime(item.date))}</td>
  <td>${esc(item.type === 'vibracion' ? 'Vibracion' : 'Termografia')}</td>
  <td>${esc(item.unit || '-')}</td>
  <td>${esc(item.equipment)}</td>
  <td>${esc(item.point || 'General')}</td>
  <td>${formatNumber(item.value, item.type === 'vibracion' ? 2 : 1)} ${esc(item.unitLabel || '')}</td>
  <td>${getMetricStatus(item.type, item.value).label}</td>
</tr>`).join('') || '<tr><td colspan="7">Sin mediciones en el rango.</td></tr>';
            const rows = tasks.slice(0, 18).map(item => `
<tr class="analytics-table-row analytics-clickable" data-drill="task" data-task-id="${esc(item.id || '')}">
  <td>${esc(formatDate(item.date))}</td>
  <td>${esc(item.unit || '-')}</td>
  <td><button class="analytics-link-btn" data-eq="${esc(item.equipment)}" data-unit="${esc(item.unit || '')}" data-id="${esc(item.equipmentId || '')}">${esc(item.equipment)}</button></td>
  <td><span class="analytics-clickable" data-drill="specialty" data-specialty="${esc(item.specialty)}">${renderTypeBadge(item.specialty, item.typesText)}</span></td>
  <td>${esc(item.leader)}</td>
  <td>${esc(item.ot || '-')}</td>
  <td>${esc(item.aviso || '-')}</td>
  <td>${formatNumber(item.hh, 1)}</td>
</tr>`).join('');
            const taskById = new Map(tasks.map(item => [String(item.id), item]));
            const measureById = new Map(measures.map(item => [String(item.id), item]));
            let detailRoot = null;
            let detailClearTimer = null;
            let detailAnchorY = null;

            function setDetailAnchor(source) {
                if (!source) {
                    detailAnchorY = null;
                    return;
                }
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 900;
                let nextY = null;
                if (typeof source.clientY === 'number') {
                    nextY = source.clientY;
                } else if (typeof source.top === 'number') {
                    nextY = source.top;
                } else if (typeof source.getBoundingClientRect === 'function') {
                    const rect = source.getBoundingClientRect();
                    nextY = rect.top + Math.min(Math.max(rect.height * 0.45, 28), 88);
                }
                if (!Number.isFinite(nextY)) {
                    detailAnchorY = null;
                    return;
                }
                detailAnchorY = Math.max(28, Math.min(nextY, viewportHeight - 28));
            }

            function applyDetailDrawerPosition(drawer) {
                if (!drawer) return;
                if (window.innerWidth <= 780 || !Number.isFinite(detailAnchorY)) {
                    drawer.style.top = '';
                    drawer.style.height = '';
                    drawer.style.minHeight = '';
                    drawer.style.maxHeight = '';
                    return;
                }
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 900;
                const idealHeight = Math.min(480, viewportHeight - 32);
                const minHeight = Math.min(240, idealHeight);
                // The detailRoot may be inside a parent with CSS transform/animation (fade-in),
                // which makes it the containing block. We must convert viewport coords to local coords.
                const rootOffset = detailRoot ? detailRoot.getBoundingClientRect().top : 0;
                // Anchor near the click: start slightly above the click point (viewport coords)
                let topViewport = Math.max(16, detailAnchorY - 24);
                // If the panel would overflow below, shift it up just enough
                const overflow = (topViewport + idealHeight + 16) - viewportHeight;
                if (overflow > 0) {
                    topViewport = Math.max(16, topViewport - overflow);
                }
                // Convert viewport top to the containing block's local coordinate space
                const top = topViewport - rootOffset;
                const height = Math.min(idealHeight, viewportHeight - topViewport - 16);
                drawer.style.top = `${top}px`;
                drawer.style.height = `${Math.max(minHeight, height)}px`;
                drawer.style.minHeight = `${minHeight}px`;
                drawer.style.maxHeight = `${Math.max(minHeight, height)}px`;
            }

            function setDetailAnchorFromChart(event, chart, elements) {
                if (!elements?.length) return;
                const nativeEvent = event?.native || event;
                if (typeof nativeEvent?.clientY === 'number') {
                    setDetailAnchor({ clientY: nativeEvent.clientY });
                    return;
                }
                const rect = chart?.canvas?.getBoundingClientRect?.();
                const pointY = elements[0]?.element?.y;
                if (rect && Number.isFinite(pointY)) {
                    setDetailAnchor({ clientY: rect.top + pointY });
                    return;
                }
                if (rect) {
                    setDetailAnchor({ clientY: rect.top + (rect.height * 0.5) });
                    return;
                }
                setDetailAnchor(chart?.canvas || null);
            }

            function formatDateTime(date) {
                return new Date(date).toLocaleString('es-CL', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }

            function renderTaskDetailCard(item) {
                return `
<article class="analytics-detail-card">
  <div class="analytics-detail-card-top">
    <div>
      <button type="button" class="analytics-detail-equipment-btn" data-eq="${esc(item.equipment)}" data-unit="${esc(item.unit || '')}" data-id="${esc(item.equipmentId || '')}">${esc(item.equipment)}</button>
      <div class="analytics-detail-card-meta">
        <span><i class="fa-regular fa-calendar"></i> ${esc(formatDateTime(item.date))}</span>
        <span><i class="fa-solid fa-location-dot"></i> ${esc(item.unit || 'Sin unidad')}</span>
        <span><i class="fa-solid fa-user"></i> ${esc(item.leader || 'Sin lider')}</span>
      </div>
    </div>
    ${renderTypeBadge(item.specialty, item.typesText)}
  </div>
  <div class="analytics-detail-card-meta">
    <span><i class="fa-solid fa-hashtag"></i> ${esc(item.ot || 'Sin OT')}</span>
    <span><i class="fa-regular fa-bell"></i> ${esc(item.aviso || 'Sin aviso')}</span>
    <span><i class="fa-solid fa-business-time"></i> ${formatNumber(item.hh, 1)} HH</span>
  </div>
  ${item.actions ? `<div class="analytics-detail-card-text"><strong>Acciones:</strong> ${esc(item.actions)}</div>` : ''}
  ${item.observations ? `<div class="analytics-detail-card-text"><strong>Observaciones:</strong> ${esc(item.observations)}</div>` : ''}
  ${item.analysis ? `<div class="analytics-detail-card-text"><strong>Analisis:</strong> ${esc(item.analysis)}</div>` : ''}
  ${item.recommendation ? `<div class="analytics-detail-card-text"><strong>Recomendacion:</strong> ${esc(item.recommendation)}</div>` : ''}
</article>`;
            }

            function renderMeasureDetailCard(item) {
                const status = getMetricStatus(item.type, item.value);
                return `
<article class="analytics-detail-card ${status.cardClass}">
  <div class="analytics-detail-card-top">
    <div>
      <button type="button" class="analytics-detail-equipment-btn" data-eq="${esc(item.equipment)}" data-unit="${esc(item.unit || '')}" data-id="${esc(item.equipmentId || '')}">${esc(item.equipment)}</button>
      <div class="analytics-detail-card-meta">
        <span><i class="fa-regular fa-calendar"></i> ${esc(formatDateTime(item.date))}</span>
        <span><i class="fa-solid fa-location-dot"></i> ${esc(item.unit || 'Sin unidad')}</span>
        <span><i class="fa-solid fa-ruler"></i> ${esc(item.point || 'General')}</span>
      </div>
    </div>
    ${renderTypeBadge(item.type === 'vibracion' ? 'Vibraciones' : 'Termografia', item.type === 'vibracion' ? 'Vibracion' : 'Termografia')}
  </div>
  <div class="analytics-detail-card-meta">
    <span><i class="fa-solid fa-chart-line"></i> ${formatNumber(item.value, item.type === 'vibracion' ? 2 : 1)} ${esc(item.unitLabel || (item.type === 'vibracion' ? 'mm/s' : 'C'))}</span>
    <span><i class="fa-solid fa-user-gear"></i> ${esc(item.tech || 'Sin tecnico')}</span>
    <span class="analytics-status-badge ${status.className}"><i class="fa-solid fa-circle"></i> ${status.label}</span>
  </div>
  ${item.observation ? `<div class="analytics-detail-card-text"><strong>Observacion:</strong> ${esc(item.observation)}</div>` : ''}
</article>`;
            }

            function renderStatCard(attrs, title, meta, value) {
                return `
<article class="analytics-detail-stat analytics-clickable" ${attrs}>
  <div>
    <strong>${title}</strong>
    <span>${meta}</span>
  </div>
  <strong>${value}</strong>
</article>`;
            }

            function renderComparisonStatCard(title, currentValue, previousValue, compare, meta) {
                return `
<article class="analytics-detail-stat">
  <div>
    <strong>${title}</strong>
    <span>${meta}</span>
  </div>
  <div style="text-align:right;">
    <strong>${currentValue}</strong>
    <span>Anterior: ${previousValue}</span>
    <span class="analytics-compare-badge ${compare.className}" style="margin-top:.45rem;"><i class="fa-solid ${compare.icon}"></i> ${compare.shortLabel}</span>
  </div>
</article>`;
            }

            function closeDetailDrawer() {
                window.__closeAnalyticsDrawer = null;
                if (!detailRoot) return;
                detailRoot.classList.remove('is-open');
                if (detailClearTimer) clearTimeout(detailClearTimer);
                detailClearTimer = setTimeout(() => {
                    if (detailRoot) detailRoot.innerHTML = '';
                }, 220);
            }

            function openDetailDrawer({ title, subtitle, summary = [], actionsHtml = '', tasks: detailTasks = [], measures: detailMeasures = [], sections = [], emptyMessage = 'Sin registros relacionados.' }) {
                if (!detailRoot) return;
                if (detailClearTimer) clearTimeout(detailClearTimer);
                const summaryHtml = summary.map(item => `<span class="analytics-detail-summary-chip"><i class="fa-solid ${item.icon || 'fa-circle-info'}"></i> ${esc(item.label)}: <strong>${item.value}</strong></span>`).join('');
                const taskSection = detailTasks.length ? `
<section class="analytics-detail-section">
  <div class="analytics-detail-section-head"><h4>Trabajos</h4><span>${formatNumber(detailTasks.length)} registro(s)</span></div>
  <div class="analytics-detail-grid">${detailTasks.map(renderTaskDetailCard).join('')}</div>
</section>` : '';
                const measureSection = detailMeasures.length ? `
<section class="analytics-detail-section">
  <div class="analytics-detail-section-head"><h4>Mediciones</h4><span>${formatNumber(detailMeasures.length)} registro(s)</span></div>
  <div class="analytics-detail-grid">${detailMeasures.map(renderMeasureDetailCard).join('')}</div>
</section>` : '';
                const customSections = sections.map(section => `
<section class="analytics-detail-section">
  <div class="analytics-detail-section-head"><h4>${section.title}</h4><span>${section.subtitle || ''}</span></div>
  <div class="analytics-detail-grid">${section.html}</div>
</section>`).join('');

                detailRoot.innerHTML = `
<div class="analytics-detail-backdrop" data-drill-close="true"></div>
<aside class="analytics-detail-drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
  <div class="analytics-detail-head">
    <div class="analytics-detail-title-row">
      <div>
        <h3 class="analytics-detail-title">${esc(title)}</h3>
        <div class="analytics-detail-subtitle">${subtitle}</div>
      </div>
      <button type="button" class="analytics-detail-close" data-drill-close="true"><i class="fa-solid fa-xmark"></i></button>
    </div>
    ${summaryHtml ? `<div class="analytics-detail-summary">${summaryHtml}</div>` : ''}
    ${actionsHtml ? `<div class="analytics-detail-actions">${actionsHtml}</div>` : ''}
  </div>
  <div class="analytics-detail-body">
    ${customSections}
    ${taskSection}
    ${measureSection}
    ${!customSections && !taskSection && !measureSection ? `<p class="analytics-empty">${emptyMessage}</p>` : ''}
  </div>
</aside>`;

                detailRoot.querySelectorAll('[data-print-equipment]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        try {
                            const payload = JSON.parse(btn.dataset.printEquipment || '{}');
                            printEquipmentReport(payload);
                        } catch (error) {
                            console.error('No se pudo preparar el PDF por equipo.', error);
                        }
                    });
                });

                window.__closeAnalyticsDrawer = closeDetailDrawer;
                const drawer = detailRoot.querySelector('.analytics-detail-drawer');
                // Reset scroll so content always starts from top
                const drawerBody = detailRoot.querySelector('.analytics-detail-body');
                if (drawerBody) drawerBody.scrollTop = 0;
                applyDetailDrawerPosition(drawer);
                requestAnimationFrame(() => {
                    applyDetailDrawerPosition(drawer);
                    detailRoot && detailRoot.classList.add('is-open');
                });
            }

            function printEquipmentReport({ name, unit, id }) {
                const detailTasks = tasks.filter(item =>
                    (id ? String(item.equipmentId || '') === String(id) : String(item.equipment || '').toLowerCase() === String(name || '').toLowerCase()) &&
                    (!unit || String(item.unit || '').toLowerCase() === String(unit || '').toLowerCase())
                );
                const detailMeasures = measures.filter(item =>
                    (id ? String(item.equipmentId || '') === String(id) : String(item.equipment || '').toLowerCase() === String(name || '').toLowerCase()) &&
                    (!unit || String(item.unit || '').toLowerCase() === String(unit || '').toLowerCase())
                );
                const latestVib = detailMeasures.filter(item => item.type === 'vibracion').sort((a, b) => b.date - a.date)[0] || null;
                const latestTemp = detailMeasures.filter(item => item.type === 'termografia').sort((a, b) => b.date - a.date)[0] || null;
                const condition = summarizeCondition(detailMeasures);
                const leaders = [...new Set(detailTasks.map(item => item.leader).filter(Boolean))];
                const otsLocal = new Set(detailTasks.map(item => item.ot).filter(Boolean));
                const hhLocal = detailTasks.reduce((acc, item) => acc + (item.hh || 0), 0);
                const latestTask = detailTasks[0] || null;
                const reportRoot = document.getElementById('analytics-equipment-print-shell');
                if (reportRoot) reportRoot.remove();

                const taskRows = detailTasks.slice(0, 10).map(item => `
<tr>
  <td>${esc(formatDate(item.date))}</td>
  <td>${esc(item.specialty)}</td>
  <td>${esc(item.leader || '-')}</td>
  <td>${esc(item.ot || '-')}</td>
  <td>${formatNumber(item.hh, 1)}</td>
</tr>`).join('') || '<tr><td colspan="5">Sin trabajos asociados en el rango.</td></tr>';

                const measureRows = detailMeasures.slice(0, 12).map(item => `
<tr>
  <td>${esc(formatDateTime(item.date))}</td>
  <td>${esc(item.type === 'vibracion' ? 'Vibracion' : 'Termografia')}</td>
  <td>${esc(item.point || 'General')}</td>
  <td>${formatNumber(item.value, item.type === 'vibracion' ? 2 : 1)} ${esc(item.unitLabel || (item.type === 'vibracion' ? 'mm/s' : 'C'))}</td>
  <td>${getMetricStatus(item.type, item.value).label}</td>
</tr>`).join('') || '<tr><td colspan="5">Sin mediciones asociadas en el rango.</td></tr>';

                const recommendations = [
                    latestVib ? `Vibracion actual ${formatNumber(latestVib.value, 2)} mm/s en ${latestVib.point || 'General'}.` : 'Sin vibracion reciente para diagnostico rapido.',
                    latestTemp ? `Termografia actual ${formatNumber(latestTemp.value, 1)} C en ${latestTemp.point || 'General'}.` : 'Sin termografia reciente para diagnostico rapido.',
                    detailTasks.length ? `Se registran ${formatNumber(detailTasks.length)} trabajo(s) y ${formatNumber(hhLocal, 1)} HH en el rango.` : 'No hay cierres asociados en el periodo seleccionado.',
                    latestTask ? `Ultimo cierre visible: ${formatDate(latestTask.date)} con lider ${latestTask.leader || 'Sin lider'}.` : 'Sin ultimo cierre visible en el rango.'
                ].map(text => `<div class="analytics-equipment-print-list-item"><div><strong>Lectura</strong><span>${esc(text)}</span></div></div>`).join('');

                const shell = document.createElement('section');
                shell.id = 'analytics-equipment-print-shell';
                shell.className = 'analytics-equipment-print-shell';
                shell.innerHTML = `
<section class="analytics-equipment-print-hero">
  <div class="analytics-equipment-print-brand">
    <div class="analytics-equipment-print-mark">
      <span class="analytics-equipment-print-badge"><i class="fa-solid fa-gears"></i></span>
      <div>
        <strong>${esc(name || 'Equipo')}</strong>
        <span>Ficha ejecutiva de equipo para impresion o PDF.</span>
      </div>
    </div>
    <div class="analytics-equipment-print-meta">
      <span>Unidad</span>
      <strong>${esc(unit || 'Sin unidad')}</strong>
      <span>Rango analizado: ${formatDate(rangeStart)} - ${formatDate(rangeEnd)}</span>
      <span>Generado: ${formatDateTime(new Date())}</span>
    </div>
  </div>
  <div class="analytics-equipment-print-kpis">
    <article class="analytics-equipment-print-kpi"><span>Condicion</span><strong>${esc(condition.label)}</strong><small>${esc(condition.note)}</small></article>
    <article class="analytics-equipment-print-kpi"><span>Trabajos</span><strong>${formatNumber(detailTasks.length)}</strong><small>${formatNumber(otsLocal.size)} OT / ${formatNumber(hhLocal, 1)} HH</small></article>
    <article class="analytics-equipment-print-kpi"><span>Mediciones</span><strong>${formatNumber(detailMeasures.length)}</strong><small>${latestVib ? `${formatNumber(latestVib.value, 2)} mm/s` : 'Sin vib'} / ${latestTemp ? `${formatNumber(latestTemp.value, 1)} C` : 'Sin termo'}</small></article>
    <article class="analytics-equipment-print-kpi"><span>Lideres</span><strong>${formatNumber(leaders.length)}</strong><small>${leaders.slice(0, 2).join(', ') || 'Sin lider visible'}</small></article>
    <article class="analytics-equipment-print-kpi"><span>Ultimo cierre</span><strong>${latestTask ? esc(formatDate(latestTask.date)) : 'Sin dato'}</strong><small>${latestTask ? esc(latestTask.specialty) : 'Sin actividad reciente'}</small></article>
  </div>
</section>

<section class="analytics-equipment-print-section">
  <div class="analytics-print-section-head">
    <h2>Lectura tecnica</h2>
    <span>Resumen rapido para reunion de activo</span>
  </div>
  <div class="analytics-equipment-print-grid">
    <article class="analytics-equipment-print-card">
      <h3>Resumen ejecutivo</h3>
      <p>${esc(name || 'Equipo')} ${unit ? `en ${unit}` : ''} presenta estado ${condition.label.toLowerCase()} en el rango seleccionado, con ${formatNumber(detailMeasures.length)} medicion(es) y ${formatNumber(detailTasks.length)} trabajo(s) asociados.</p>
      <div class="analytics-equipment-print-list">${recommendations}</div>
    </article>
    <article class="analytics-equipment-print-card">
      <h3>Foco inmediato</h3>
      <div class="analytics-equipment-print-list">
        <div class="analytics-equipment-print-list-item"><div><strong>Vibracion</strong><span>${latestVib ? `${formatNumber(latestVib.value, 2)} mm/s / ${latestVib.point || 'General'}` : 'Sin lectura reciente'}</span></div><strong>${latestVib ? getMetricStatus('vibracion', latestVib.value).label : 'Sin dato'}</strong></div>
        <div class="analytics-equipment-print-list-item"><div><strong>Termografia</strong><span>${latestTemp ? `${formatNumber(latestTemp.value, 1)} C / ${latestTemp.point || 'General'}` : 'Sin lectura reciente'}</span></div><strong>${latestTemp ? getMetricStatus('termografia', latestTemp.value).label : 'Sin dato'}</strong></div>
        <div class="analytics-equipment-print-list-item"><div><strong>OT registradas</strong><span>${formatNumber(otsLocal.size)} OT asociadas al activo</span></div><strong>${formatNumber(hhLocal, 1)} HH</strong></div>
      </div>
    </article>
  </div>
</section>

<section class="analytics-equipment-print-section analytics-print-page-break">
  <div class="analytics-print-section-head">
    <h2>Trabajos del equipo</h2>
    <span>Ultimos cierres visibles en el rango</span>
  </div>
  <table class="analytics-equipment-print-table">
    <thead><tr><th>Fecha</th><th>Especialidad</th><th>Lider</th><th>OT</th><th>HH</th></tr></thead>
    <tbody>${taskRows}</tbody>
  </table>
</section>

<section class="analytics-equipment-print-section">
  <div class="analytics-print-section-head">
    <h2>Mediciones del equipo</h2>
    <span>Extracto de condicion asociado al activo</span>
  </div>
  <table class="analytics-equipment-print-table">
    <thead><tr><th>Fecha</th><th>Tipo</th><th>Punto</th><th>Valor</th><th>Estado</th></tr></thead>
    <tbody>${measureRows}</tbody>
  </table>
</section>

<div class="analytics-equipment-print-foot">
  <span>Documento generado desde Planify para revision puntual del activo.</span>
  <span>${formatNumber(detailTasks.length)} trabajo(s) / ${formatNumber(detailMeasures.length)} medicion(es)</span>
</div>`;

                const host = document.getElementById('main-content') || document.body;
                host.appendChild(shell);
                closeDetailDrawer();
                document.body.classList.add('analytics-print-equipment-mode');
                requestAnimationFrame(() => {
                    setTimeout(() => window.print(), 60);
                });
            }

            function openTaskDetail(item) {
                if (!item) return;
                const relatedMeasures = measures.filter(measure => String(measure.equipmentId || '') === String(item.equipmentId || '') && String(measure.unit || '') === String(item.unit || ''));
                openDetailDrawer({
                    title: item.equipment,
                    subtitle: `${esc(item.unit || 'Sin unidad')} &middot; ${esc(item.typesText)} &middot; ${esc(formatDate(item.date))}`,
                    summary: [
                        { label: 'Lider', value: esc(item.leader || 'Sin lider'), icon: 'fa-user' },
                        { label: 'HH', value: formatNumber(item.hh, 1), icon: 'fa-business-time' },
                        { label: 'OT', value: esc(item.ot || 'Sin OT'), icon: 'fa-hashtag' }
                    ],
                    tasks: [item],
                    measures: relatedMeasures.slice(0, 12)
                });
            }

            function openMeasureDetail(item) {
                if (!item) return;
                const relatedTasks = tasks.filter(task => String(task.equipmentId || '') === String(item.equipmentId || '') && String(task.unit || '') === String(item.unit || ''));
                openDetailDrawer({
                    title: `${item.type === 'vibracion' ? 'Vibracion' : 'Termografia'} de ${item.equipment}`,
                    subtitle: `${esc(item.unit || 'Sin unidad')} &middot; ${esc(item.point || 'General')} &middot; ${esc(formatDate(item.date))}`,
                    summary: [
                        { label: 'Valor', value: `${formatNumber(item.value, item.type === 'vibracion' ? 2 : 1)} ${esc(item.unitLabel || '')}`, icon: 'fa-chart-line' },
                        { label: 'Tecnico', value: esc(item.tech || 'Sin tecnico'), icon: 'fa-user-gear' }
                    ],
                    tasks: relatedTasks.slice(0, 12),
                    measures: [item]
                });
            }

            function openSpecialtyDetail(name) {
                const detailTasks = tasks.filter(item => item.specialty === name);
                openDetailDrawer({
                    title: `Especialidad: ${name}`,
                    subtitle: 'Trabajos asociados a la especialidad seleccionada.',
                    summary: [
                        { label: 'Trabajos', value: formatNumber(detailTasks.length), icon: 'fa-list-check' },
                        { label: 'HH', value: formatNumber(detailTasks.reduce((acc, item) => acc + (item.hh || 0), 0), 1), icon: 'fa-business-time' }
                    ],
                    tasks: detailTasks
                });
            }

            function openUnitDetail(unit) {
                const detailTasks = tasks.filter(item => item.unit === unit);
                const detailMeasures = measures.filter(item => item.unit === unit);
                openDetailDrawer({
                    title: `Unidad: ${unit || 'Sin unidad'}`,
                    subtitle: 'Detalle consolidado por unidad para el rango actual.',
                    summary: [
                        { label: 'Trabajos', value: formatNumber(detailTasks.length), icon: 'fa-list-check' },
                        { label: 'Mediciones', value: formatNumber(detailMeasures.length), icon: 'fa-wave-square' },
                        { label: 'HH', value: formatNumber(detailTasks.reduce((acc, item) => acc + (item.hh || 0), 0), 1), icon: 'fa-business-time' }
                    ],
                    tasks: detailTasks,
                    measures: detailMeasures
                });
            }

            function openEquipmentDetail(name, unit, id) {
                const detailTasks = tasks.filter(item => (id ? String(item.equipmentId || '') === String(id) : String(item.equipment || '').toLowerCase() === String(name || '').toLowerCase()) && (!unit || String(item.unit || '').toLowerCase() === String(unit || '').toLowerCase()));
                const detailMeasures = measures.filter(item => (id ? String(item.equipmentId || '') === String(id) : String(item.equipment || '').toLowerCase() === String(name || '').toLowerCase()) && (!unit || String(item.unit || '').toLowerCase() === String(unit || '').toLowerCase()));
                openDetailDrawer({
                    title: name || 'Equipo',
                    subtitle: `${esc(unit || 'Sin unidad')} &middot; Actividad y condicion del activo.`,
                    summary: [
                        { label: 'Trabajos', value: formatNumber(detailTasks.length), icon: 'fa-list-check' },
                        { label: 'Mediciones', value: formatNumber(detailMeasures.length), icon: 'fa-wave-square' }
                    ],
                    actionsHtml: `<button type="button" class="analytics-detail-action-btn" data-print-equipment="${esc(JSON.stringify({ name, unit, id }))}"><i class="fa-solid fa-file-pdf"></i> PDF equipo</button>`,
                    tasks: detailTasks,
                    measures: detailMeasures
                });
            }

            function openLeaderDetail(name) {
                const detailTasks = tasks.filter(item => item.leader === name || item.helpers.includes(name));
                const detailMeasures = measures.filter(item => item.tech === name);
                const stat = participantStats.get(name);
                openDetailDrawer({
                    title: name || 'Participante',
                    subtitle: 'Actividad asociada a la persona seleccionada.',
                    summary: [
                        { label: 'Como lider', value: formatNumber(stat ? stat.leaderCount : 0), icon: 'fa-user-tie' },
                        { label: 'Apoyo', value: formatNumber(stat ? stat.helperCount : 0), icon: 'fa-users' },
                        { label: 'Mediciones', value: formatNumber(stat ? stat.measureCount : 0), icon: 'fa-wave-square' }
                    ],
                    tasks: detailTasks,
                    measures: detailMeasures
                });
            }

            function openOtList() {
                const sectionHtml = otList.length
                    ? otList.map(stat => renderStatCard(
                        `data-drill="ot" data-ot="${esc(stat.ot)}"`,
                        esc(stat.ot),
                        `${[...stat.units].join(', ') || 'Sin unidad'} &middot; ${formatNumber(stat.hh, 1)} HH`,
                        formatNumber(stat.count)
                    )).join('')
                    : '<p class="analytics-empty">No hay OT registradas.</p>';
                openDetailDrawer({
                    title: 'OT cerradas',
                    subtitle: 'Listado de ordenes de trabajo registradas en el rango.',
                    summary: [
                        { label: 'OT', value: formatNumber(otList.length), icon: 'fa-hashtag' },
                        { label: 'Avisos', value: formatNumber(avisos), icon: 'fa-bell' }
                    ],
                    sections: [{ title: 'Ordenes de trabajo', subtitle: `${formatNumber(otList.length)} OT`, html: sectionHtml }]
                });
            }

            function openOtDetail(ot) {
                const detailTasks = tasks.filter(item => item.ot === ot);
                openDetailDrawer({
                    title: `OT ${ot}`,
                    subtitle: 'Trabajos asociados a la OT seleccionada.',
                    summary: [
                        { label: 'Trabajos', value: formatNumber(detailTasks.length), icon: 'fa-list-check' },
                        { label: 'HH', value: formatNumber(detailTasks.reduce((acc, item) => acc + (item.hh || 0), 0), 1), icon: 'fa-business-time' }
                    ],
                    tasks: detailTasks
                });
            }

            function openParticipantOverview() {
                const sectionHtml = participantList.length
                    ? participantList.map(stat => renderStatCard(
                        `data-drill="participant" data-name="${esc(stat.name)}"`,
                        esc(stat.name),
                        `${stat.units.size} unidad(es) &middot; ${formatDate(stat.latest || rangeStart)}`,
                        formatNumber(stat.leaderCount + stat.helperCount + stat.measureCount)
                    )).join('')
                    : '<p class="analytics-empty">No hay participantes en el rango.</p>';
                openDetailDrawer({
                    title: 'Personal participante',
                    subtitle: 'Resumen del personal involucrado en trabajos y mediciones.',
                    summary: [
                        { label: 'Participantes', value: formatNumber(participantList.length), icon: 'fa-users' }
                    ],
                    sections: [{ title: 'Participantes', subtitle: `${formatNumber(participantList.length)} persona(s)`, html: sectionHtml }]
                });
            }

            function openEquipmentOverview() {
                const sectionHtml = equipmentList.length
                    ? equipmentList.map(stat => renderStatCard(
                        `data-drill="equipment" data-name="${esc(stat.equipment)}" data-unit="${esc(stat.unit)}" data-id="${esc(stat.equipmentId || '')}"`,
                        esc(stat.equipment),
                        `${esc(stat.unit || 'Sin unidad')} &middot; ${formatNumber(stat.measures)} medicion(es)`,
                        formatNumber(stat.tasks)
                    )).join('')
                    : '<p class="analytics-empty">No hay equipos con actividad.</p>';
                openDetailDrawer({
                    title: 'Equipos intervenidos',
                    subtitle: 'Activos con trabajos o mediciones en el rango.',
                    summary: [
                        { label: 'Equipos', value: formatNumber(equipmentList.length), icon: 'fa-gears' }
                    ],
                    sections: [{ title: 'Equipos', subtitle: `${formatNumber(equipmentList.length)} activo(s)`, html: sectionHtml }]
                });
            }

            function openMeasuresByStatus(statusClass) {
                const detailMeasures = measures.filter(item => getMetricStatus(item.type, item.value).className === statusClass);
                const title = statusClass === 'is-critical' ? 'Lecturas criticas' : 'Lecturas en seguimiento';
                const subtitle = statusClass === 'is-critical'
                    ? 'Mediciones que ya requieren atencion prioritaria.'
                    : 'Mediciones que conviene seguir de cerca.';
                openDetailDrawer({
                    title,
                    subtitle,
                    summary: [
                        { label: 'Registros', value: formatNumber(detailMeasures.length), icon: 'fa-wave-square' },
                        { label: 'Equipos', value: formatNumber(new Set(detailMeasures.map(item => equipmentKeyFor(item))).size), icon: 'fa-gears' }
                    ],
                    measures: detailMeasures
                });
            }

            function openRecurringEquipmentOverview() {
                const sectionHtml = recurrentEquipments.length
                    ? recurrentEquipments.map(stat => renderStatCard(
                        `data-drill="equipment" data-name="${esc(stat.equipment)}" data-unit="${esc(stat.unit)}" data-id="${esc(stat.equipmentId || '')}"`,
                        esc(stat.equipment),
                        `${esc(stat.unit || 'Sin unidad')} &middot; ${formatNumber(stat.measures)} medicion(es) &middot; ${formatNumber(stat.hh, 1)} HH`,
                        formatNumber(stat.tasks)
                    )).join('')
                    : '<p class="analytics-empty">No hay reincidencias relevantes en el rango.</p>';
                openDetailDrawer({
                    title: 'Equipos reincidentes',
                    subtitle: 'Activos con actividad repetida o volumen operativo alto en el rango actual.',
                    summary: [
                        { label: 'Equipos', value: formatNumber(recurrentEquipments.length), icon: 'fa-gears' },
                        { label: 'Criticos', value: formatNumber(criticalEquipmentSet.size), icon: 'fa-triangle-exclamation' }
                    ],
                    sections: [{ title: 'Reincidencia operativa', subtitle: `${formatNumber(recurrentEquipments.length)} activo(s)`, html: sectionHtml }]
                });
            }

            function openComparisonOverview() {
                const comparisonHtml = [
                    renderComparisonStatCard('Trabajos cerrados', formatNumber(tasks.length), formatNumber(previousTasks.length), comparisonCards.tasks, 'Comparacion contra el rango anterior equivalente.'),
                    renderComparisonStatCard('Mediciones', formatNumber(measures.length), formatNumber(previousMeasures.length), comparisonCards.measures, 'Incluye vibracion y termografia.'),
                    renderComparisonStatCard('HH registradas', formatNumber(hh, 1), formatNumber(previousHh, 1), comparisonCards.hh, 'Horas-hombre declaradas en cierres.'),
                    renderComparisonStatCard('OT cerradas', formatNumber(ots.size), formatNumber(previousOts.size), comparisonCards.ots, 'Ordenes registradas en el rango.'),
                    renderComparisonStatCard('Alertas activas', formatNumber(criticalMeasures.length + watchMeasures.length), formatNumber(previousCriticalMeasures.length + previousWatchMeasures.length), comparisonCards.condition, 'Lecturas en seguimiento o atencion.')
                ].join('');
                openDetailDrawer({
                    title: 'Comparacion ejecutiva',
                    subtitle: `${formatDate(rangeStart)} - ${formatDate(rangeEnd)} frente a ${formatDate(previousRangeStart)} - ${formatDate(previousRangeEnd)}.`,
                    summary: [
                        { label: 'Periodo actual', value: `${rangeDays} dia(s)`, icon: 'fa-calendar-days' },
                        { label: 'Periodo anterior', value: `${rangeDays} dia(s)`, icon: 'fa-clock-rotate-left' }
                    ],
                    sections: [{ title: 'Variacion del rango', subtitle: 'Lectura rapida del comportamiento operativo.', html: comparisonHtml }]
                });
            }

            function dashboardExcelColor(hex) {
                const cleaned = String(hex || '').replace('#', '').trim();
                if (cleaned.length === 3) {
                    return `FF${cleaned.split('').map(char => `${char}${char}`).join('').toUpperCase()}`;
                }
                if (cleaned.length === 6) return `FF${cleaned.toUpperCase()}`;
                return 'FFE2E8F0';
            }

            function dashboardClamp(value, min, max) {
                return Math.max(min, Math.min(max, value));
            }

            function dashboardPaintRange(sheet, startRow, startCol, endRow, endCol, options = {}) {
                for (let row = startRow; row <= endRow; row += 1) {
                    for (let col = startCol; col <= endCol; col += 1) {
                        const cell = sheet.getCell(row, col);
                        if (options.fill) {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: dashboardExcelColor(options.fill) }
                            };
                        }
                        cell.border = {
                            top: { style: 'thin', color: { argb: dashboardExcelColor(options.border || '#dbe4f0') } },
                            left: { style: 'thin', color: { argb: dashboardExcelColor(options.border || '#dbe4f0') } },
                            bottom: { style: 'thin', color: { argb: dashboardExcelColor(options.border || '#dbe4f0') } },
                            right: { style: 'thin', color: { argb: dashboardExcelColor(options.border || '#dbe4f0') } }
                        };
                    }
                }
            }

            function dashboardAddMergedBlock(sheet, startRow, startCol, endRow, endCol, config = {}) {
                dashboardPaintRange(sheet, startRow, startCol, endRow, endCol, {
                    fill: config.fill || '#ffffff',
                    border: config.border || '#dbe4f0'
                });
                sheet.mergeCells(startRow, startCol, endRow, endCol);
                const cell = sheet.getCell(startRow, startCol);
                cell.alignment = {
                    vertical: config.vertical || 'middle',
                    horizontal: config.align || 'left',
                    wrapText: true
                };
                if (config.richText) {
                    cell.value = { richText: config.richText };
                } else if (config.value != null) {
                    cell.value = config.value;
                }
            }

            function dashboardSetRowHeights(sheet, startRow, endRow, height) {
                for (let row = startRow; row <= endRow; row += 1) {
                    sheet.getRow(row).height = height;
                }
            }

            function dashboardCreateChartSnapshot(canvas) {
                if (!canvas || !canvas.width || !canvas.height) return '';
                const pad = 20;
                const frameCanvas = document.createElement('canvas');
                frameCanvas.width = canvas.width + pad * 2;
                frameCanvas.height = canvas.height + pad * 2;
                const ctx = frameCanvas.getContext('2d');
                if (!ctx) return '';
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, frameCanvas.width, frameCanvas.height);
                ctx.strokeStyle = '#dbe4f0';
                ctx.lineWidth = 2;
                ctx.strokeRect(1, 1, frameCanvas.width - 2, frameCanvas.height - 2);
                ctx.drawImage(canvas, pad, pad, canvas.width, canvas.height);
                return frameCanvas.toDataURL('image/png');
            }

            async function dashboardDownloadWorkbookBuffer(buffer, fileName) {
                const blob = new Blob([buffer], {
                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }

            function dashboardBuildChartSnapshotMap() {
                const defs = [
                    { key: 'jobs', id: 'chart-dashboard-jobs', title: 'Trabajos por periodo', subtitle: 'Cantidad de cierres en el rango.', accent: '#f97316' },
                    { key: 'hh', id: 'chart-dashboard-hh', title: 'HH por periodo', subtitle: 'Horas registradas sin doble eje.', accent: '#64748b' },
                    { key: 'vibration', id: 'chart-dashboard-vibration', title: 'Vibracion promedio', subtitle: 'Con umbrales de seguimiento y atencion.', accent: '#f97316' },
                    { key: 'temperature', id: 'chart-dashboard-temperature', title: 'Termografia promedio', subtitle: 'Separada para una lectura mas clara.', accent: '#fb923c' },
                    { key: 'types', id: 'chart-dashboard-types', title: 'Carga por especialidad', subtitle: 'Distribucion de cierres por tecnica.', accent: '#f59e0b' },
                    { key: 'units', id: 'chart-dashboard-units', title: 'Carga por unidad', subtitle: 'Top unidades con actividad.', accent: '#94a3b8' },
                    { key: 'equipment', id: 'chart-dashboard-equipments', title: 'Equipos mas intervenidos', subtitle: 'Activos con mayor reincidencia.', accent: '#64748b' }
                ];
                return defs.reduce((acc, def) => {
                    const chart = charts.find(item => item?.canvas?.id === def.id);
                    const canvas = chart?.canvas || document.getElementById(def.id);
                    acc[def.key] = { ...def, image: dashboardCreateChartSnapshot(canvas) };
                    return acc;
                }, {});
            }

            function dashboardAddSectionHeader(sheet, row, startCol, endCol, title, subtitle, accent) {
                dashboardAddMergedBlock(sheet, row, startCol, row, endCol, {
                    fill: '#f8fbff',
                    border: '#dbe4f0',
                    richText: [
                        { text: `${title}\n`, font: { name: 'Aptos', size: 13, bold: true, color: { argb: dashboardExcelColor('#0f172a') } } },
                        { text: subtitle, font: { name: 'Aptos', size: 9, color: { argb: dashboardExcelColor('#64748b') } } }
                    ]
                });
                sheet.getCell(row, startCol).border.top = {
                    style: 'medium',
                    color: { argb: dashboardExcelColor(accent || '#2563eb') }
                };
            }

            function dashboardAddKpiCard(sheet, startRow, startCol, endRow, endCol, config) {
                dashboardAddMergedBlock(sheet, startRow, startCol, endRow, endCol, {
                    fill: config.fill,
                    border: config.border || config.accent,
                    richText: [
                        { text: `${String(config.label || '').toUpperCase()}\n`, font: { name: 'Aptos', size: 9, bold: true, color: { argb: dashboardExcelColor(config.labelColor || '#475569') } } },
                        { text: `${config.value}\n`, font: { name: 'Aptos Display', size: 20, bold: true, color: { argb: dashboardExcelColor(config.valueColor || '#0f172a') } } },
                        { text: `${config.meta || ''}\n`, font: { name: 'Aptos', size: 9, color: { argb: dashboardExcelColor(config.metaColor || '#475569') } } },
                        { text: config.trend || '', font: { name: 'Aptos', size: 9, bold: true, color: { argb: dashboardExcelColor(config.accent || '#2563eb') } } }
                    ]
                });
            }

            function dashboardAddChartCard(workbook, sheet, chartDef, startRow, startCol, endRow, endCol) {
                dashboardAddSectionHeader(sheet, startRow, startCol, endCol, chartDef.title, chartDef.subtitle, chartDef.accent);
                dashboardPaintRange(sheet, startRow + 1, startCol, endRow, endCol, {
                    fill: '#ffffff',
                    border: '#dbe4f0'
                });
                if (!chartDef.image) {
                    dashboardAddMergedBlock(sheet, startRow + 2, startCol + 1, endRow - 1, endCol - 1, {
                        fill: '#ffffff',
                        border: '#ffffff',
                        align: 'center',
                        richText: [
                            { text: 'Grafico no disponible\n', font: { name: 'Aptos', size: 12, bold: true, color: { argb: dashboardExcelColor('#0f172a') } } },
                            { text: 'Recarga el dashboard y vuelve a exportar para capturar la imagen.', font: { name: 'Aptos', size: 9, color: { argb: dashboardExcelColor('#64748b') } } }
                        ]
                    });
                    return;
                }
                const imageId = workbook.addImage({ base64: chartDef.image, extension: 'png' });
                sheet.addImage(imageId, {
                    tl: { col: startCol - 1 + 0.15, row: startRow + 0.55 },
                    br: { col: endCol - 0.15, row: endRow - 0.1 }
                });
            }

            function dashboardAddMiniTable(sheet, startRow, startCol, title, subtitle, headers, rows, accent, width) {
                const endCol = startCol + width - 1;
                dashboardAddSectionHeader(sheet, startRow, startCol, endCol, title, subtitle, accent);
                const headerRow = startRow + 1;
                headers.forEach((header, index) => {
                    const cell = sheet.getCell(headerRow, startCol + index);
                    cell.value = header;
                    cell.font = { name: 'Aptos', size: 9, bold: true, color: { argb: dashboardExcelColor('#334155') } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dashboardExcelColor('#eef5ff') } };
                    cell.alignment = { vertical: 'middle', horizontal: index === headers.length - 1 ? 'right' : 'left' };
                    cell.border = {
                        top: { style: 'thin', color: { argb: dashboardExcelColor('#dbe4f0') } },
                        left: { style: 'thin', color: { argb: dashboardExcelColor('#dbe4f0') } },
                        bottom: { style: 'thin', color: { argb: dashboardExcelColor('#dbe4f0') } },
                        right: { style: 'thin', color: { argb: dashboardExcelColor('#dbe4f0') } }
                    };
                });
                const normalizedRows = rows.length ? rows : [['Sin datos', '', '']];
                normalizedRows.forEach((row, rowIndex) => {
                    row.forEach((value, index) => {
                        const cell = sheet.getCell(headerRow + 1 + rowIndex, startCol + index);
                        cell.value = value;
                        cell.font = { name: 'Aptos', size: 9, color: { argb: dashboardExcelColor('#0f172a') } };
                        cell.alignment = { vertical: 'middle', horizontal: index === row.length - 1 ? 'right' : 'left', wrapText: true };
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: dashboardExcelColor(rowIndex % 2 === 0 ? '#ffffff' : '#f8fafc') }
                        };
                        cell.border = {
                            top: { style: 'thin', color: { argb: dashboardExcelColor('#dbe4f0') } },
                            left: { style: 'thin', color: { argb: dashboardExcelColor('#dbe4f0') } },
                            bottom: { style: 'thin', color: { argb: dashboardExcelColor('#dbe4f0') } },
                            right: { style: 'thin', color: { argb: dashboardExcelColor('#dbe4f0') } }
                        };
                    });
                });
            }

            function dashboardAddDataSheet(workbook, name, rows, emptyRow, tabColor) {
                const normalizedRows = rows.length ? rows : [emptyRow];
                const worksheet = workbook.addWorksheet(name, {
                    properties: { defaultRowHeight: 20 },
                    views: [{ state: 'frozen', ySplit: 1 }]
                });
                worksheet.pageSetup = {
                    orientation: 'landscape',
                    fitToPage: true,
                    fitToWidth: 1,
                    margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 }
                };
                worksheet.properties.tabColor = { argb: dashboardExcelColor(tabColor || '#94a3b8') };
                const keys = Object.keys(normalizedRows[0]);
                worksheet.columns = keys.map(key => {
                    const longest = Math.max(key.length, ...normalizedRows.map(row => String(row[key] == null ? '' : row[key]).length));
                    return { header: key, key, width: dashboardClamp(longest + 3, 14, 42) };
                });
                normalizedRows.forEach(row => worksheet.addRow(row));
                const headerRow = worksheet.getRow(1);
                headerRow.height = 24;
                headerRow.font = { name: 'Aptos', size: 10, bold: true, color: { argb: dashboardExcelColor('#ffffff') } };
                headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
                headerRow.eachCell(cell => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dashboardExcelColor(tabColor || '#2563eb') } };
                    cell.border = {
                        top: { style: 'thin', color: { argb: dashboardExcelColor('#cbd5e1') } },
                        left: { style: 'thin', color: { argb: dashboardExcelColor('#cbd5e1') } },
                        bottom: { style: 'thin', color: { argb: dashboardExcelColor('#cbd5e1') } },
                        right: { style: 'thin', color: { argb: dashboardExcelColor('#cbd5e1') } }
                    };
                });
                worksheet.autoFilter = {
                    from: { row: 1, column: 1 },
                    to: { row: 1, column: Math.max(keys.length, 1) }
                };
                for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
                    const row = worksheet.getRow(rowIndex);
                    row.eachCell(cell => {
                        cell.alignment = { vertical: 'top', wrapText: true };
                        cell.border = {
                            top: { style: 'thin', color: { argb: dashboardExcelColor('#e2e8f0') } },
                            left: { style: 'thin', color: { argb: dashboardExcelColor('#e2e8f0') } },
                            bottom: { style: 'thin', color: { argb: dashboardExcelColor('#e2e8f0') } },
                            right: { style: 'thin', color: { argb: dashboardExcelColor('#e2e8f0') } }
                        };
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: dashboardExcelColor(rowIndex % 2 === 0 ? '#ffffff' : '#f8fafc') }
                        };
                    });
                }
            }

            async function exportVisualDashboardWorkbook(payload) {
                const ExcelJS = window.ExcelJS;
                if (!ExcelJS) return false;

                const {
                    fileName,
                    summaryRows,
                    taskRows,
                    measureRows,
                    alertRows,
                    meetingRows,
                    rankingRows,
                    distributionRows
                } = payload;

                const workbook = new ExcelJS.Workbook();
                workbook.creator = 'Planify';
                workbook.company = 'Planify';
                workbook.created = new Date();
                workbook.modified = new Date();
                workbook.properties.date1904 = false;
                workbook.calcProperties.fullCalcOnLoad = true;

                const chartSnapshotMap = dashboardBuildChartSnapshotMap();

                const summarySheet = workbook.addWorksheet('Resumen Ejecutivo', {
                    properties: { defaultRowHeight: 21 },
                    views: [{ state: 'frozen', ySplit: 4 }]
                });
                summarySheet.pageSetup = {
                    orientation: 'landscape',
                    fitToPage: true,
                    fitToWidth: 1,
                    fitToHeight: 0,
                    paperSize: 9,
                    margins: { left: 0.3, right: 0.3, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 }
                };
                summarySheet.properties.tabColor = { argb: dashboardExcelColor('#f97316') };
                summarySheet.columns = new Array(12).fill(null).map((_, index) => ({ width: index === 0 || index === 11 ? 14 : 16 }));
                dashboardSetRowHeights(summarySheet, 1, 4, 22);
                dashboardAddMergedBlock(summarySheet, 1, 1, 3, 7, {
                    fill: '#ffffff',
                    border: '#dbe4f0',
                    richText: [
                        { text: 'Planify\n', font: { name: 'Aptos Display', size: 22, bold: true, color: { argb: dashboardExcelColor('#0f172a') } } },
                        { text: 'Dashboard ejecutivo visual de Control\n', font: { name: 'Aptos', size: 11, bold: true, color: { argb: dashboardExcelColor('#f97316') } } },
                        { text: 'Exportacion con graficos incrustados, KPIs comparados y detalle analitico listo para reunion.', font: { name: 'Aptos', size: 10, color: { argb: dashboardExcelColor('#64748b') } } }
                    ]
                });
                dashboardAddMergedBlock(summarySheet, 1, 8, 3, 12, {
                    fill: '#f8fbff',
                    border: '#dbe4f0',
                    richText: [
                        { text: 'Rango analizado\n', font: { name: 'Aptos', size: 10, bold: true, color: { argb: dashboardExcelColor('#2563eb') } } },
                        { text: `${formatDate(rangeStart)} - ${formatDate(rangeEnd)}\n`, font: { name: 'Aptos Display', size: 16, bold: true, color: { argb: dashboardExcelColor('#0f172a') } } },
                        { text: `Periodo anterior: ${formatDate(previousRangeStart)} - ${formatDate(previousRangeEnd)}\n`, font: { name: 'Aptos', size: 9, color: { argb: dashboardExcelColor('#64748b') } } },
                        { text: `Generado: ${formatDateTime(new Date())}`, font: { name: 'Aptos', size: 9, color: { argb: dashboardExcelColor('#64748b') } } }
                    ]
                });

                dashboardAddKpiCard(summarySheet, 5, 1, 8, 3, {
                    label: 'Trabajos cerrados',
                    value: formatNumber(tasks.length),
                    meta: `${formatNumber(tasksPerDay, 1)} por dia`,
                    trend: comparisonCards.tasks.shortLabel,
                    accent: '#f97316',
                    fill: '#fff7ed',
                    border: '#fdba74'
                });
                dashboardAddKpiCard(summarySheet, 5, 4, 8, 6, {
                    label: 'Mediciones',
                    value: formatNumber(measures.length),
                    meta: `${formatNumber(measuresPerDay, 1)} por dia`,
                    trend: comparisonCards.measures.shortLabel,
                    accent: '#14b8a6',
                    fill: '#ecfeff',
                    border: '#99f6e4'
                });
                dashboardAddKpiCard(summarySheet, 5, 7, 8, 9, {
                    label: 'HH registradas',
                    value: formatNumber(hh, 1),
                    meta: `${formatNumber(avgHhPerTask, 1)} HH por trabajo`,
                    trend: comparisonCards.hh.shortLabel,
                    accent: '#2563eb',
                    fill: '#eff6ff',
                    border: '#bfdbfe'
                });
                dashboardAddKpiCard(summarySheet, 5, 10, 8, 12, {
                    label: 'OT cerradas',
                    value: formatNumber(ots.size),
                    meta: `${formatNumber(avisos.size)} aviso(s) asociados`,
                    trend: comparisonCards.ots.shortLabel,
                    accent: '#0f172a',
                    fill: '#f8fafc',
                    border: '#cbd5e1'
                });
                dashboardAddKpiCard(summarySheet, 9, 1, 12, 3, {
                    label: 'Equipos intervenidos',
                    value: formatNumber(activeEquipments.size),
                    meta: 'activos con movimiento',
                    trend: comparisonCards.activeEquipments.shortLabel,
                    accent: '#0f766e',
                    fill: '#f0fdfa',
                    border: '#99f6e4'
                });
                dashboardAddKpiCard(summarySheet, 9, 4, 12, 6, {
                    label: 'Personal participante',
                    value: formatNumber(participants.size),
                    meta: 'lideres, apoyo y tecnicos',
                    trend: comparisonCards.participants.shortLabel,
                    accent: '#7c3aed',
                    fill: '#f5f3ff',
                    border: '#ddd6fe'
                });
                dashboardAddKpiCard(summarySheet, 9, 7, 12, 9, {
                    label: 'Lecturas criticas',
                    value: formatNumber(criticalMeasures.length),
                    meta: `${formatNumber(criticalEquipmentSet.size)} equipo(s)`,
                    trend: comparisonCards.critical.shortLabel,
                    accent: '#dc2626',
                    fill: '#fef2f2',
                    border: '#fecaca'
                });
                dashboardAddKpiCard(summarySheet, 9, 10, 12, 12, {
                    label: 'Seguimiento activo',
                    value: formatNumber(watchMeasures.length),
                    meta: 'alertas por revisar',
                    trend: comparisonCards.watch.shortLabel,
                    accent: '#d97706',
                    fill: '#fff7ed',
                    border: '#fed7aa'
                });

                dashboardSetRowHeights(summarySheet, 14, 46, 20);
                dashboardAddChartCard(workbook, summarySheet, chartSnapshotMap.jobs, 14, 1, 30, 6);
                dashboardAddChartCard(workbook, summarySheet, chartSnapshotMap.hh, 14, 7, 30, 12);
                dashboardAddChartCard(workbook, summarySheet, chartSnapshotMap.vibration, 32, 1, 46, 6);
                dashboardAddChartCard(workbook, summarySheet, chartSnapshotMap.temperature, 32, 7, 46, 12);

                const visualSheet = workbook.addWorksheet('Visuales', {
                    properties: { defaultRowHeight: 21 },
                    views: [{ state: 'frozen', ySplit: 2 }]
                });
                visualSheet.pageSetup = {
                    orientation: 'landscape',
                    fitToPage: true,
                    fitToWidth: 1,
                    fitToHeight: 0,
                    paperSize: 9,
                    margins: { left: 0.3, right: 0.3, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 }
                };
                visualSheet.properties.tabColor = { argb: dashboardExcelColor('#14b8a6') };
                visualSheet.columns = new Array(12).fill(null).map(() => ({ width: 16 }));
                dashboardAddMergedBlock(visualSheet, 1, 1, 2, 12, {
                    fill: '#ffffff',
                    border: '#dbe4f0',
                    richText: [
                        { text: 'Panel visual y focos operativos\n', font: { name: 'Aptos Display', size: 20, bold: true, color: { argb: dashboardExcelColor('#0f172a') } } },
                        { text: 'Graficos incrustados y rankings cortos para lectura rapida de reunion.', font: { name: 'Aptos', size: 10, color: { argb: dashboardExcelColor('#64748b') } } }
                    ]
                });
                dashboardSetRowHeights(visualSheet, 4, 52, 20);
                dashboardAddChartCard(workbook, visualSheet, chartSnapshotMap.types, 4, 1, 18, 6);
                dashboardAddChartCard(workbook, visualSheet, chartSnapshotMap.units, 4, 7, 18, 12);
                dashboardAddChartCard(workbook, visualSheet, chartSnapshotMap.equipment, 20, 1, 34, 12);
                dashboardAddMiniTable(
                    visualSheet,
                    36,
                    1,
                    'Top equipos',
                    'Activos con mayor volumen en el rango.',
                    ['Equipo', 'Unidad', 'Intervenciones'],
                    topEquipments.slice(0, 6).map(([label, value]) => {
                        const unit = equipmentList.find(item => item.equipment === label)?.unit || '';
                        return [label, unit, value];
                    }),
                    '#2563eb',
                    6
                );
                dashboardAddMiniTable(
                    visualSheet,
                    36,
                    7,
                    'Top lideres',
                    'Mayores cargas declaradas por persona.',
                    ['Lider', 'Unidad(es)', 'Trabajos'],
                    topLeaders.slice(0, 6).map(([label, value]) => [label, formatNumber((participantStats.get(label)?.units.size) || 0), value]),
                    '#7c3aed',
                    6
                );
                dashboardAddMiniTable(
                    visualSheet,
                    46,
                    1,
                    'Alertas',
                    'Foco rapido para seguimiento operativo.',
                    ['Categoria', 'Equipo', 'Fecha'],
                    alertRows.slice(0, 6).map(item => [item.Categoria, item.Equipo, item.Fecha]),
                    '#dc2626',
                    6
                );
                dashboardAddMiniTable(
                    visualSheet,
                    46,
                    7,
                    'Lectura ejecutiva',
                    'Mensajes cortos para la reunion.',
                    ['Bloque', 'Detalle', ''],
                    meetingRows.slice(0, 6).map(item => [item.Bloque, item.Detalle, '']),
                    '#0f766e',
                    6
                );

                dashboardAddDataSheet(workbook, 'Resumen', summaryRows, { Indicador: 'Sin datos', Actual: '', Anterior: '', Variacion: '' }, '#f97316');
                dashboardAddDataSheet(workbook, 'Trabajos', taskRows, { Info: 'Sin trabajos en el rango' }, '#2563eb');
                dashboardAddDataSheet(workbook, 'Mediciones', measureRows, { Info: 'Sin mediciones en el rango' }, '#14b8a6');
                dashboardAddDataSheet(workbook, 'Alertas', alertRows, { Info: 'Sin alertas activas en el rango' }, '#dc2626');
                dashboardAddDataSheet(workbook, 'Ranking', rankingRows, { Categoria: 'Sin datos', Ranking: '', Nombre: '', Valor: '', Detalle: '' }, '#7c3aed');
                dashboardAddDataSheet(workbook, 'Distribucion', distributionRows, { Tipo: 'Sin datos', Nombre: '', Total: '', Participacion: '' }, '#0f766e');

                const buffer = await workbook.xlsx.writeBuffer();
                await dashboardDownloadWorkbookBuffer(buffer, fileName);
                return true;
            }

            async function exportDashboardWorkbook() {
                const exportXlsxBtn = document.getElementById('dashboard-export-xlsx');
                const originalLabel = exportXlsxBtn ? exportXlsxBtn.innerHTML : '';
                if (exportXlsxBtn) {
                    exportXlsxBtn.disabled = true;
                    exportXlsxBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando Excel visual';
                }
                const canFallback = !!window.XLSX;
                const workbook = canFallback ? window.XLSX.utils.book_new() : null;
                const utils = canFallback ? window.XLSX.utils : null;
                const setSheetLayout = (sheet, rows) => {
                    const normalizedRows = Array.isArray(rows) ? rows : [];
                    const allRows = normalizedRows.length ? normalizedRows : [];
                    const colCount = allRows.reduce((max, row) => Math.max(max, Object.keys(row || {}).length), 0);
                    if (colCount > 0) {
                        const widths = [];
                        for (let c = 0; c < colCount; c += 1) {
                            const values = allRows.map(row => Object.values(row || {})[c]);
                            const maxLen = Math.max(
                                12,
                                ...values.map(value => String(value == null ? '' : value).length)
                            );
                            widths.push({ wch: Math.min(maxLen + 2, 42) });
                        }
                        sheet['!cols'] = widths;
                        sheet['!autofilter'] = { ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: allRows.length, c: Math.max(colCount - 1, 0) } }) };
                    }
                };
                const appendJsonSheet = (name, rows, emptyRow) => {
                    const normalizedRows = rows.length ? rows : [emptyRow];
                    const sheet = utils.json_to_sheet(normalizedRows);
                    setSheetLayout(sheet, normalizedRows);
                    utils.book_append_sheet(workbook, sheet, name);
                };
                const summaryRows = [
                    { Indicador: 'Desde', Actual: formatDate(rangeStart), Anterior: formatDate(previousRangeStart), Variacion: '' },
                    { Indicador: 'Hasta', Actual: formatDate(rangeEnd), Anterior: formatDate(previousRangeEnd), Variacion: '' },
                    { Indicador: 'Trabajos cerrados', Actual: tasks.length, Anterior: previousTasks.length, Variacion: comparisonCards.tasks.shortLabel },
                    { Indicador: 'Mediciones', Actual: measures.length, Anterior: previousMeasures.length, Variacion: comparisonCards.measures.shortLabel },
                    { Indicador: 'HH registradas', Actual: Number(hh.toFixed(1)), Anterior: Number(previousHh.toFixed(1)), Variacion: comparisonCards.hh.shortLabel },
                    { Indicador: 'OT cerradas', Actual: ots.size, Anterior: previousOts.size, Variacion: comparisonCards.ots.shortLabel },
                    { Indicador: 'Equipos intervenidos', Actual: activeEquipments.size, Anterior: previousActiveEquipments.size, Variacion: comparisonCards.activeEquipments.shortLabel },
                    { Indicador: 'Participantes', Actual: participants.size, Anterior: previousParticipants.size, Variacion: comparisonCards.participants.shortLabel },
                    { Indicador: 'Lecturas criticas', Actual: criticalMeasures.length, Anterior: previousCriticalMeasures.length, Variacion: comparisonCards.critical.shortLabel },
                    { Indicador: 'Lecturas seguimiento', Actual: watchMeasures.length, Anterior: previousWatchMeasures.length, Variacion: comparisonCards.watch.shortLabel }
                ];
                const taskRows = tasks.map(item => ({
                    Fecha: formatDate(item.date),
                    Unidad: item.unit || '',
                    Equipo: item.equipment || '',
                    Especialidad: item.specialty || '',
                    Lider: item.leader || '',
                    Ayudantes: item.helpers.join(', '),
                    OT: item.ot || '',
                    Aviso: item.aviso || '',
                    HH: Number((item.hh || 0).toFixed(1)),
                    Acciones: item.actions || '',
                    Observaciones: item.observations || '',
                    Analisis: item.analysis || '',
                    Recomendacion: item.recommendation || ''
                }));
                const measureRows = measures.map(item => ({
                    Fecha: formatDateTime(item.date),
                    Tipo: item.type === 'vibracion' ? 'Vibracion' : 'Termografia',
                    Unidad: item.unit || '',
                    Equipo: item.equipment || '',
                    Punto: item.point || '',
                    Valor: item.value,
                    UnidadMedida: item.unitLabel || '',
                    Estado: getMetricStatus(item.type, item.value).label,
                    Tecnico: item.tech || '',
                    Observacion: item.observation || ''
                }));
                const alertRows = [
                    ...criticalMeasures.map(item => ({
                        Categoria: 'Critica',
                        Equipo: item.equipment,
                        Unidad: item.unit || '',
                        Punto: item.point || '',
                        Valor: `${formatNumber(item.value, item.type === 'vibracion' ? 2 : 1)} ${item.type === 'vibracion' ? 'mm/s' : 'C'}`,
                        Fecha: formatDateTime(item.date)
                    })),
                    ...watchMeasures.map(item => ({
                        Categoria: 'Seguimiento',
                        Equipo: item.equipment,
                        Unidad: item.unit || '',
                        Punto: item.point || '',
                        Valor: `${formatNumber(item.value, item.type === 'vibracion' ? 2 : 1)} ${item.type === 'vibracion' ? 'mm/s' : 'C'}`,
                        Fecha: formatDateTime(item.date)
                    }))
                ];
                const meetingRows = [
                    { Bloque: 'Reporte', Detalle: 'Planify - Dashboard Ejecutivo de Control' },
                    { Bloque: 'Rango actual', Detalle: `${formatDate(rangeStart)} - ${formatDate(rangeEnd)}` },
                    { Bloque: 'Periodo anterior', Detalle: `${formatDate(previousRangeStart)} - ${formatDate(previousRangeEnd)}` },
                    { Bloque: 'Generado', Detalle: formatDateTime(new Date()) },
                    { Bloque: 'Unidad foco', Detalle: topUnit ? `${topUnit[0]} (${formatNumber(topUnit[1])} trabajo(s))` : 'Sin unidad dominante' },
                    { Bloque: 'Especialidad lider', Detalle: topType ? `${topType[0]} (${formatNumber(topType[1])} cierre(s))` : 'Sin especialidad dominante' },
                    { Bloque: 'Condicion general', Detalle: `${conditionSummary.label} - ${conditionSummary.note}` },
                    { Bloque: 'Equipo mas intervenido', Detalle: topEquipments[0] ? `${topEquipments[0][0]} (${formatNumber(topEquipments[0][1])})` : 'Sin datos' },
                    { Bloque: 'Lider con mayor actividad', Detalle: topLeaders[0] ? `${topLeaders[0][0]} (${formatNumber(topLeaders[0][1])} trab.)` : 'Sin datos' },
                    { Bloque: 'Alertas activas', Detalle: `${formatNumber(criticalMeasures.length)} critica(s) / ${formatNumber(watchMeasures.length)} seguimiento` }
                ];
                const rankingRows = [
                    ...topEquipments.slice(0, 8).map(([label, value], index) => ({
                        Categoria: 'Equipo',
                        Ranking: index + 1,
                        Nombre: label,
                        Valor: value,
                        Detalle: equipmentList.find(item => item.equipment === label)?.unit || ''
                    })),
                    ...topLeaders.slice(0, 8).map(([label, value], index) => ({
                        Categoria: 'Lider',
                        Ranking: index + 1,
                        Nombre: label,
                        Valor: value,
                        Detalle: `${formatNumber((participantStats.get(label)?.units.size) || 0)} unidad(es)`
                    }))
                ];
                const distributionRows = [
                    ...specialtyEntries.map(([label, value]) => ({
                        Tipo: 'Especialidad',
                        Nombre: label,
                        Total: value,
                        Participacion: `${tasks.length ? Math.round((value / tasks.length) * 100) : 0}%`
                    })),
                    ...unitEntries.map(([label, value]) => ({
                        Tipo: 'Unidad',
                        Nombre: label,
                        Total: value,
                        Participacion: `${tasks.length ? Math.round((value / tasks.length) * 100) : 0}%`
                    }))
                ];

                try {
                    const exportedVisual = await exportVisualDashboardWorkbook({
                        fileName: `planify_control_visual_${isoDate(rangeStart)}_${isoDate(rangeEnd)}.xlsx`,
                        summaryRows,
                        taskRows,
                        measureRows,
                        alertRows,
                        meetingRows,
                        rankingRows,
                        distributionRows
                    });
                    if (exportedVisual) {
                        if (exportXlsxBtn) {
                            exportXlsxBtn.disabled = false;
                            exportXlsxBtn.innerHTML = originalLabel;
                        }
                        return;
                    }
                } catch (error) {
                    console.error('No se pudo generar el Excel visual, se usara el export analitico.', error);
                }

                if (!canFallback) {
                    if (exportXlsxBtn) {
                        exportXlsxBtn.disabled = false;
                        exportXlsxBtn.innerHTML = originalLabel;
                    }
                    return;
                }

                workbook.Props = {
                    Title: 'Planify - Dashboard Analitico de Control',
                    Subject: 'Reporte exportado desde Control',
                    Author: 'Planify',
                    Company: 'Planify',
                    CreatedDate: new Date()
                };

                appendJsonSheet('Portada', meetingRows, { Bloque: 'Reporte', Detalle: 'Sin informacion' });
                appendJsonSheet('Resumen', summaryRows, { Indicador: 'Sin datos', Actual: '', Anterior: '', Variacion: '' });
                appendJsonSheet('Ranking', rankingRows, { Categoria: 'Sin datos', Ranking: '', Nombre: '', Valor: '', Detalle: '' });
                appendJsonSheet('Distribucion', distributionRows, { Tipo: 'Sin datos', Nombre: '', Total: '', Participacion: '' });
                appendJsonSheet('Trabajos', taskRows, { Info: 'Sin trabajos en el rango' });
                appendJsonSheet('Mediciones', measureRows, { Info: 'Sin mediciones en el rango' });
                appendJsonSheet('Alertas', alertRows, { Info: 'Sin alertas activas en el rango' });
                window.XLSX.writeFile(workbook, `planify_control_analitico_${isoDate(rangeStart)}_${isoDate(rangeEnd)}.xlsx`);
                if (exportXlsxBtn) {
                    exportXlsxBtn.disabled = false;
                    exportXlsxBtn.innerHTML = originalLabel;
                }
            }

            function openPeriodDetail(key, label, mode) {
                const detailTasks = tasks.filter(item => periodKey(item.date, granularity) === key);
                let detailMeasures = measures.filter(item => periodKey(item.date, granularity) === key);
                if (mode === 'vibracion') detailMeasures = detailMeasures.filter(item => item.type === 'vibracion');
                if (mode === 'termografia') detailMeasures = detailMeasures.filter(item => item.type === 'termografia');
                openDetailDrawer({
                    title: `Periodo ${label}`,
                    subtitle: 'Detalle del periodo seleccionado en el grafico.',
                    summary: [
                        { label: 'Trabajos', value: formatNumber(detailTasks.length), icon: 'fa-list-check' },
                        { label: 'Mediciones', value: formatNumber(detailMeasures.length), icon: 'fa-wave-square' }
                    ],
                    tasks: detailTasks,
                    measures: detailMeasures
                });
            }

            host.innerHTML = `
<div class="analytics-dashboard fade-in">
  <section class="panel analytics-panel analytics-panel--hero">
    <div class="analytics-hero-top">
      <div>
        <div class="analytics-eyebrow">Dashboard de trabajos y condicion</div>
        <h1 class="analytics-title"><i class="fa-solid fa-chart-pie"></i> Dashboard Ejecutivo</h1>
        <p class="analytics-subtitle">Vista consolidada de trabajos cerrados, mediciones, alertas y comparacion frente al periodo equivalente anterior.</p>
      </div>
      <div class="analytics-range-summary analytics-clickable" data-drill="comparison">
        <span>${formatDate(rangeStart)} - ${formatDate(rangeEnd)}</span>
        <strong>${rangeDays} dia(s)</strong>
        <span class="analytics-range-compare ${comparisonCards.tasks.className}"><i class="fa-solid ${comparisonCards.tasks.icon}"></i> ${comparisonCards.tasks.shortLabel}</span>
      </div>
    </div>
    <div class="analytics-toolbar">
      <div class="analytics-presets">
        <button class="analytics-preset ${preset === 'semanal' ? 'is-active' : ''}" data-preset="semanal">Semanal</button>
        <button class="analytics-preset ${preset === 'mensual' ? 'is-active' : ''}" data-preset="mensual">Mensual</button>
        <button class="analytics-preset ${preset === 'anual' ? 'is-active' : ''}" data-preset="anual">Anual</button>
        <button class="analytics-preset ${preset === 'custom' ? 'is-active' : ''}" data-preset="custom">Personalizado</button>
      </div>
      <div class="analytics-date-fields">
        <label><span>Desde</span><input id="dashboard-date-from" type="date" class="form-control" value="${isoDate(rangeStart)}"></label>
        <label><span>Hasta</span><input id="dashboard-date-to" type="date" class="form-control" value="${isoDate(rangeEnd)}"></label>
      </div>
      <div class="analytics-toolbar-actions">
        <button id="dashboard-export-xlsx" class="analytics-toolbar-btn" type="button"><i class="fa-solid fa-file-excel"></i> Excel Visual</button>
        <button id="dashboard-export-print" class="analytics-toolbar-btn" type="button"><i class="fa-solid fa-file-pdf"></i> PDF Gerencial</button>
      </div>
    </div>
    <div class="analytics-specialty-row">${specialtyHtml}</div>
    <div class="analytics-hero-strip">
      <article class="analytics-hero-callout analytics-clickable" data-drill="tasks-all">
        <span class="analytics-hero-label">Resumen del rango</span>
        <strong class="analytics-hero-value">${formatNumber(tasks.length)} cierres</strong>
        <span class="analytics-hero-meta">${tasks.length > 0 ? `Promedio de ${formatNumber(tasksPerDay, 1)} cierres diarios y ${formatNumber(avgHhPerTask, 1)} HH por trabajo.` : 'Aun no hay cierres registrados para este periodo.'}</span>
      </article>
      <article class="analytics-hero-card analytics-clickable" data-drill="unit" data-unit="${esc(topUnit ? topUnit[0] : '')}">
        <span class="analytics-hero-label">Mayor carga</span>
        <strong class="analytics-hero-value">${esc(topUnit ? topUnit[0] : 'Sin datos')}</strong>
        <span class="analytics-hero-meta">${topUnit ? `${formatNumber(topUnit[1])} trabajo(s) concentrados en esta unidad.` : 'Sin trabajos cerrados en el rango.'}</span>
      </article>
      <article class="analytics-hero-card analytics-clickable" data-drill="equipment" data-name="${esc(topEquipment ? topEquipment[0] : '')}" data-unit="${esc(topEquipmentStat ? topEquipmentStat.unit : '')}" data-id="${esc(topEquipmentStat ? topEquipmentStat.equipmentId : '')}">
        <span class="analytics-hero-label">Equipo foco</span>
        <strong class="analytics-hero-value">${esc(topEquipment ? topEquipment[0] : 'Sin datos')}</strong>
        <span class="analytics-hero-meta">${topEquipment ? `${formatNumber(topEquipment[1])} intervencion(es) registradas.` : 'Aun no hay equipos destacados.'}</span>
      </article>
      <article class="analytics-hero-card analytics-clickable" data-drill="${maxTemp ? 'measure' : maxVib ? 'measure' : 'measures-all'}" data-measure-id="${esc(maxTemp ? maxTemp.id : maxVib ? maxVib.id : '')}">
        <span class="analytics-hero-label">${conditionHeadline.label}</span>
        <div class="analytics-hero-status-row">
          <strong class="analytics-hero-value">${conditionHeadline.value}</strong>
          <span class="analytics-status-badge ${conditionHeadlineStatus.className}"><i class="fa-solid fa-circle"></i> ${conditionHeadlineStatus.label}</span>
        </div>
        <span class="analytics-hero-meta">${conditionHeadline.meta}</span>
      </article>
    </div>
  </section>

  <section class="analytics-kpi-sections">
    <div class="analytics-section-block">
      <div class="analytics-section-headline">
        <h3>Resumen operativo</h3>
        <span>Carga, cierres y actividad real del periodo.</span>
      </div>
      <div class="analytics-kpi-grid">
${operationKpiHtml}
      </div>
    </div>
    <div class="analytics-section-block">
      <div class="analytics-section-headline">
        <h3>Resumen de condicion</h3>
        <span>Lecturas, alertas y estado tecnico del rango seleccionado.</span>
      </div>
      <div class="analytics-kpi-grid">
${conditionKpiHtml}
      </div>
    </div>
  </section>

  <section class="analytics-alert-grid">
    <article class="panel analytics-alert-card analytics-clickable ${conditionSummary.className}" data-drill="comparison">
      <div class="analytics-alert-row">
        <span class="analytics-alert-label"><i class="fa-solid fa-gauge-high"></i> Pulso ejecutivo</span>
        <span class="analytics-status-badge ${conditionSummary.className}"><i class="fa-solid fa-circle"></i> ${conditionSummary.label}</span>
      </div>
      <strong class="analytics-alert-value">${conditionSummary.note}</strong>
      <span class="analytics-alert-meta">${comparisonCards.condition.label}. Periodo anterior: ${previousConditionSummary.label}.</span>
    </article>
    <article class="panel analytics-alert-card analytics-clickable ${criticalMeasures.length ? 'is-critical' : 'is-normal'}" data-drill="critical-measures">
      <div class="analytics-alert-row">
        <span class="analytics-alert-label"><i class="fa-solid fa-triangle-exclamation"></i> Lecturas criticas</span>
        <span class="analytics-compare-badge ${comparisonCards.critical.className}"><i class="fa-solid ${comparisonCards.critical.icon}"></i> ${comparisonCards.critical.shortLabel}</span>
      </div>
      <strong class="analytics-alert-value">${formatNumber(criticalMeasures.length)}</strong>
      <span class="analytics-alert-meta">${criticalMeasures.length ? `${formatNumber(criticalEquipmentSet.size)} equipo(s) con atencion prioritaria.` : 'No hay lecturas en zona critica dentro del rango.'}</span>
    </article>
    <article class="panel analytics-alert-card analytics-clickable ${watchMeasures.length ? 'is-watch' : 'is-normal'}" data-drill="watch-measures">
      <div class="analytics-alert-row">
        <span class="analytics-alert-label"><i class="fa-solid fa-binoculars"></i> Seguimiento activo</span>
        <span class="analytics-compare-badge ${comparisonCards.watch.className}"><i class="fa-solid ${comparisonCards.watch.icon}"></i> ${comparisonCards.watch.shortLabel}</span>
      </div>
      <strong class="analytics-alert-value">${formatNumber(watchMeasures.length)}</strong>
      <span class="analytics-alert-meta">${watchMeasures.length ? 'Lecturas en banda de seguimiento que conviene revisar pronto.' : 'No hay lecturas pendientes de seguimiento.'}</span>
    </article>
    <article class="panel analytics-alert-card analytics-clickable ${recurrentEquipments.length ? 'is-watch' : 'is-normal'}" data-drill="recurrent-equipments">
      <div class="analytics-alert-row">
        <span class="analytics-alert-label"><i class="fa-solid fa-repeat"></i> Reincidencia operativa</span>
        <span class="analytics-type-badge" style="${buildAccentVars('#2563eb', 0.12, 0.24)}">Foco</span>
      </div>
      <strong class="analytics-alert-value">${formatNumber(recurrentEquipments.length)} activo(s)</strong>
      <span class="analytics-alert-meta">${recurrentEquipments[0] ? `${esc(recurrentEquipments[0].equipment)} lidera la recurrencia del rango.` : 'Aun no hay activos con recurrencia relevante.'}</span>
    </article>
  </section>

  <section class="analytics-story-grid">
    <article class="panel analytics-story-card analytics-story-card--accent analytics-clickable" data-drill="tasks-all">
      <span class="analytics-story-label">Cobertura del periodo</span>
      <strong class="analytics-story-value">${formatNumber(participants.size)} personas activas</strong>
      <span class="analytics-story-sub">${tasks.length > 0 ? `${formatNumber(unitEntries.length)} unidad(es) con actividad y ${formatNumber(avgHhPerTask, 1)} HH promedio por trabajo.` : 'Cuando existan cierres, aqui se resumira la cobertura operacional.'}</span>
      <div class="analytics-story-meta">
        <span class="analytics-story-chip analytics-clickable" data-drill="participants-all"><i class="fa-solid fa-users"></i> ${formatNumber(participants.size)} participante(s)</span>
        <span class="analytics-story-chip analytics-clickable" data-drill="hh-all"><i class="fa-solid fa-business-time"></i> ${formatNumber(hh, 1)} HH totales</span>
        <span class="analytics-compare-badge ${comparisonCards.participants.className}"><i class="fa-solid ${comparisonCards.participants.icon}"></i> ${comparisonCards.participants.shortLabel}</span>
      </div>
    </article>
    <article class="panel analytics-story-card analytics-clickable" data-drill="equipment" data-name="${esc(topEquipment ? topEquipment[0] : '')}" data-unit="${esc(topEquipmentStat ? topEquipmentStat.unit : '')}" data-id="${esc(topEquipmentStat ? topEquipmentStat.equipmentId : '')}">
      <span class="analytics-story-label">Unidad y carga foco</span>
      <strong class="analytics-story-value">${esc(topEquipment ? topEquipment[0] : 'Sin equipo foco')}</strong>
      <span class="analytics-story-sub">${topEquipment ? `Fue el activo con mas intervenciones en el periodo, dentro de ${esc(topUnit ? topUnit[0] : 'la operacion general')}.` : 'Aun no hay suficiente actividad para destacar un equipo.'}</span>
      <div class="analytics-story-meta">
        <span class="analytics-story-chip analytics-clickable" data-drill="equipment" data-name="${esc(topEquipment ? topEquipment[0] : '')}" data-unit="${esc(topEquipmentStat ? topEquipmentStat.unit : '')}" data-id="${esc(topEquipmentStat ? topEquipmentStat.equipmentId : '')}"><i class="fa-solid fa-gears"></i> ${formatNumber(topEquipment ? topEquipment[1] : 0)} intervenciones</span>
        <span class="analytics-story-chip analytics-clickable" data-drill="unit" data-unit="${esc(topUnit ? topUnit[0] : '')}"><i class="fa-solid fa-location-dot"></i> ${esc(topUnit ? topUnit[0] : 'Sin unidad')}</span>
        <span class="analytics-compare-badge ${comparisonCards.topUnit.className}"><i class="fa-solid ${comparisonCards.topUnit.icon}"></i> ${comparisonCards.topUnit.shortLabel}</span>
      </div>
    </article>
    <article class="panel analytics-story-card analytics-clickable" data-drill="task" data-task-id="${esc(latestTask ? latestTask.id : '')}">
      <span class="analytics-story-label">Ultimo cierre visible</span>
      <strong class="analytics-story-value">${esc(latestTask ? latestTask.equipment : 'Sin registros')}</strong>
      <span class="analytics-story-sub">${latestTask ? `${esc(latestTask.unit || 'Sin unidad')} &middot; ${esc(latestTask.leader || 'Sin lider')} &middot; ${esc(formatDate(latestTask.date))}` : 'No hay trabajos cerrados para mostrar en este rango.'}</span>
      <div class="analytics-story-meta">
        <span class="analytics-story-chip analytics-clickable" data-drill="ot" data-ot="${esc(latestTask ? (latestTask.ot || '') : '')}"><i class="fa-solid fa-hashtag"></i> ${esc(latestTask ? (latestTask.ot || 'Sin OT') : 'Sin OT')}</span>
        <span class="analytics-story-chip analytics-clickable" data-drill="specialty" data-specialty="${esc(topType ? topType[0] : '')}"><i class="fa-solid fa-chart-simple"></i> ${esc(topType ? topType[0] : 'Sin tipo')}</span>
      </div>
    </article>
  </section>

  <section class="analytics-grid analytics-grid--charts">
    <article class="panel analytics-panel">
      <div class="analytics-panel-head">
        <div class="analytics-panel-head-copy">
          <span class="analytics-panel-kicker">Operacion</span>
          <h3>Trabajos por periodo</h3>
          <span>Una sola lectura: cantidad de cierres por bloque temporal.</span>
        </div>
      </div>
      <div class="analytics-chart-wrap analytics-chart-wrap--wide"><canvas id="chart-dashboard-jobs"></canvas></div>
      <div class="analytics-chart-note"><span><strong>Pico:</strong> ${jobsPeak ? `${esc(labels[jobsPeak.index])} / ${formatNumber(jobsPeak.value)} cierre(s)` : 'Sin datos'}</span><span>${comparisonCards.tasks.shortLabel}</span></div>
    </article>
    <article class="panel analytics-panel">
      <div class="analytics-panel-head">
        <div class="analytics-panel-head-copy">
          <span class="analytics-panel-kicker">Operacion</span>
          <h3>HH por periodo</h3>
          <span>Horas declaradas sin mezclar escalas con los cierres.</span>
        </div>
      </div>
      <div class="analytics-chart-wrap analytics-chart-wrap--wide"><canvas id="chart-dashboard-hh"></canvas></div>
      <div class="analytics-chart-note"><span><strong>Pico:</strong> ${hhPeak ? `${esc(labels[hhPeak.index])} / ${formatNumber(hhPeak.value, 1)} HH` : 'Sin datos'}</span><span><strong>Prom:</strong> ${formatNumber(avgHhPerTask, 1)} HH por cierre</span></div>
    </article>
    <article class="panel analytics-panel analytics-span-2 analytics-visual-panel">
      <div class="analytics-panel-head">
        <div class="analytics-panel-head-copy">
          <span class="analytics-panel-kicker">Lectura visual</span>
          <h3>Distribuciones clave</h3>
          <span>Mezcla de HH y carga operativa para leer rapido donde se fue el trabajo del periodo.</span>
        </div>
      </div>
      <div class="analytics-print-donut-grid">${mixedVisualCardsHtml}</div>
      <div class="analytics-chart-note">
        <span><strong>${esc(topHhType ? topHhType[0] : 'Sin tecnica')}</strong> ${topHhType ? `${formatNumber(topHhType[1], 1)} HH` : 'sin HH por tecnica'}</span>
        <span><strong>${esc(topHhUnit ? topHhUnit[0] : 'Sin unidad')}</strong> ${topHhUnit ? `${formatNumber(topHhUnit[1], 1)} HH` : 'sin HH por unidad'}</span>
        <span><strong>${esc(topUnit ? topUnit[0] : 'Sin unidad')}</strong> ${topUnit ? `${formatNumber(topUnit[1])} trabajo(s)` : 'sin carga por unidad'}</span>
        <span><strong>${esc(topType ? topType[0] : 'Sin tecnica')}</strong> ${topType ? `${formatNumber(topType[1])} trabajo(s)` : 'sin tipo dominante'}</span>
      </div>
    </article>
    <article class="panel analytics-panel">
      <div class="analytics-panel-head">
        <div class="analytics-panel-head-copy">
          <span class="analytics-panel-kicker">Condicion</span>
          <h3>Vibracion promedio</h3>
          <span>Con bandas de seguimiento y atencion para leer tendencia rapido.</span>
        </div>
      </div>
      <div class="analytics-chart-wrap analytics-chart-wrap--wide"><canvas id="chart-dashboard-vibration"></canvas></div>
      <div class="analytics-chart-note"><span><strong>Ultima:</strong> ${vibLatestPoint ? `${formatNumber(vibLatestPoint.value, 2)} mm/s` : 'Sin dato'}</span><span><strong>Pico:</strong> ${vibPeakPoint ? `${formatNumber(vibPeakPoint.value, 2)} mm/s` : 'Sin dato'}</span></div>
    </article>
    <article class="panel analytics-panel">
      <div class="analytics-panel-head">
        <div class="analytics-panel-head-copy">
          <span class="analytics-panel-kicker">Condicion</span>
          <h3>Termografia promedio</h3>
          <span>Separada de vibracion para evitar dobles ejes y lecturas confusas.</span>
        </div>
      </div>
      <div class="analytics-chart-wrap analytics-chart-wrap--wide"><canvas id="chart-dashboard-temperature"></canvas></div>
      <div class="analytics-chart-note"><span><strong>Ultima:</strong> ${tempLatestPoint ? `${formatNumber(tempLatestPoint.value, 1)} C` : 'Sin dato'}</span><span><strong>Pico:</strong> ${tempPeakPoint ? `${formatNumber(tempPeakPoint.value, 1)} C` : 'Sin dato'}</span></div>
    </article>
    <article class="panel analytics-panel">
      <div class="analytics-panel-head">
        <div class="analytics-panel-head-copy">
          <span class="analytics-panel-kicker">Distribucion</span>
          <h3>Carga por especialidad</h3>
          <span>Ordenada de mayor a menor, con cantidad real de cierres.</span>
        </div>
      </div>
      <div class="analytics-chart-wrap analytics-chart-wrap--small"><canvas id="chart-dashboard-types"></canvas></div>
      <div class="analytics-chart-note"><span><strong>${esc(topType ? topType[0] : 'Sin tecnica')}</strong> ${topType ? `${topTypePercent}% del total` : 'sin distribucion dominante'}</span><span>${formatNumber(specialtyEntries.length)} especialidad(es) activas</span></div>
    </article>
    <article class="panel analytics-panel">
      <div class="analytics-panel-head">
        <div class="analytics-panel-head-copy">
          <span class="analytics-panel-kicker">Distribucion</span>
          <h3>Carga por unidad</h3>
          <span>Top unidades intervenidas durante el rango.</span>
        </div>
      </div>
      <div class="analytics-chart-wrap analytics-chart-wrap--small"><canvas id="chart-dashboard-units"></canvas></div>
      <div class="analytics-chart-note"><span><strong>${esc(topUnit ? topUnit[0] : 'Sin unidad')}</strong> ${topUnit ? `${formatNumber(topUnit[1])} trabajo(s)` : 'sin carga dominante'}</span><span>${formatNumber(unitEntries.length)} unidad(es) con actividad</span></div>
    </article>
    <article class="panel analytics-panel">
      <div class="analytics-panel-head">
        <div class="analytics-panel-head-copy">
          <span class="analytics-panel-kicker">Foco</span>
          <h3>Top equipos</h3>
          <span>Activos con mayor reincidencia operacional.</span>
        </div>
      </div>
      <div class="analytics-chart-wrap analytics-chart-wrap--small"><canvas id="chart-dashboard-equipments"></canvas></div>
      <div class="analytics-chart-note"><span><strong>${esc(topEquipmentStat ? topEquipmentStat.equipment : 'Sin equipo')}</strong> ${topEquipment ? `${formatNumber(topEquipment[1])} interv.` : 'sin reincidencia'}</span><span>${formatNumber(recurrentEquipments.length)} equipo(s) recurrentes</span></div>
    </article>
    <article class="panel analytics-panel">
      <div class="analytics-panel-head">
        <div class="analytics-panel-head-copy">
          <span class="analytics-panel-kicker">Foco</span>
          <h3>Alertas prioritarias</h3>
          <span>Lecturas y activos que conviene mirar primero.</span>
        </div>
      </div>
      <div class="analytics-alert-list">${priorityAlertsHtml}</div>
    </article>
  </section>

  <section class="analytics-mini-grid">
    <article class="panel analytics-mini-card analytics-clickable ${maxVibStatus ? maxVibStatus.cardClass : ''}" data-drill="${maxVib ? 'measure' : 'measures-all'}" data-measure-id="${esc(maxVib ? maxVib.id : '')}">
      <div class="analytics-mini-top">
        <span class="analytics-mini-label">Max vibracion</span>
        ${maxVibStatus ? `<span class="analytics-status-badge ${maxVibStatus.className}"><i class="fa-solid fa-circle"></i> ${maxVibStatus.label}</span>` : ''}
      </div>
      <strong>${maxVib ? `${formatNumber(maxVib.value, 2)} mm/s` : 'Sin datos'}</strong>
      <span>${maxVib ? `${maxVib.equipment} &middot; ${maxVib.unit || 'Sin unidad'}` : 'No hay mediciones de vibracion'}</span>
    </article>
    <article class="panel analytics-mini-card analytics-clickable ${maxTempStatus ? maxTempStatus.cardClass : ''}" data-drill="${maxTemp ? 'measure' : 'measures-all'}" data-measure-id="${esc(maxTemp ? maxTemp.id : '')}">
      <div class="analytics-mini-top">
        <span class="analytics-mini-label">Max termografia</span>
        ${maxTempStatus ? `<span class="analytics-status-badge ${maxTempStatus.className}"><i class="fa-solid fa-circle"></i> ${maxTempStatus.label}</span>` : ''}
      </div>
      <strong>${maxTemp ? `${formatNumber(maxTemp.value, 1)} C` : 'Sin datos'}</strong>
      <span>${maxTemp ? `${maxTemp.equipment} &middot; ${maxTemp.unit || 'Sin unidad'}` : 'No hay mediciones termograficas'}</span>
    </article>
    <article class="panel analytics-mini-card analytics-clickable" data-drill="participant" data-name="${esc(topLeaders[0] ? topLeaders[0][0] : '')}">
      <div class="analytics-mini-top">
        <span class="analytics-mini-label">Top lider</span>
        <span class="analytics-type-badge" style="${buildAccentVars('#7c3aed', 0.1, 0.2)}">Carga</span>
      </div>
      <strong>${esc(topLeaders[0] ? topLeaders[0][0] : 'Sin datos')}</strong>
      <span>${formatNumber(topLeaders[0] ? topLeaders[0][1] : 0)} trabajo(s)</span>
    </article>
    <article class="panel analytics-mini-card analytics-clickable ${conditionSummary.className}" data-drill="measures-all">
      <div class="analytics-mini-top">
        <span class="analytics-mini-label">Estado condicion</span>
        <span class="analytics-status-badge ${conditionSummary.className}"><i class="fa-solid fa-circle"></i> ${conditionSummary.label}</span>
      </div>
      <strong>${conditionSummary.label}</strong>
      <span>${conditionSummary.note}</span>
      <span class="analytics-compare-badge ${comparisonCards.condition.className}"><i class="fa-solid ${comparisonCards.condition.icon}"></i> ${comparisonCards.condition.shortLabel}</span>
    </article>
  </section>

  <section class="analytics-grid analytics-grid--bottom">
    <article class="panel analytics-panel analytics-span-2"><div class="analytics-panel-head"><h3>Detalle de trabajos</h3><span>${formatNumber(tasks.length)} registro(s) en el rango, mostrando los mas recientes</span></div><div class="analytics-table-wrap"><table class="analytics-table"><thead><tr><th>Fecha</th><th>Unidad</th><th>Equipo</th><th>Tipo</th><th>Lider</th><th>OT</th><th>Aviso</th><th>HH</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="analytics-empty-cell">No hay trabajos cerrados en el rango seleccionado.</td></tr>'}</tbody></table></div></article>
    <article class="panel analytics-panel"><div class="analytics-panel-head"><h3>Top lideres</h3><span>Responsables con mayor actividad</span></div><div class="analytics-ranking-list">${leaderHtml}</div></article>
  </section>

  <section class="analytics-print-report">
    <div class="analytics-print-header">
      <div class="analytics-print-brand">
        <div class="analytics-print-mark">
          <span class="analytics-print-mark-badge"><i class="fa-solid fa-calendar-check"></i></span>
          <div>
            <strong>Planify</strong>
            <span>Informe ejecutivo de trabajos, condicion y alertas</span>
          </div>
        </div>
        <div class="analytics-print-meta">
          <span>Rango</span>
          <strong>${formatDate(rangeStart)} - ${formatDate(rangeEnd)}</strong>
          <span>Generado: ${formatDateTime(new Date())}</span>
        </div>
      </div>
      <div class="analytics-print-foot analytics-print-foot--header">
        <span>Periodo anterior usado para comparacion: ${formatDate(previousRangeStart)} - ${formatDate(previousRangeEnd)}</span>
        <span>${rangeDays} dia(s) analizados</span>
      </div>
    </div>

    <section class="analytics-print-hero-grid">
      ${printHeroTilesHtmlEnhanced}
    </section>

    <section class="analytics-print-section">
      <div class="analytics-print-section-head">
        <h2>Lectura ejecutiva</h2>
        <span>Mensajes breves para abrir la reunion con foco claro.</span>
      </div>
      <div class="analytics-print-brief-grid">${printBriefingHtml}</div>
    </section>

    <section class="analytics-print-section">
      <div class="analytics-print-section-head">
        <h2>Resumen ejecutivo</h2>
        <span>KPIs comparados contra el periodo anterior equivalente</span>
      </div>
      <div class="analytics-print-kpis">${printKpisHtml}</div>
    </section>

    <section class="analytics-print-section">
      <div class="analytics-print-section-head">
        <h2>Distribuciones y lectura visual</h2>
        <span>Composicion real del periodo actual</span>
      </div>
      <div class="analytics-print-donut-grid">${printDonutCardsHtml}</div>
      <div class="analytics-print-bar-grid">${printBarChartsHtml}</div>
    </section>

    <section class="analytics-print-section analytics-print-page-break">
      <div class="analytics-print-section-head">
        <h2>Lectura para reunion</h2>
        <span>Resumen ejecutivo y focos de accion</span>
      </div>
      <div class="analytics-print-grid">
        <article class="analytics-print-card">
          <h3>Mensajes clave</h3>
          <div class="analytics-print-list">${printMeetingHighlightsHtml}</div>
        </article>
        <article class="analytics-print-card">
          <h3>Siguientes acciones</h3>
          <div class="analytics-print-list">${printMeetingActionsHtml}</div>
        </article>
      </div>
    </section>

    <section class="analytics-print-section">
      <div class="analytics-print-section-head">
        <h2>Alertas y focos</h2>
        <span>Estado general: ${conditionSummary.label}</span>
      </div>
      <div class="analytics-print-grid">
        <article class="analytics-print-card ${conditionSummary.className}">
          <h3>Pulso de condicion</h3>
          <div class="analytics-alert-row">
            <strong class="analytics-alert-value">${conditionSummary.label}</strong>
            <span class="analytics-compare-badge ${comparisonCards.condition.className}"><i class="fa-solid ${comparisonCards.condition.icon}"></i> ${comparisonCards.condition.shortLabel}</span>
          </div>
          <span class="analytics-alert-meta">${conditionSummary.note}</span>
          <span class="analytics-alert-meta">Periodo anterior: ${previousConditionSummary.label}.</span>
        </article>
        <article class="analytics-print-card ${criticalMeasures.length ? 'is-critical' : watchMeasures.length ? 'is-watch' : 'is-normal'}">
          <h3>Alertas prioritarias</h3>
          <div class="analytics-print-list">${printAlertsListHtml}</div>
        </article>
      </div>
    </section>

    <section class="analytics-print-section">
      <div class="analytics-print-section-head">
        <h2>Ranking operacional</h2>
        <span>Equipos y lideres mas activos del rango</span>
      </div>
      <div class="analytics-print-grid">
        <article class="analytics-print-card">
          <h3>Top equipos</h3>
          <div class="analytics-print-list">${printEquipmentHtml}</div>
        </article>
        <article class="analytics-print-card">
          <h3>Top lideres</h3>
          <div class="analytics-print-list">${printLeaderHtml}</div>
        </article>
      </div>
    </section>

    <section class="analytics-print-section">
      <div class="analytics-print-section-head">
        <h2>Trabajos cerrados recientes</h2>
        <span>Extracto de los cierres del rango actual</span>
      </div>
      <table class="analytics-print-table">
        <thead><tr><th>Fecha</th><th>Unidad</th><th>Equipo</th><th>Especialidad</th><th>Lider</th><th>OT</th><th>HH</th></tr></thead>
        <tbody>${printTasksRows}</tbody>
      </table>
    </section>

    <section class="analytics-print-section">
      <div class="analytics-print-section-head">
        <h2>Mediciones recientes</h2>
        <span>Extracto de vibraciones y termografia del rango</span>
      </div>
      <table class="analytics-print-table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Unidad</th><th>Equipo</th><th>Punto</th><th>Valor</th><th>Estado</th></tr></thead>
        <tbody>${printMeasuresRows}</tbody>
      </table>
    </section>

    <div class="analytics-print-foot">
      <span>Documento generado desde Planify para exportacion PDF.</span>
      <span>Total trabajos: ${formatNumber(tasks.length)} - Total mediciones: ${formatNumber(measures.length)}</span>
    </div>
  </section>
  <div id="analytics-detail-root" class="analytics-detail-root"></div>
</div>`;

            host.querySelectorAll('[data-preset]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const value = btn.dataset.preset;
                    if (value === 'custom') {
                        preset = 'custom';
                        draw();
                        return;
                    }
                    setPreset(value);
                    draw();
                });
            });

            const fromInput = document.getElementById('dashboard-date-from');
            const toInput = document.getElementById('dashboard-date-to');
            if (fromInput) {
                fromInput.addEventListener('change', () => {
                    if (!fromInput.value) return;
                    preset = 'custom';
                    from = new Date(`${fromInput.value}T00:00:00`);
                    if (from > to) to = new Date(from);
                    draw();
                });
            }
            if (toInput) {
                toInput.addEventListener('change', () => {
                    if (!toInput.value) return;
                    preset = 'custom';
                    to = new Date(`${toInput.value}T00:00:00`);
                    if (to < from) from = new Date(to);
                    draw();
                });
            }

            const exportXlsxBtn = document.getElementById('dashboard-export-xlsx');
            if (exportXlsxBtn) {
                exportXlsxBtn.addEventListener('click', () => exportDashboardWorkbook());
            }

            const exportPrintBtn = document.getElementById('dashboard-export-print');
            if (exportPrintBtn) {
                exportPrintBtn.addEventListener('click', () => {
                    closeDetailDrawer();
                    document.body.classList.add('analytics-print-mode');
                    requestAnimationFrame(() => {
                        setTimeout(() => window.print(), 60);
                    });
                });
            }

            detailRoot = host.querySelector('#analytics-detail-root');
            const dashboardRoot = host.querySelector('.analytics-dashboard');
            if (dashboardRoot) {
                dashboardRoot.addEventListener('click', event => {
                    const closeTrigger = event.target.closest('[data-drill-close="true"]');
                    if (closeTrigger) {
                        event.preventDefault();
                        closeDetailDrawer();
                        return;
                    }

                    const equipmentTrigger = event.target.closest('.analytics-link-btn, .analytics-detail-equipment-btn');
                    if (equipmentTrigger) {
                        event.preventDefault();
                        event.stopPropagation();
                        openEquipment(equipmentTrigger.dataset.eq, equipmentTrigger.dataset.unit, equipmentTrigger.dataset.id);
                        return;
                    }

                    const drillTrigger = event.target.closest('[data-drill]');
                    if (!drillTrigger) return;
                    if (!drillTrigger.closest('.analytics-detail-drawer')) {
                        setDetailAnchor(event);
                    }

                    const { drill, unit, specialty, name, taskId, measureId, ot, id } = drillTrigger.dataset;
                    if (drill === 'tasks-all') {
                        openDetailDrawer({
                            title: 'Trabajos cerrados',
                            subtitle: 'Detalle completo de trabajos del rango actual.',
                            summary: [
                                { label: 'Trabajos', value: formatNumber(tasks.length), icon: 'fa-list-check' },
                                { label: 'HH', value: formatNumber(hh, 1), icon: 'fa-business-time' }
                            ],
                            tasks
                        });
                    } else if (drill === 'measures-all') {
                        openDetailDrawer({
                            title: 'Mediciones',
                            subtitle: 'Detalle completo de vibraciones y termografias del rango.',
                            summary: [
                                { label: 'Mediciones', value: formatNumber(measures.length), icon: 'fa-wave-square' },
                                { label: 'Vibracion', value: formatNumber(measures.filter(item => item.type === 'vibracion').length), icon: 'fa-chart-line' },
                                { label: 'Termografia', value: formatNumber(measures.filter(item => item.type === 'termografia').length), icon: 'fa-temperature-three-quarters' }
                            ],
                            measures
                        });
                    } else if (drill === 'hh-all') {
                        openDetailDrawer({
                            title: 'HH registradas',
                            subtitle: 'Trabajos ordenados por horas-hombre registradas.',
                            summary: [
                                { label: 'HH', value: formatNumber(hh, 1), icon: 'fa-business-time' },
                                { label: 'Promedio', value: formatNumber(avgHhPerTask, 1), icon: 'fa-chart-simple' }
                            ],
                            tasks: [...tasks].sort((a, b) => (b.hh || 0) - (a.hh || 0))
                        });
                    } else if (drill === 'ots-all') {
                        openOtList();
                    } else if (drill === 'equipments-all') {
                        openEquipmentOverview();
                    } else if (drill === 'participants-all') {
                        openParticipantOverview();
                    } else if (drill === 'comparison') {
                        openComparisonOverview();
                    } else if (drill === 'unit' && unit) {
                        openUnitDetail(unit);
                    } else if (drill === 'specialty' && specialty) {
                        openSpecialtyDetail(specialty);
                    } else if (drill === 'equipment' && name) {
                        openEquipmentDetail(name, unit, id);
                    } else if (drill === 'task' && taskId) {
                        openTaskDetail(taskById.get(String(taskId)));
                    } else if (drill === 'measure' && measureId) {
                        openMeasureDetail(measureById.get(String(measureId)));
                    } else if (drill === 'critical-measures') {
                        openMeasuresByStatus('is-critical');
                    } else if (drill === 'watch-measures') {
                        openMeasuresByStatus('is-watch');
                    } else if (drill === 'recurrent-equipments') {
                        openRecurringEquipmentOverview();
                    } else if (drill === 'participant' && name) {
                        openLeaderDetail(name);
                    } else if (drill === 'ot' && ot) {
                        openOtDetail(ot);
                    }
                });
            }

            if (!window.Chart) return;
            const warmGrid = 'rgba(226,232,240,.92)';
            const neutralTicks = '#64748b';
            const common = {
                maintainAspectRatio: false,
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                onHover: (event, elements) => {
                    if (event?.native?.target) event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#475569',
                            boxWidth: 12,
                            boxHeight: 12,
                            usePointStyle: true,
                            padding: 14
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: neutralTicks }, grid: { display: false } },
                    y: { ticks: { color: neutralTicks }, grid: { color: warmGrid } }
                }
            };
            const chartPointColors = values => values.map((_, index) => index === values.length - 1 ? '#f97316' : '#fdba74');
            const lineThreshold = (length, value) => Array.from({ length }, () => value);
            const equipmentLookup = new Map(equipmentList.map(item => [item.equipment, item]));

            const jobsEl = document.getElementById('chart-dashboard-jobs');
            if (jobsEl) charts.push(new Chart(jobsEl, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Trabajos',
                            data: jobs,
                            backgroundColor: chartPointColors(jobs),
                            borderRadius: 10,
                            maxBarThickness: 34
                        }
                    ]
                },
                options: {
                    ...common,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: context => `Trabajos: ${formatNumber(context.parsed.y)}`,
                                afterLabel: context => [
                                    `${formatNumber(otSeries[context.dataIndex])} OT / ${formatNumber(equipmentSeries[context.dataIndex])} equipo(s)`,
                                    formatSeriesDelta(jobs, context.dataIndex, 0, 'trab.')
                                ]
                            }
                        }
                    },
                    onClick: (event, elements, chart) => {
                        if (!elements.length) return;
                        setDetailAnchorFromChart(event, chart, elements);
                        const index = elements[0].index;
                        openPeriodDetail(keys[index], labels[index]);
                    },
                    scales: {
                        x: common.scales.x,
                        y: { ...common.scales.y, beginAtZero: true, ticks: { color: neutralTicks, precision: 0 } }
                    }
                }
            }));

            const hhEl = document.getElementById('chart-dashboard-hh');
            if (hhEl) charts.push(new Chart(hhEl, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'HH',
                            data: hhSeries,
                            borderColor: '#475569',
                            backgroundColor: 'rgba(100,116,139,.12)',
                            fill: true,
                            tension: .3,
                            pointRadius: 3,
                            pointHoverRadius: 4
                        }
                    ]
                },
                options: {
                    ...common,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: context => `HH: ${formatNumber(context.parsed.y, 1)}`,
                                afterLabel: context => [
                                    jobs[context.dataIndex]
                                        ? `${formatNumber(hhSeries[context.dataIndex] / jobs[context.dataIndex], 1)} HH por cierre`
                                        : 'Sin cierres en este bloque',
                                    formatSeriesDelta(hhSeries, context.dataIndex, 1, 'HH')
                                ]
                            }
                        }
                    },
                    onClick: (event, elements, chart) => {
                        if (!elements.length) return;
                        setDetailAnchorFromChart(event, chart, elements);
                        const index = elements[0].index;
                        openPeriodDetail(keys[index], labels[index]);
                    },
                    scales: {
                        x: common.scales.x,
                        y: { ...common.scales.y, beginAtZero: true }
                    }
                }
            }));

            const typesEl = document.getElementById('chart-dashboard-types');
            if (typesEl) {
                const labelsType = specialtyEntries.map(item => item[0]);
                const valuesType = specialtyEntries.map(item => item[1]);
                charts.push(new Chart(typesEl, {
                    type: 'bar',
                    data: {
                        labels: labelsType,
                        datasets: [{
                            label: 'Trabajos',
                            data: valuesType,
                            backgroundColor: labelsType.map((label, index) => index === 0 ? '#f97316' : index === 1 ? '#fb923c' : (TYPE_COLORS[label] || '#cbd5e1')),
                            borderRadius: 10,
                            borderSkipped: false
                        }]
                    },
                    options: {
                        ...common,
                        indexAxis: 'y',
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: context => `Cierres: ${formatNumber(context.parsed.x)}`,
                                    afterLabel: context => `Participacion: ${sharePercent(valuesType[context.dataIndex], tasks.length)}% del total`
                                }
                            }
                        },
                        onClick: (event, elements, chart) => {
                            if (!elements.length) return;
                            setDetailAnchorFromChart(event, chart, elements);
                            const index = elements[0].index;
                            openSpecialtyDetail(labelsType[index]);
                        },
                        scales: {
                            x: { ...common.scales.x, beginAtZero: true, ticks: { color: neutralTicks, precision: 0 } },
                            y: { ...common.scales.y, grid: { display: false } }
                        }
                    }
                }));
            }

            const unitEl = document.getElementById('chart-dashboard-units');
            if (unitEl) {
                const topUnits = [...byUnit.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
                charts.push(new Chart(unitEl, {
                    type: 'bar',
                    data: {
                        labels: topUnits.map(item => item[0]),
                        datasets: [{
                            label: 'Trabajos',
                            data: topUnits.map(item => item[1]),
                            backgroundColor: topUnits.map((_, index) => unitPalette[index % unitPalette.length]),
                            borderRadius: 10,
                            borderSkipped: false
                        }]
                    },
                    options: {
                        ...common,
                        indexAxis: 'y',
                        onClick: (event, elements, chart) => {
                            if (!elements.length) return;
                            setDetailAnchorFromChart(event, chart, elements);
                            const index = elements[0].index;
                            openUnitDetail(topUnits[index][0]);
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: context => `Trabajos: ${formatNumber(context.parsed.x)}`,
                                    afterLabel: context => `Participacion: ${sharePercent(topUnits[context.dataIndex][1], tasks.length)}% del total`
                                }
                            }
                        },
                        scales: {
                            x: { ...common.scales.x, beginAtZero: true, ticks: { color: neutralTicks, precision: 0 } },
                            y: { ...common.scales.y, grid: { display: false } }
                        }
                    }
                }));
            }

            const vibrationEl = document.getElementById('chart-dashboard-vibration');
            if (vibrationEl) charts.push(new Chart(vibrationEl, {
                type: 'line',
                data: {
                    labels: vibChartLabels,
                    datasets: [
                        { label: 'Vibracion promedio', data: vibChartSeries, borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,.16)', fill: true, tension: .2, pointRadius: 3, pointHoverRadius: 4 },
                        { label: 'Seguimiento', data: lineThreshold(vibChartLabels.length, 3.2), borderColor: '#f59e0b', borderDash: [7, 6], pointRadius: 0, pointHoverRadius: 0, fill: false },
                        { label: 'Atencion', data: lineThreshold(vibChartLabels.length, 4.5), borderColor: '#dc2626', borderDash: [7, 6], pointRadius: 0, pointHoverRadius: 0, fill: false }
                    ]
                },
                options: {
                    ...common,
                    plugins: {
                        ...common.plugins,
                        tooltip: {
                            filter: context => context.datasetIndex === 0,
                            callbacks: {
                                label: context => `Promedio: ${formatNumber(context.parsed.y, 2)} mm/s`,
                                afterLabel: context => [
                                    formatSeriesDelta(vibChartSeries, context.dataIndex, 2, 'mm/s'),
                                    formatThresholdGap(context.parsed.y, 3.2, 4.5, 2, 'mm/s')
                                ]
                            }
                        }
                    },
                    onClick: (event, elements, chart) => {
                        if (!elements.length) return;
                        setDetailAnchorFromChart(event, chart, elements);
                        const index = elements[0].index;
                        openPeriodDetail(vibChartKeys[index], vibChartLabels[index], 'vibracion');
                    },
                    scales: {
                        x: common.scales.x,
                        y: {
                            ...common.scales.y,
                            beginAtZero: true,
                            ticks: {
                                color: neutralTicks,
                                callback: value => `${formatNumber(Number(value), 1)} mm/s`
                            }
                        }
                    }
                }
            }));

            const temperatureEl = document.getElementById('chart-dashboard-temperature');
            if (temperatureEl) charts.push(new Chart(temperatureEl, {
                type: 'line',
                data: {
                    labels: tempChartLabels,
                    datasets: [
                        { label: 'Termografia promedio', data: tempChartSeries, borderColor: '#9a3412', backgroundColor: 'rgba(251,146,60,.16)', fill: true, tension: .2, pointRadius: 3, pointHoverRadius: 4 },
                        { label: 'Seguimiento', data: lineThreshold(tempChartLabels.length, 65), borderColor: '#f59e0b', borderDash: [7, 6], pointRadius: 0, pointHoverRadius: 0, fill: false },
                        { label: 'Atencion', data: lineThreshold(tempChartLabels.length, 80), borderColor: '#dc2626', borderDash: [7, 6], pointRadius: 0, pointHoverRadius: 0, fill: false }
                    ]
                },
                options: {
                    ...common,
                    plugins: {
                        ...common.plugins,
                        tooltip: {
                            filter: context => context.datasetIndex === 0,
                            callbacks: {
                                label: context => `Promedio: ${formatNumber(context.parsed.y, 1)} C`,
                                afterLabel: context => [
                                    formatSeriesDelta(tempChartSeries, context.dataIndex, 1, 'C'),
                                    formatThresholdGap(context.parsed.y, 65, 80, 1, 'C')
                                ]
                            }
                        }
                    },
                    onClick: (event, elements, chart) => {
                        if (!elements.length) return;
                        setDetailAnchorFromChart(event, chart, elements);
                        const index = elements[0].index;
                        openPeriodDetail(tempChartKeys[index], tempChartLabels[index], 'termografia');
                    },
                    scales: {
                        x: common.scales.x,
                        y: {
                            ...common.scales.y,
                            beginAtZero: false,
                            ticks: {
                                color: neutralTicks,
                                callback: value => `${formatNumber(Number(value), 0)} C`
                            }
                        }
                    }
                }
            }));

            const equipmentEl = document.getElementById('chart-dashboard-equipments');
            if (equipmentEl) charts.push(new Chart(equipmentEl, {
                type: 'bar',
                data: {
                    labels: topEquipments.map(item => item[0]),
                    datasets: [{
                        label: 'Intervenciones',
                        data: topEquipments.map(item => item[1]),
                        backgroundColor: topEquipments.map((_, index) => index === 0 ? '#f97316' : index === 1 ? '#fb923c' : '#cbd5e1'),
                        borderRadius: 10,
                        borderSkipped: false
                    }]
                },
                options: {
                    ...common,
                    indexAxis: 'y',
                    onClick: (event, elements, chart) => {
                        if (!elements.length) return;
                        setDetailAnchorFromChart(event, chart, elements);
                        const index = elements[0].index;
                        const stat = equipmentList.find(item => item.equipment === topEquipments[index][0]) || null;
                        openEquipmentDetail(topEquipments[index][0], stat ? stat.unit : '', stat ? stat.equipmentId : '');
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: context => `Intervenciones: ${formatNumber(context.parsed.x)}`,
                                afterLabel: context => {
                                    const stat = equipmentLookup.get(topEquipments[context.dataIndex][0]);
                                    return stat
                                        ? [
                                            `${stat.unit || 'Sin unidad'} / ${formatNumber(stat.measures)} medicion(es)`,
                                            `${formatNumber(stat.hh, 1)} HH acumuladas`
                                        ]
                                        : 'Sin detalle adicional';
                                }
                            }
                        }
                    },
                    scales: {
                        x: { ...common.scales.x, beginAtZero: true, ticks: { color: neutralTicks, precision: 0 } },
                        y: { ...common.scales.y, grid: { display: false } }
                    }
                }
            }));
        }

        setPreset('mensual');
        draw();
    }

    window.renderControlView = renderDashboard;
    try { renderControlView = renderDashboard; } catch (_) {}
})();
