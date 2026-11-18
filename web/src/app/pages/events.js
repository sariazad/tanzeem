// تنظيم — قائمة الفعاليات: الحالة ونسبة الحضور بشريط تقدم، فلاتر، تصدير.
import { h, icon } from '../../core/dom.js';
import { t, fmtNum, fmtDate, fmtTime, pick, opt } from '../../core/i18n.js';
import { badge, progress } from '../../core/ui.js';
import { dataTable } from '../components/table.js';
import { pageHead } from '../main.js';
import { EVENT_STATUSES, EVENT_TYPES } from '../../../../shared/resources.js';
import { refOptions } from '../components/form.js';

export default async function events({ root, can, navigate }) {
    const orgs = await refOptions('orgs').catch(() => []);
    const tbl = dataTable({
        resource: 'events', exportResource: can('events', 'export') ? 'events' : null, sort: 'starts_at', dir: 'desc',
        initialFilters: { f_archived: '0' },
        filters: [
            { key: 'f_status', label: t('f.status'), options: EVENT_STATUSES.map((s) => ({ value: s, label: opt('status', s) })) },
            { key: 'f_type', label: t('f.type'), options: EVENT_TYPES.map((s) => ({ value: s, label: opt('event_type', s) })) },
            { key: 'f_org_id', label: t('f.org_id'), options: orgs },
            { key: 'f_archived', label: t('events.archive'), options: [{ value: '0', label: t('events.active_only') }, { value: '1', label: t('events.archived_only') }] },
        ],
        columns: [
            { key: 'title_ar', label: t('f.title'), sort: true, render: (r) => h('div', h('div.cell-main', pick(r, 'title')), h('div.cell-sub', [r.org_id__label, r.location].filter(Boolean).join(' · '))) },
            { key: 'type', label: t('f.type'), render: (r) => h('span.chip', opt('event_type', r.type)) },
            { key: 'starts_at', label: t('f.starts_at'), sort: true, render: (r) => h('div', h('div', fmtDate(r.starts_at)), h('div.cell-sub', fmtTime(r.starts_at))) },
            { key: 'status', label: t('f.status'), sort: true, render: (r) => badge('status', r.status) },
            { key: 'registered', label: t('events.reg_att'), render: (r) => h('div.num', `${fmtNum(r.attended)} / ${fmtNum(r.registered)}`, h('div.cell-sub', t('events.invited_n', { n: fmtNum(r.invited) }))) },
            { key: 'attendance_rate', label: t('events.rate'), width: '160px', render: (r) => h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, progress(r.attendance_rate, { warnAt: 101, badAt: 1000 }), h('span.small.num', `${fmtNum(r.attendance_rate)}%`)) },
            { key: 'capacity', label: t('f.capacity'), sort: true, render: (r) => (r.capacity ? h('div.num', `${fmtNum(r.inside)} / ${fmtNum(r.capacity)}`, h('div.cell-sub', t('common.inside'))) : '—') },
        ],
        rowClick: (r) => navigate(`/app/events/${r.id}`),
        actions: (r) => [h('a.btn.xs.ghost', { href: `/app/events/${r.id}/live`, title: t('event.tabs.live') }, icon('activity'))],
        emptyTitle: t('events.empty'), emptyAction: can('events', 'create') ? h('a.btn.primary', { href: '/app/events/new' }, icon('plus'), t('events.new')) : null,
    });
    root.append(pageHead(t('nav.events'), t('events.subtitle'), [can('events', 'create') ? h('a.btn.primary', { href: '/app/events/new' }, icon('plus'), t('events.new')) : null]), tbl.el);
}
