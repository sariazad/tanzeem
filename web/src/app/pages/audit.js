// تنظيم — سجل التدقيق: كل عملية بتوقيتها والمنفذ وIP والقيم قبل وبعد. للقراءة فقط وغير قابل للحذف (سلسلة تجزئة مع تحقق).
import { h, icon } from '../../core/dom.js';
import { t, fmtDateTime, fmtNum } from '../../core/i18n.js';
import { api, downloadFrom } from '../../core/api.js';
import { dialog, toast, errText } from '../../core/ui.js';
import { dataTable } from '../components/table.js';
import { pageHead } from '../main.js';

export default async function audit({ root, can }) {
    const meta = await api('audit', { query: { size: 1 } });
    const verifyBox = h('div');
    const tbl = dataTable({
        fetch: (p) => api('audit', { query: { ...p, action: p.f_action, entity: p.f_entity } }),
        searchPlaceholder: t('audit.search'),
        filters: [
            { key: 'f_action', label: t('audit.action'), options: meta.actions.map((a) => ({ value: a, label: t(`audit.a_${a}`) === `audit.a_${a}` ? a : t(`audit.a_${a}`) })) },
            { key: 'from', label: t('common.from'), type: 'date' }, { key: 'to', label: t('common.to'), type: 'date' },
        ],
        onExport: can('audit', 'export') ? (format, p) => downloadFrom('/api/v1/audit/export', { ...p, action: p.f_action, format }) : null,
        printable: false,
        columns: [
            { key: 'at', label: t('audit.when'), render: (r) => h('span.small.num', fmtDateTime(r.at)) },
            { key: 'actor', label: t('audit.actor'), render: (r) => h('div', h('div.cell-main', r.actor || '—'), r.user_id ? h('div.cell-sub', `#${r.user_id}`) : null) },
            { key: 'action', label: t('audit.action'), render: (r) => h('span.mono.small', r.action) },
            { key: 'entity', label: t('audit.entity'), render: (r) => (r.entity ? h('span.small', `${r.entity}${r.entity_id ? ' #' + r.entity_id : ''}`) : '—') },
            { key: 'ip', label: 'IP', render: (r) => h('span.mono.small', r.ip || '—') },
        ],
        rowClick: (r) => details(r),
        actions: (r) => (r.before || r.after ? [h('button.btn.xs.ghost', { type: 'button', on: { click: () => details(r) } }, icon('eye'), t('audit.changes'))] : []),
    });
    root.append(pageHead(t('nav.audit'), t('audit.subtitle'), [h('button.btn', { type: 'button', on: { click: verify } }, icon('shield'), t('audit.verify'))]),
        h('div.hint-box', { style: { marginBottom: '16px' } }, icon('lock'), t('audit.immutable', { n: fmtNum(meta.total) })), verifyBox, tbl.el);
    async function verify() {
        try {
            const r = await api('audit/verify');
            verifyBox.replaceChildren(h(`div.hint-box.${r.ok ? 'ok' : 'bad'}`, { style: { marginBottom: '16px' } }, icon(r.ok ? 'check-circle' : 'alert'), r.ok ? t('audit.chain_ok', { n: fmtNum(r.checked) }) : t('audit.chain_broken', { id: r.brokenAt })));
        } catch (e) { toast(errText(e), 'bad'); }
    }
    function details(r) {
        const parse = (s) => { try { return JSON.parse(s || 'null'); } catch { return null; } };
        const b = parse(r.before) || {}, a = parse(r.after) || {};
        const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
        const show = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
        dialog({ title: `${r.action}`, size: 'wide', body: h('div',
            h('dl.kv', { style: { marginBottom: '14px' } }, h('dt', t('audit.when')), h('dd', fmtDateTime(r.at)), h('dt', t('audit.actor')), h('dd', r.actor || '—'), h('dt', 'IP'), h('dd.mono', r.ip || '—'), h('dt', t('audit.entity')), h('dd', `${r.entity || '—'} ${r.entity_id ? '#' + r.entity_id : ''}`), h('dt', 'hash'), h('dd.mono.small', { style: { wordBreak: 'break-all' } }, r.hash)),
            keys.length ? h('table.tbl', h('thead', h('tr', h('th', t('audit.field')), h('th', t('audit.before')), h('th', t('audit.after')))), h('tbody', keys.map((k) => h('tr', h('td.mono.small', k), h('td.small', { style: { color: 'var(--bad)', wordBreak: 'break-word' } }, show(b[k])), h('td.small', { style: { color: 'var(--ok)', wordBreak: 'break-word' } }, show(a[k])))))) : h('div.muted', t('audit.no_changes'))) });
    }
}
