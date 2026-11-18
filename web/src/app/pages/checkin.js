// تنظيم — شاشة موظف الاستقبال: مسح QR بالكاميرا أو الماسح، بحث يدوي بالاسم أو الجوال أو الهوية، تحديث فوري بصوت ولون،
// طباعة البطاقة بنقرة، سجل مباشر، ووضع احتياطي يعمل عند انقطاع الشبكة ثم يزامن.
import { h, icon, clear, debounce } from '../../core/dom.js';
import { t, fmtNum, fmtTime, pick, opt } from '../../core/i18n.js';
import { api, post } from '../../core/api.js';
import { toast, errText, beep, avatar, empty, badge } from '../../core/ui.js';
import { startScanner } from '../../core/scanner.js';
import { printSvg } from '../../core/printing.js';
import { pageHead } from '../main.js';

const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } } };
async function fingerprint(token) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token).trim()));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export default async function checkin({ root, query, ws, can }) {
    const saved = store.get('tz_checkin', {});
    const st = { subjectType: query.subject_type || saved.subjectType || 'event', subjectId: query.subject_id || saved.subjectId || '', direction: saved.direction || 'auto', gate: saved.gate || '', autoPrint: saved.autoPrint ?? false, offline: !navigator.onLine, stopCam: null, busy: false };
    const [events, visits] = await Promise.all([api('events', { query: { size: 200, sort: 'starts_at', dir: 'desc' } }), api('visits', { query: { size: 200, sort: 'starts_at', dir: 'desc' } }).catch(() => ({ rows: [] }))]);
    const evOpts = events.rows.filter((e) => ['published', 'running'].includes(e.status)).sort((a, b) => (b.status === 'running') - (a.status === 'running'));
    const viOpts = visits.rows.filter((v) => ['approved', 'permit_issued', 'checked_in'].includes(v.status));
    if (!st.subjectId) st.subjectId = String((st.subjectType === 'event' ? evOpts[0] : viOpts[0])?.id || '');
    const persist = () => store.set('tz_checkin', { subjectType: st.subjectType, subjectId: st.subjectId, direction: st.direction, gate: st.gate, autoPrint: st.autoPrint });

    const statsBox = h('div.kpis', { style: { marginBottom: 0 } });
    const result = h('div', { 'aria-live': 'assertive', style: { minHeight: '190px' } });
    const cam = h('div', { style: { aspectRatio: '4/3', background: 'var(--neutral-bg)', borderRadius: '14px', display: 'grid', placeItems: 'center' } }, h('div.muted', icon('camera'), ' ', t('ci.camera_off')));
    const feed = h('div', { style: { maxHeight: '420px', overflow: 'auto' } });
    const offlineBar = h('div');
    const codeInput = h('input.input', { placeholder: t('ci.scan_placeholder'), autocomplete: 'off', style: { height: '46px', fontSize: '16px' }, 'aria-label': t('ci.scan_placeholder'),
        on: { keydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { const v = e.target.value.trim(); e.target.value = ''; handleToken(v); } } } });
    const searchRes = h('div');
    const search = h('input.input', { type: 'search', placeholder: t('ci.search_placeholder'), 'aria-label': t('ci.search_placeholder'), on: { input: debounce(doSearch, 250) } });

    const settings = h('div.card', h('div.card-b', { style: { display: 'grid', gap: '12px' } }));
    function drawSettings() {
        const opts = st.subjectType === 'event' ? evOpts.map((e) => ({ value: e.id, label: pick(e, 'title') })) : viOpts.map((v) => ({ value: v.id, label: v.title }));
        clear(settings.firstChild,
            h('div.btn-group', ['event', 'visit'].map((k) => h('button', { type: 'button', class: st.subjectType === k ? 'on' : '', on: { click: () => { st.subjectType = k; st.subjectId = String((k === 'event' ? evOpts[0] : viOpts[0])?.id || ''); persist(); drawSettings(); refresh(); } } }, opt('subject', k)))),
            h('select.select', { 'aria-label': opt('subject', st.subjectType), on: { change: (e) => { st.subjectId = e.target.value; persist(); refresh(); } } }, opts.length ? opts.map((o) => h('option', { value: o.value, selected: String(o.value) === String(st.subjectId) }, o.label)) : h('option', { value: '' }, t('ci.no_subjects'))),
            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } },
                h('div.btn-group', ['auto', 'in', 'out'].map((k) => h('button', { type: 'button', class: st.direction === k ? 'on' : '', on: { click: () => { st.direction = k; persist(); drawSettings(); } } }, t(`ci.dir_${k}`)))),
                h('input.input', { value: st.gate, placeholder: t('f.gate'), 'aria-label': t('f.gate'), on: { change: (e) => { st.gate = e.target.value; persist(); } } })),
            h('label.check', h('input', { type: 'checkbox', checked: st.autoPrint, on: { change: (e) => { st.autoPrint = e.target.checked; persist(); } } }), t('ci.auto_print')));
    }
    root.append(pageHead(t('nav.checkin'), t('ci.subtitle')), offlineBar,
        h('div.grid', { style: { gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,1fr)', alignItems: 'start' } },
            h('div', { style: { display: 'grid', gap: '16px' } }, settings,
                h('div.card', h('div.card-h', h('h2', icon('scan'), ' ', t('ci.scan')), h('button.btn.sm', { type: 'button', id: 'cam-btn', on: { click: toggleCam } }, icon('camera'), t('ci.camera_on'))),
                    h('div.card-b', { style: { display: 'grid', gap: '12px' } }, cam, codeInput, h('div.small.muted', t('ci.scanner_hint')))),
                h('div.card', h('div.card-h', h('h2', icon('search'), ' ', t('ci.manual'))), h('div.card-b', search, searchRes))),
            h('div', { style: { display: 'grid', gap: '16px' } }, result, statsBox,
                h('div.card', h('div.card-h', h('h2', t('ci.recent')), h('span.dot.ok.pulse')), feed))));
    drawSettings();
    showIdle();
    setTimeout(() => codeInput.focus({ preventScroll: true }), 100);

    function showIdle() { clear(result, h('div.card', { style: { padding: '28px', textAlign: 'center', borderStyle: 'dashed' } }, h('div', { style: { fontSize: '40px', color: 'var(--faint)' } }, icon('qr')), h('h3', t('ci.ready')), h('div.muted', t('ci.ready_hint')))); }
    function showResult(r, { offline = false } = {}) {
        const ok = r.ok;
        beep(ok);
        const color = ok ? (r.direction === 'out' ? 'var(--warn)' : 'var(--ok)') : 'var(--bad)';
        const v = r.visitor;
        clear(result, h('div.card', { style: { borderInlineStart: `6px solid ${color}`, background: `color-mix(in srgb, ${color} 8%, var(--surface))`, padding: '20px', display: 'grid', gap: '12px' } },
            h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } },
                h('div', { style: { width: '54px', height: '54px', borderRadius: '50%', background: color, color: '#fff', display: 'grid', placeItems: 'center', flex: 'none' } }, icon(ok ? (r.direction === 'out' ? 'log-out' : 'check') : 'x')),
                h('div', h('div', { style: { fontSize: '20px', fontWeight: 700, color } }, ok ? t(`scan.${r.code}`) : t(`scan.${r.code}`)), offline ? h('span.badge.warn', t('ci.offline_saved')) : null, r.ms != null ? h('div.small.faint', `${r.ms} ms`) : null)),
            v ? h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, avatar(pick(v, 'name'), v.has_photo ? `/api/v1/visitors/${v.id}/photo` : null),
                h('div', { style: { flex: 1 } }, h('div', { style: { fontSize: '18px', fontWeight: 600 } }, pick(v, 'name')), h('div.muted', [v.org_name, opt('category', v.category)].filter(Boolean).join(' · '))),
                ok && r.direction === 'in' && !offline ? h('button.btn', { type: 'button', on: { click: () => print(v.id) } }, icon('printer'), t('ci.print')) : null) : null,
            r.stats ? h('div.small.muted', t('ci.inside_now', { n: fmtNum(r.stats.inside) })) : null,
            !ok && r.code === 'capacity_full' && can('checkin', 'create') ? h('button.btn.sm.danger', { type: 'button', on: { click: () => scan({ visitor_id: v.id, force: true }) } }, t('ci.force')) : null));
        if (ok && r.direction === 'in' && st.autoPrint && v && !offline) print(v.id);
        clearTimeout(showResult.tm);
        showResult.tm = setTimeout(showIdle, 12000);
    }
    async function print(visitorId) {
        try {
            const r = await post('print', { visitor_id: visitorId, subject_type: st.subjectType, subject_id: Number(st.subjectId), lang: document.documentElement.lang });
            if (r.via === 'agent') toast(t('ci.sent_to_printer'), 'ok');
            else await printSvg(r.svg, r.width_mm, r.height_mm);
        } catch (e) { toast(errText(e), 'bad'); }
    }
    async function scan(body) {
        if (!st.subjectId) return toast(t('ci.pick_subject'), 'warn');
        if (st.busy) return;
        st.busy = true;
        try {
            const r = await post('attendance/scan', { subject_type: st.subjectType, subject_id: Number(st.subjectId), direction: st.direction, gate: st.gate || undefined, ...body });
            showResult(r);
            st.offline = false; drawOffline();
        } catch (e) {
            if (e instanceof TypeError || e.status >= 500 || !navigator.onLine) await offlineScan(body);
            else toast(errText(e), 'bad');
        } finally { st.busy = false; codeInput.focus({ preventScroll: true }); }
    }
    function handleToken(raw) {
        let token = raw.trim();
        const m = token.match(/\/m\/p\/(TZ1\.[^/?#\s]+)/);
        if (m) token = decodeURIComponent(m[1]);
        scan({ token });
    }

    /* ───── الوضع الاحتياطي دون اتصال ───── */
    const packKey = () => `tz_pack_${st.subjectType}_${st.subjectId}`;
    async function downloadPack() {
        try {
            const p = await api('attendance/offline-pack', { query: { subject_type: st.subjectType, subject_id: st.subjectId } });
            store.set(packKey(), p);
            toast(t('ci.pack_saved', { n: fmtNum(p.entries.length) }), 'ok');
            drawOffline();
        } catch (e) { toast(errText(e), 'bad'); }
    }
    async function offlineScan(body) {
        st.offline = true;
        const pack = store.get(packKey(), null);
        if (!pack || !body.token) { drawOffline(); return showResult({ ok: false, code: pack ? 'offline_manual' : 'offline_no_pack' }); }
        const fp = await fingerprint(body.token);
        const e = pack.entries.find((x) => x.f === fp);
        if (!e) { drawOffline(); return showResult({ ok: false, code: 'invalid_qr' }, { offline: true }); }
        if (e.b) return showResult({ ok: false, code: 'blocked', visitor: { name_ar: e.n, name_en: e.ne, org_name: e.o, category: e.c } }, { offline: true });
        let dir = st.direction === 'auto' ? (e.i ? 'out' : 'in') : st.direction;
        if (dir === 'in' && e.i) return showResult({ ok: false, code: 'already_inside', visitor: { name_ar: e.n, name_en: e.ne, org_name: e.o, category: e.c } }, { offline: true });
        e.i = dir === 'in' ? 1 : 0;
        store.set(packKey(), pack);
        const q = store.get('tz_offline_queue', []);
        q.push({ id: Date.now() + Math.random(), token: body.token, subject_type: st.subjectType, subject_id: Number(st.subjectId), direction: dir, gate: st.gate || null, at: new Date().toISOString() });
        store.set('tz_offline_queue', q);
        drawOffline();
        showResult({ ok: true, code: dir === 'in' ? 'checked_in' : 'checked_out', direction: dir, visitor: { name_ar: e.n, name_en: e.ne, org_name: e.o, category: e.c } }, { offline: true });
    }
    async function sync() {
        const q = store.get('tz_offline_queue', []);
        if (!q.length) return;
        try {
            const r = await post('attendance/sync', { items: q });
            store.set('tz_offline_queue', []);
            const bad = r.results.filter((x) => !x.ok).length;
            toast(t('ci.synced', { n: fmtNum(r.results.length), bad: fmtNum(bad) }), bad ? 'warn' : 'ok');
            st.offline = false;
            drawOffline(); refresh();
        } catch { /* لا يزال دون اتصال */ }
    }
    function drawOffline() {
        const q = store.get('tz_offline_queue', []);
        const pack = st.subjectId ? store.get(packKey(), null) : null;
        clear(offlineBar, h(`div.hint-box${st.offline ? '.warn' : ''}`, { style: { marginBottom: '16px', alignItems: 'center' } }, icon(st.offline ? 'wifi-off' : 'wifi'),
            h('div', { style: { flex: 1 } }, st.offline ? t('ci.offline_mode') : t('ci.online_mode'), pack ? h('span.small', ` — ${t('ci.pack_info', { n: fmtNum(pack.entries.length) })}`) : h('span.small', ` — ${t('ci.no_pack')}`), q.length ? h('b', ` — ${t('ci.queue', { n: fmtNum(q.length) })}`) : null),
            h('button.btn.sm', { type: 'button', on: { click: downloadPack } }, icon('download'), t('ci.download_pack')),
            q.length ? h('button.btn.sm.primary', { type: 'button', on: { click: sync } }, icon('refresh'), t('ci.sync')) : null));
    }
    const onOnline = () => { st.offline = false; sync(); drawOffline(); };
    const onOffline = () => { st.offline = true; drawOffline(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    async function doSearch() {
        const q = search.value.trim();
        if (q.length < 2 || !st.subjectId) return searchRes.replaceChildren();
        try {
            const r = await api('attendance/search', { query: { q, subject_type: st.subjectType, subject_id: st.subjectId } });
            searchRes.replaceChildren(...(r.rows.length ? r.rows.map((v) => h('div.list-item', { style: { padding: '10px 0' } }, avatar(pick(v, 'name')),
                h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 500 } }, pick(v, 'name')), h('div.small.muted', [v.org_name, v.phone, v.national_id_last4 ? `••${v.national_id_last4}` : null].filter(Boolean).join(' · '))),
                v.blocked ? h('span.badge.bad', t('visitors.blocked')) : v.inside ? h('button.btn.sm', { type: 'button', on: { click: () => scan({ visitor_id: v.id, direction: 'out', method: 'manual' }).then(doSearch) } }, icon('log-out'), t('common.out'))
                    : h('button.btn.sm.primary', { type: 'button', on: { click: () => scan({ visitor_id: v.id, direction: 'in', method: 'manual' }).then(doSearch) } }, icon('log-in'), t('common.in')))) : [h('div.small.muted', { style: { padding: '10px 0' } }, t('ci.not_found'))]));
        } catch (e) { searchRes.replaceChildren(h('div.small', errText(e))); }
    }
    async function toggleCam() {
        const btn = root.querySelector('#cam-btn');
        if (st.stopCam) { st.stopCam(); st.stopCam = null; clear(cam, h('div.muted', icon('camera'), ' ', t('ci.camera_off'))); btn.lastChild.textContent = t('ci.camera_on'); return; }
        try { st.stopCam = await startScanner(cam, (code) => handleToken(code)); btn.lastChild.textContent = t('ci.camera_stop'); } catch (e) { toast(t('ci.camera_error'), 'bad'); void e; }
    }
    async function refresh() {
        drawOffline();
        if (!st.subjectId) return;
        try {
            const [s, logs] = await Promise.all([api('attendance/stats', { query: { subject_type: st.subjectType, subject_id: st.subjectId } }), api('attendance/logs', { query: { subject_type: st.subjectType, subject_id: st.subjectId, size: 25 } })]);
            drawStats(s);
            feed.replaceChildren(...(logs.rows.length ? logs.rows.map(feedItem) : [empty(t('dash.no_activity'))]));
        } catch { /* دون اتصال */ }
        ws.sub(`${st.subjectType}:${st.subjectId}`);
    }
    const drawStats = (s) => statsBox.replaceChildren(...[['users', s.inside, t('common.inside')], ['log-in', s.entries, t('common.entries')], ['log-out', s.exits, t('common.exits')]].map(([ic, v, l]) => h('div.card.kpi', h('div.kpi-ico', icon(ic)), h('div', h('div.kpi-v', fmtNum(v)), h('div.kpi-l', l)))));
    const feedItem = (l) => h('div.feed-item', h(`div.dir.${l.direction}`, icon(l.direction === 'in' ? 'log-in' : 'log-out')), h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 500 } }, pick(l.visitor || l, 'name')), h('div.small.muted', [l.gate, opt('method', l.method)].filter(Boolean).join(' · '))), h('span.small.faint', fmtTime(l.at)));
    const off = ws.on('attendance', (a) => {
        if (String(a.subject.id) !== String(st.subjectId) || a.subject.type !== st.subjectType) return;
        feed.querySelector('.state')?.remove();
        feed.prepend(feedItem(a));
        drawStats(a.stats);
    });
    refresh();
    if (navigator.onLine) sync();
    return () => { off(); st.stopCam?.(); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); clearTimeout(showResult.tm); };
    void badge;
}
