// تنظيم — الإشعارات: كل التنبيهات مصنفة حسب الحالة والأولوية (ازدحام، جهاز منقطع، ورق منخفض، زائر محظور، فشل تكامل) مع إجراءات سريعة.
import { h, icon } from '../../core/dom.js';
import { t, fmtAgo, fmtDateTime, opt, fmtNum, pick } from '../../core/i18n.js';
import { api, post } from '../../core/api.js';
import { badge, toast, errText, dialog } from '../../core/ui.js';
import { dataTable } from '../components/table.js';
import { pageHead } from '../main.js';
import { NOTIF_PRIORITIES, NOTIF_STATUSES } from '../../../../shared/resources.js';

const TYPES = ['zone_crowded', 'event_crowded', 'capacity_full', 'device_offline', 'device_error', 'printer_paper_low', 'print_failed', 'blocked_visitor', 'integration_failed', 'account_locked', 'offline_conflict', 'report_failed', 'announcement'];
const ICONS = { zone_crowded: 'users', event_crowded: 'users', capacity_full: 'alert', device_offline: 'wifi-off', device_error: 'cpu', printer_paper_low: 'printer', print_failed: 'printer', blocked_visitor: 'ban', integration_failed: 'link', account_locked: 'lock', offline_conflict: 'refresh', report_failed: 'file-text', announcement: 'message' };
const LINK = { devices: '/app/devices', integrations: '/app/integrations', visitors: (id) => `/app/visitors/${id}`, events: (id) => `/app/events/${id}/live`, zones: null, users: '/app/users' };

export default async function notifications({ root, can, ws }) {
    const counts = h('div.kpis');
    const tbl = dataTable({
        fetch: (p) => api('notifications', { query: { ...p, status: p.f_status, priority: p.f_priority, type: p.f_type } }),
        initialFilters: { f_status: 'new' },
        search: false,
        onData: (r) => counts.replaceChildren(...NOTIF_PRIORITIES.slice().reverse().map((p) => h('div.card.kpi', h('div.kpi-ico', { style: { background: `var(--${{ critical: 'bad', high: 'warn', medium: 'info', low: 'neutral' }[p]}-bg)`, color: `var(--${{ critical: 'bad', high: 'warn', medium: 'info', low: 'muted' }[p]})` } }, icon('bell')), h('div', h('div.kpi-v', fmtNum(r.counts[p] || 0)), h('div.kpi-l', `${opt('priority', p)} — ${t('notif.unresolved')}`))))),
        filters: [
            { key: 'f_status', label: t('f.status'), options: NOTIF_STATUSES.map((s) => ({ value: s, label: opt('notif_status', s) })) },
            { key: 'f_priority', label: t('f.priority'), options: NOTIF_PRIORITIES.map((s) => ({ value: s, label: opt('priority', s) })) },
            { key: 'f_type', label: t('f.type'), options: TYPES.map((s) => ({ value: s, label: t(`notif.${s}.title`) })) },
        ],
        toolbar: can('notifications', 'update') ? h('button.btn.sm', { type: 'button', on: { click: async () => { await post('notifications/all/ack'); tbl.reload(); } } }, icon('check'), t('notif.ack_all')) : null,
        columns: [
            { key: 'type', label: t('notif.alert'), render: (n) => h('div.cell-person', h('div.kpi-ico', { style: { width: '34px', height: '34px', background: `var(--${{ critical: 'bad', high: 'warn', medium: 'info', low: 'neutral' }[n.priority]}-bg)`, color: `var(--${{ critical: 'bad', high: 'warn', medium: 'info', low: 'muted' }[n.priority]})` } }, icon(ICONS[n.type] || 'bell')),
                h('div', h('div.cell-main', t(`notif.${n.type}.title`)), h('div.cell-sub', t(`notif.${n.type}.body`, n.params)))) },
            { key: 'priority', label: t('f.priority'), render: (n) => badge('priority', n.priority) },
            { key: 'status', label: t('f.status'), render: (n) => badge('notif_status', n.status) },
            { key: 'created_at', label: t('notif.when'), render: (n) => h('span.small', { title: fmtDateTime(n.created_at) }, fmtAgo(n.created_at)) },
        ],
        actions: (n) => {
            const link = typeof LINK[n.entity] === 'function' ? (n.entity_id ? LINK[n.entity](n.entity_id) : null) : LINK[n.entity];
            return [
                link ? h('a.btn.xs', { href: link }, icon('external'), t('notif.open')) : null,
                can('notifications', 'update') && n.status === 'new' ? h('button.btn.xs', { type: 'button', on: { click: () => act(n.id, 'ack') } }, t('notif.ack')) : null,
                can('notifications', 'update') && n.status !== 'resolved' ? h('button.btn.xs.primary', { type: 'button', on: { click: () => act(n.id, 'resolve') } }, icon('check'), t('notif.resolve')) : null,
                can('notifications', 'update') && n.status === 'resolved' ? h('button.btn.xs', { type: 'button', on: { click: () => act(n.id, 'reopen') } }, t('notif.reopen')) : null,
            ];
        },
        emptyTitle: t('notif.none'),
    });
    async function act(id, a) { try { await post(`notifications/${id}/${a}`); tbl.reload(); } catch (e) { toast(errText(e), 'bad'); } }
    root.append(pageHead(t('nav.notifications'), t('notif.subtitle'), can('notifications', 'create') ? [h('button.btn', { type: 'button', on: { click: announce } }, icon('message'), t('notif.announce'))] : null), counts, tbl.el);
    const off = ws.on('notification', () => tbl.reload());
    const off2 = ws.on('notification_update', () => tbl.reload());
    async function announce() {
        const evs = await api('events', { query: { size: 200, sort: 'starts_at', dir: 'desc' } });
        const ev = h('select.select', evs.rows.filter((e) => ['published', 'running'].includes(e.status)).map((e) => h('option', { value: e.id }, pick(e, 'title'))));
        const msg = h('textarea.textarea', { rows: 4 });
        const pr = h('select.select', NOTIF_PRIORITIES.map((p) => h('option', { value: p, selected: p === 'medium' }, opt('priority', p))));
        dialog({ title: t('notif.announce'), body: h('div', { style: { display: 'grid', gap: '12px' } }, h('div.hint-box', icon('info'), t('notif.announce_hint')), h('div.field', h('label', t('nav.events')), ev), h('div.field', h('label', t('f.priority')), pr), h('div.field', h('label', t('notif.message')), msg)), footer: [
            { label: t('common.cancel'), value: null },
            { label: t('common.send'), kind: 'primary', icon: 'send', onClick: async (close) => { try { await post('notifications/announce', { event_id: Number(ev.value), message: msg.value, priority: pr.value }); toast(t('notif.announced'), 'ok'); close(true); } catch (e) { toast(errText(e), 'bad'); } } }] });
    }
    return () => { off(); off2(); };
}
