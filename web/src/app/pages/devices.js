// تنظيم — الأجهزة: تسجيل وربط الأكشاك والطابعات والماسحات برمز ربط، الحالة اللحظية، الإصدار، التحديث وإعادة التشغيل عن بعد، وسجل الأعطال.
import { h, icon } from '../../core/dom.js';
import { t, fmtAgo, fmtDateTime, opt, fmtNum, pick } from '../../core/i18n.js';
import { api, post, del } from '../../core/api.js';
import { badge, dialog, drawer, toast, errText, confirm, copy, mount, empty, popover } from '../../core/ui.js';
import { dataTable } from '../components/table.js';
import { editResource } from '../components/form.js';
import { pageHead } from '../main.js';
import { DEVICE_KINDS, DEVICE_STATUSES } from '../../../../shared/resources.js';

const KIND_ICON = { kiosk: 'monitor', printer: 'printer', scanner: 'scan', checkin: 'id-card', gate: 'log-in' };

export default async function devices({ root, can, ws }) {
    const counts = h('div.kpis');
    const loadCounts = async () => {
        const r = await api('devices/overview');
        counts.replaceChildren(...['online', 'offline', 'paper_low', 'error', 'pending'].map((s) => h('div.card.kpi', h('div.kpi-ico', icon(s === 'online' ? 'wifi' : s === 'offline' ? 'wifi-off' : s === 'paper_low' ? 'printer' : s === 'error' ? 'alert' : 'key')), h('div', h('div.kpi-v', fmtNum(r.counts[s] || 0)), h('div.kpi-l', opt('device_status', s))))));
    };
    const tbl = dataTable({
        resource: 'devices', exportResource: can('devices', 'export') ? 'devices' : null,
        filters: [{ key: 'f_kind', label: t('f.kind'), options: DEVICE_KINDS.map((k) => ({ value: k, label: opt('device_kind', k) })) }, { key: 'f_status', label: t('f.status'), options: DEVICE_STATUSES.map((k) => ({ value: k, label: opt('device_status', k) })) }],
        columns: [
            { key: 'name', label: t('f.name'), sort: true, render: (r) => h('div.cell-person', h('div.kpi-ico', { style: { width: '36px', height: '36px' } }, icon(KIND_ICON[r.kind])), h('div', h('div.cell-main', r.name), h('div.cell-sub', [r.location, r.gate].filter(Boolean).join(' · ')))) },
            { key: 'kind', label: t('f.kind'), render: (r) => h('span.chip', opt('device_kind', r.kind)) },
            { key: 'status', label: t('f.status'), sort: true, render: (r) => h('div', badge('device_status', r.status), r.online ? h('div.cell-sub', { style: { color: 'var(--ok)' } }, t('devices.connected')) : null) },
            { key: 'last_seen', label: t('devices.last_seen'), render: (r) => h('span.small', r.last_seen ? fmtAgo(r.last_seen) : '—') },
            { key: 'version', label: t('f.version'), render: (r) => h('span.mono.small', r.version || '—') },
            { key: 'event_id', label: t('nav.events'), render: (r) => h('span.small', r.event_id__label || '—') },
            { key: 'pair_code', label: t('devices.pair_code'), render: (r) => (r.pair_code ? h('button.btn.xs', { type: 'button', on: { click: () => copy(r.pair_code) } }, h('b.mono', { style: { letterSpacing: '2px' } }, r.pair_code), icon('copy')) : '—') },
        ],
        rowClick: (r) => details(r),
        actions: (r) => can('devices', 'update') ? [h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.more'), on: { click: (e) => popover(e.currentTarget, [
            ...['reload', 'restart', 'update', 'identify', 'sync'].map((c) => h('button', { type: 'button', on: { click: () => command(r, c) } }, icon({ reload: 'refresh', restart: 'power', update: 'download', identify: 'eye', sync: 'refresh' }[c]), t(`devices.cmd_${c}`))),
            h('hr'),
            h('button', { type: 'button', on: { click: async () => { if (await editResource('devices', await api(`devices/${r.id}`))) tbl.reload(); } } }, icon('edit'), t('common.edit')),
            h('button', { type: 'button', on: { click: () => newCode(r) } }, icon('key'), t('devices.new_code')),
            can('devices', 'delete') ? h('button', { type: 'button', on: { click: async () => { if (await confirm(t('common.delete_confirm'), { danger: true })) { await del(`devices/${r.id}`); tbl.reload(); loadCounts(); } } } }, icon('trash'), t('common.delete')) : null,
        ]) } }, icon('more'))] : null,
        emptyTitle: t('devices.empty'),
    });
    root.append(pageHead(t('nav.devices'), t('devices.subtitle'), [can('devices', 'create') ? h('button.btn.primary', { type: 'button', on: { click: async () => { const r = await editResource('devices'); if (r) { tbl.reload(); loadCounts(); showCode(r.name, r.pair_code); } } } }, icon('plus'), t('devices.new')) : null]), counts, tbl.el,
        h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h2', icon('printer'), ' ', t('devices.agent_title'))), h('div.card-b', h('p.muted', { style: { marginTop: 0 } }, t('devices.agent_hint')), h('pre.mono', { style: { background: 'var(--surface-2)', padding: '12px', borderRadius: '10px', fontSize: '12px', overflow: 'auto' } }, `node tools/print-agent/agent.mjs --server ${location.origin} --code <${t('devices.pair_code')}> --printer tcp://192.168.1.50:9100`))));
    await loadCounts();
    async function command(r, cmd) { try { const x = await post(`devices/${r.id}/command`, { cmd }); toast(x.delivered ? t('devices.cmd_sent') : t('devices.cmd_offline'), x.delivered ? 'ok' : 'warn'); } catch (e) { toast(errText(e), 'bad'); } }
    async function newCode(r) { if (!(await confirm(t('devices.new_code_confirm')))) return; const x = await post(`devices/${r.id}/pair-code`); showCode(r.name, x.pair_code); tbl.reload(); loadCounts(); }
    function showCode(name, code) {
        if (!code) return;
        dialog({ title: t('devices.pair_title', { name }), size: 'narrow', body: h('div', { style: { textAlign: 'center' } }, h('p.muted', t('devices.pair_hint')), h('div.mono', { style: { fontSize: '40px', fontWeight: 700, letterSpacing: '8px', margin: '14px 0' } }, code), h('div.small.faint', t('devices.pair_valid')), h('button.btn.sm', { type: 'button', style: { marginTop: '12px' }, on: { click: () => copy(code) } }, icon('copy'), t('common.copy'))) });
    }
    function details(r) {
        const b = h('div');
        drawer({ title: r.name, subtitle: opt('device_kind', r.kind), body: b });
        mount(b, () => api(`devices/${r.id}/faults`), (f) => h('div', { style: { display: 'grid', gap: '16px' } },
            h('dl.kv', h('dt', t('f.status')), h('dd', badge('device_status', r.status)), h('dt', t('f.location')), h('dd', r.location || '—'), h('dt', t('f.version')), h('dd.mono', r.version || '—'), h('dt', t('devices.last_seen')), h('dd', r.last_seen ? fmtDateTime(r.last_seen) : '—'), h('dt', t('nav.events')), h('dd', r.event_id__label || '—')),
            h('div', h('h3', { style: { marginBottom: '8px' } }, t('devices.faults')), f.rows.length ? h('div.list', f.rows.map((x) => h('div.list-item', h('span.dot.bad'), h('div', { style: { flex: 1 } }, h('div', t(`devices.fault_${x.code}`) === `devices.fault_${x.code}` ? x.code : t(`devices.fault_${x.code}`)), x.message ? h('div.small.muted', x.message) : null), h('span.small.faint', fmtDateTime(x.at.replace(' ', 'T') + 'Z'))))) : empty(t('devices.no_faults'))),
            f.jobs.length ? h('div', h('h3', { style: { marginBottom: '8px' } }, t('devices.jobs')), h('table.tbl', h('tbody', f.jobs.map((j) => h('tr', h('td', `#${j.id}`), h('td', j.format), h('td', h('span.badge', { class: `badge ${j.status === 'printed' ? 'ok' : j.status === 'failed' ? 'bad' : 'info'}` }, t(`devices.job_${j.status}`))), h('td.small', j.error || '')))))) : null));
    }
    const off = ws.on('device', () => { tbl.reload(); loadCounts(); });
    return () => off();
    void pick;
}
