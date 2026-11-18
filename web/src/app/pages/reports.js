// تنظيم — التقارير: الحضور، أوقات الدخول والخروج، نسب المشاركة، الأداء، الزيارات، الزوار، الأجهزة.
// فلترة زمنية وحسب الفعالية والجهة، رسوم بيانية، تصدير PDF/Excel/CSV، ملخص ذكي، وجدولة الإرسال بالبريد.
import { h, icon, clear } from '../../core/dom.js';
import { t, fmtNum, fmtPct, fmtDateTime, pick, opt } from '../../core/i18n.js';
import { api, downloadFrom, del } from '../../core/api.js';
import { mount, empty, toast, errText, dialog, confirm } from '../../core/ui.js';
import { barChart, donut, lineChart, hbars } from '../../core/charts.js';
import { refOptions, editResource } from '../components/form.js';
import { dataTable } from '../components/table.js';
import { pageHead } from '../main.js';
import { REPORTS } from '../../../../shared/resources.js';

export default async function reports({ root, params, query, can, navigate }) {
    const report = REPORTS.includes(params[0]) ? params[0] : 'participation';
    const st = { from: query.from || '', to: query.to || '', event_id: query.event_id || '', org_id: query.org_id || '' };
    const [events, orgs] = await Promise.all([api('events', { query: { size: 300, sort: 'starts_at', dir: 'desc' } }), refOptions('orgs').catch(() => [])]);
    const body = h('div');
    const tabs = h('nav.tabs', REPORTS.map((r) => h('a', { href: `/app/reports/${r}`, class: r === report ? 'active' : '' }, t(`rep.${r}`))));
    const filters = h('div.card', { style: { marginBottom: '16px' } }, h('div.toolbar', { style: { borderBottom: 0 } },
        h('label.small.muted', t('common.from')), h('input.input', { type: 'date', value: st.from, on: { change: (e) => { st.from = e.target.value; load(); } } }),
        h('label.small.muted', t('common.to')), h('input.input', { type: 'date', value: st.to, on: { change: (e) => { st.to = e.target.value; load(); } } }),
        ['visits', 'visitors', 'devices'].includes(report) ? null : h('select.select', { 'aria-label': t('nav.events'), on: { change: (e) => { st.event_id = e.target.value; load(); } } }, h('option', { value: '' }, `${t('nav.events')}: ${t('common.all')}`), events.rows.map((e) => h('option', { value: e.id, selected: String(e.id) === String(st.event_id) }, pick(e, 'title')))),
        ['visitors', 'devices'].includes(report) ? null : h('select.select', { 'aria-label': t('f.org_id'), on: { change: (e) => { st.org_id = e.target.value; load(); } } }, h('option', { value: '' }, `${t('f.org_id')}: ${t('common.all')}`), orgs.map((o) => h('option', { value: o.value, selected: String(o.value) === String(st.org_id) }, o.label))),
        h('div.actions', { style: { marginInlineStart: 'auto' } },
            h('button.btn.sm', { type: 'button', on: { click: summary } }, icon('sparkles'), t('rep.summary')),
            can('reports', 'export') ? [
                h('button.btn.sm', { type: 'button', on: { click: () => exp('xlsx') } }, icon('download'), 'Excel'),
                h('button.btn.sm', { type: 'button', on: { click: () => exp('csv') } }, icon('download'), 'CSV'),
                h('button.btn.sm', { type: 'button', on: { click: () => window.print() } }, icon('printer'), 'PDF')] : null)));
    root.append(pageHead(t('nav.reports'), t('rep.subtitle'), can('reports', 'export') ? [h('button.btn', { type: 'button', on: { click: schedules } }, icon('clock'), t('rep.schedules'))] : null), tabs, filters, body);
    const q = () => Object.fromEntries(Object.entries(st).filter(([, v]) => v));
    let current = null;
    function load() {
        history.replaceState({}, '', `/app/reports/${report}?${new URLSearchParams(q())}`);
        return mount(body, () => api(`reports/${report}`, { query: q() }), (r) => { current = r; return render(r); });
    }
    async function exp(format) {
        try {
            const labels = Object.fromEntries((current?.columns || []).map((c) => [c.key, t(`rep.col.${c.key}`)]));
            await downloadFrom(`/api/v1/reports/${report}/export`, { ...q(), format, labels: JSON.stringify(labels), lang: document.documentElement.lang });
        } catch (e) { toast(errText(e), 'bad'); }
    }
    async function summary() {
        const box = h('div', t('common.loading'));
        dialog({ title: t('rep.summary'), body: box });
        try {
            const r = await api(`reports/${report}/summary`, { query: q() });
            box.replaceChildren(r.text ? h('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.9 } }, r.text) : h('div', h('div.hint-box', icon('info'), t('rep.builtin_summary')), h('dl.kv', { style: { marginTop: '12px' } }, Object.entries(r.builtin || {}).map(([k, v]) => [h('dt', t(`rep.col.${k}`)), h('dd', typeof v === 'number' ? fmtNum(v) : String(v))]))));
        } catch (e) { box.replaceChildren(h('div.hint-box.bad', errText(e))); }
    }
    function render(r) {
        const fmt = (c, v) => {
            if (v == null || v === '') return '—';
            switch (c.type) {
                case 'datetime': return fmtDateTime(v);
                case 'number': return fmtNum(v);
                case 'percent': return fmtPct(v);
                case 'bool': return v ? t('common.yes') : t('common.no');
                case 'category': return opt('category', v);
                case 'method': return opt('method', v);
                case 'event_type': return opt('event_type', v);
                case 'visit_status': return opt('visit_status', v);
                case 'device_kind': return opt('device_kind', v);
                case 'device_status': return opt('device_status', v);
                default: return String(v);
            }
        };
        const charts = [];
        if (r.charts.hourly) {
            const hrs = r.charts.hourly.filter((x) => x.in || x.out);
            const from = hrs.length ? r.charts.hourly.indexOf(hrs[0]) : 7, to = hrs.length ? r.charts.hourly.indexOf(hrs[hrs.length - 1]) : 20;
            const sl = r.charts.hourly.slice(Math.max(0, from - 1), Math.min(24, to + 2));
            charts.push(card(t('rep.hourly'), barChart({ labels: sl.map((x) => x.hour), series: [{ name: t('common.in'), values: sl.map((x) => x.in) }, { name: t('common.out'), values: sl.map((x) => x.out) }] })));
        }
        if (r.charts.funnel) {
            const f = r.charts.funnel;
            charts.push(card(t('rep.funnel'), hbars([{ label: t('rep.col.invited'), value: f.invited }, { label: t('rep.col.confirmed'), value: f.confirmed }, { label: t('rep.col.registered'), value: f.registered }, { label: t('rep.col.attended'), value: f.attended }])));
            charts.push(card(t('rep.rate_by_event'), barChart({ labels: r.rows.slice(0, 12).map((x) => x.event.slice(0, 14)), series: [{ name: t('rep.col.attendance_rate'), values: r.rows.slice(0, 12).map((x) => x.attendance_rate || 0) }] })));
        }
        if (r.charts.by_category) charts.push(card(t('rep.by_category'), donut(Object.entries(r.charts.by_category).map(([k, v]) => ({ label: opt('category', k), value: v })))));
        if (r.charts.by_method) charts.push(card(t('rep.by_method'), donut(Object.entries(r.charts.by_method).filter(([k]) => k !== 'null').map(([k, v]) => ({ label: opt('method', k), value: v })))));
        if (r.charts.by_status) charts.push(card(t('rep.by_status'), donut(Object.entries(r.charts.by_status).map(([k, v]) => ({ label: opt('visit_status', k), value: v })))));
        if (report === 'performance' && r.rows.length) charts.push(card(t('rep.methods_by_event'), barChart({ labels: r.rows.slice(0, 10).map((x) => x.event.slice(0, 12)), series: ['qr', 'kiosk', 'manual', 'bulk'].map((m) => ({ name: opt('method', m), values: r.rows.slice(0, 10).map((x) => x[m]) })) })));
        const sum = Object.entries(r.summary || {});
        return h('div',
            sum.length ? h('div.kpis', sum.map(([k, v]) => h('div.card.kpi', h('div', h('div.kpi-v', typeof v === 'number' ? (k.includes('rate') ? fmtPct(v) : fmtNum(v)) : String(v || '—')), h('div.kpi-l', t(`rep.col.${k}`)))))) : null,
            charts.length ? h('div.grid.g2', { style: { marginBottom: '16px' } }, charts) : null,
            h('div.card', h('div.card-h', h('h2', t(`rep.${report}`)), h('span.small.muted', t('common.rows_n', { n: fmtNum(r.rows.length) }))),
                r.rows.length ? h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', r.columns.map((c) => h('th', t(`rep.col.${c.key}`))))),
                    h('tbody', r.rows.slice(0, 1000).map((row) => h('tr', r.columns.map((c) => h('td', { class: ['number', 'percent'].includes(c.type) ? 'num' : '' }, fmt(c, row[c.key])))))))) : empty(t('rep.no_data'))),
            r.rows.length > 1000 ? h('div.small.muted', { style: { marginTop: '8px' } }, t('rep.truncated')) : null);
    }
    const card = (title, el) => h('div.card', h('div.card-h', h('h2', title)), h('div.card-b', el));

    async function schedules() {
        const tbl = dataTable({ resource: 'report_schedules', search: false,
            columns: [{ key: 'name', label: t('f.name') }, { key: 'report', label: t('f.report'), render: (r) => t(`rep.${r.report}`) }, { key: 'frequency', label: t('f.frequency'), render: (r) => `${opt('frequency', r.frequency)} · ${String(r.hour).padStart(2, '0')}:00` }, { key: 'recipients', label: t('f.recipients'), render: (r) => h('span.small.mono', r.recipients) }, { key: 'enabled', label: t('f.enabled'), render: (r) => (r.enabled ? h('span.badge.ok', t('common.on')) : h('span.badge', t('common.off'))) }],
            actions: (r) => [h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.edit'), on: { click: async () => { if (await editResource('report_schedules', r)) tbl.reload(); } } }, icon('edit')), h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.delete'), on: { click: async () => { if (await confirm(t('common.delete_confirm'), { danger: true })) { await del(`report_schedules/${r.id}`); tbl.reload(); } } } }, icon('trash'))],
            toolbar: h('button.btn.sm.primary', { type: 'button', on: { click: async () => { if (await editResource('report_schedules', null, { defaults: { report, frequency: 'daily', hour: 7, format: 'xlsx', enabled: 1, params: q() } })) tbl.reload(); } } }, icon('plus'), t('rep.add_schedule')) });
        dialog({ title: t('rep.schedules'), size: 'wide', body: h('div', h('div.hint-box', { style: { marginBottom: '12px' } }, icon('info'), t('rep.schedules_hint')), tbl.el) });
    }
    load();
    void lineChart; void navigate; void clear;
}
