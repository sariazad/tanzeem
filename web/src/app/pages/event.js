// تنظيم — صفحة الفعالية: نظرة عامة + الصفحات الفرعية الخمس (الدعوات، الجدول، تتبع الحضور المباشر، خريطة الفعالية، الشبكات الذكية).
import { h, icon, clear } from '../../core/dom.js';
import { t, fmtNum, fmtDate, fmtTime, pick, opt, fmtPct } from '../../core/i18n.js';
import { api, post } from '../../core/api.js';
import { badge, progress, confirm, toast, errText, copy, mount, popover, empty } from '../../core/ui.js';
import { editResource } from '../components/form.js';
import { pageHead } from '../main.js';
import { EVENT_TABS } from '../../../../shared/permissions.js';
import { donut } from '../../core/charts.js';

const TAB_ICONS = { overview: 'grid', invitations: 'mail', schedule: 'calendar', live: 'activity', map: 'map', networking: 'share' };
const NEXT = { draft: ['published', 'cancelled'], published: ['running', 'draft', 'cancelled'], running: ['ended', 'cancelled'], ended: ['running'], cancelled: ['draft'] };

export default async function eventPage(ctx) {
    const { root, params, can, navigate } = ctx;
    const id = Number(params[0]);
    const tab = params[1] && EVENT_TABS.includes(params[1]) ? params[1] : 'overview';
    let ev = await api(`events/${id}`);
    const canEdit = can('events', 'update');
    const head = h('div');
    const drawHead = () => clear(head, pageHead(pick(ev, 'title'), `${fmtDate(ev.starts_at, { weekday: true })} · ${fmtTime(ev.starts_at)} — ${fmtTime(ev.ends_at)}${ev.location ? ' · ' + ev.location : ''}`, [
        badge('status', ev.status),
        canEdit ? h('button.btn', { type: 'button', on: { click: async () => { const r = await editResource('events', await api(`events/${id}`), { exclude: ['status'] }); if (r) { ev = r; drawHead(); } } } }, icon('edit'), t('common.edit')) : null,
        canEdit ? h('button.btn', { type: 'button', on: { click: (e) => popover(e.currentTarget, [
            ...(NEXT[ev.status] || []).map((s) => h('button', { type: 'button', on: { click: () => setStatus(s) } }, icon(s === 'cancelled' ? 'ban' : s === 'published' ? 'send' : s === 'running' ? 'play' : s === 'ended' ? 'flag' : 'edit'), t(`events.to_${s}`))),
            h('hr'),
            ev.open_registration ? h('button', { type: 'button', on: { click: () => copy(`${location.origin}/m/r/${ev.id}`) } }, icon('link'), t('events.copy_reg_link')) : null,
            h('a', { href: `/app/reports/attendance?event_id=${ev.id}` }, icon('bar-chart'), t('events.report')),
            h('button', { type: 'button', on: { click: archive } }, icon('archive'), ev.archived ? t('events.unarchive') : t('events.archive_action')),
        ]) } }, icon('more'), t('common.more')) : null,
    ], [{ label: t('nav.events'), href: '/app/events' }, { label: pick(ev, 'title') }]));
    async function setStatus(s) {
        if (['cancelled', 'ended'].includes(s) && !(await confirm(t(`events.confirm_${s}`), { danger: s === 'cancelled' }))) return;
        try { ev = await post(`events/${id}/status`, { status: s }); drawHead(); toast(t('common.saved'), 'ok'); } catch (e) { toast(errText(e), 'bad'); }
    }
    async function archive() { await post(`events/${id}/archive`); ev = await api(`events/${id}`); drawHead(); toast(t('common.saved'), 'ok'); }
    drawHead();
    const tabs = h('nav.tabs', { 'aria-label': t('event.tabs_label') }, ['overview', ...EVENT_TABS].map((k) => h('a', { href: k === 'overview' ? `/app/events/${id}` : `/app/events/${id}/${k}`, class: k === tab ? 'active' : '', 'aria-current': k === tab ? 'page' : null }, icon(TAB_ICONS[k]), t(`event.tabs.${k}`))));
    const body = h('div');
    root.append(head, tabs, body);
    ctx.setTitle(`${pick(ev, 'title')} — ${t(`event.tabs.${tab}`)}`);
    if (tab === 'overview') return overview(body, id, ev, ctx);
    const mod = await import(`./event-tabs/${tab}.js`);
    return mod.default({ ...ctx, root: body, event: ev, eventId: id });
}

async function overview(body, id, ev, { ws, can }) {
    const load = () => mount(body, () => Promise.all([api(`events/${id}/summary`), api(`events/${id}/registrations`)]), ([s, regs]) => {
        const inv = s.invitations;
        const invTotal = Object.values(inv).reduce((a, b) => a + b, 0);
        const cap = ev.capacity || 0;
        const kpi = (ic, v, l, sub) => h('div.card.kpi', h('div.kpi-ico', icon(ic)), h('div', h('div.kpi-v', v), h('div.kpi-l', l), sub ? h('div.kpi-s', sub) : null));
        return h('div',
            h('div.kpis',
                kpi('mail', fmtNum(invTotal), t('event.invited'), t('event.confirmed_n', { n: fmtNum(inv.confirmed || 0) })),
                kpi('user-check', fmtNum(s.registered), t('event.registered')),
                kpi('log-in', fmtNum(s.unique), t('event.attended'), fmtPct(s.rate)),
                kpi('users', fmtNum(s.inside), t('common.inside'), cap ? t('event.of_capacity', { n: fmtNum(cap) }) : null),
                kpi('log-out', fmtNum(s.exits), t('common.exits'))),
            h('div.grid.g-main',
                h('div.card', h('div.card-h', h('h2', t('event.registrants')), h('span.small.muted', fmtNum(regs.rows.length))),
                    h('div.card-b.flush', regs.rows.length ? h('div.tbl-wrap', { style: { maxHeight: '440px', overflow: 'auto' } }, h('table.tbl', h('thead', h('tr', h('th', t('f.name_ar')), h('th', t('f.org_name')), h('th', t('f.source')), h('th', t('f.status')))),
                        h('tbody', regs.rows.slice(0, 300).map((r) => h('tr', h('td', h('a', { href: `/app/visitors/${r.visitor_id}` }, pick(r, 'name'))), h('td.muted', r.org_name || '—'), h('td', h('span.chip', opt('source', r.source))), h('td', r.inside ? badge('presence', 'inside') : r.status === 'cancelled' ? badge('invitation_status', 'cancelled') : badge('presence', 'confirmed'))))))) : empty(t('event.no_registrants')))),
                h('div', { style: { display: 'grid', gap: '16px', alignContent: 'start' } },
                    h('div.card', h('div.card-h', h('h2', t('event.invitations_status'))), h('div.card-b', invTotal ? donut(['confirmed', 'sent', 'pending', 'declined', 'failed', 'expired', 'cancelled'].filter((k) => inv[k]).map((k) => ({ label: opt('invitation_status', k), value: inv[k] })), { center: fmtNum(invTotal) }) : empty(t('event.no_invitations')))),
                    h('div.card', h('div.card-h', h('h2', t('event.details'))), h('div.card-b', h('dl.kv',
                        h('dt', t('f.type')), h('dd', opt('event_type', ev.type)), h('dt', t('f.org_id')), h('dd', ev.org_id__label || '—'),
                        h('dt', t('f.capacity')), h('dd', cap ? h('div', fmtNum(cap), progress((s.inside / cap) * 100)) : '—'),
                        h('dt', t('f.audience')), h('dd', ev.audience || '—'), h('dt', t('f.open_registration')), h('dd', ev.open_registration ? t('common.yes') : t('common.no')),
                        h('dt', t('event.devices')), h('dd', s.devices.length ? s.devices.map((d) => h('div', badge('device_status', d.status), ' ', d.name)) : '—')),
                    ev.description ? h('p.muted', { style: { marginTop: '12px', marginBottom: 0 } }, ev.description) : null)))));
    });
    await load();
    ws.sub(`event:${id}`);
    let tmr = null;
    const off = ws.on('attendance', (a) => { if (a.subject.id === id && a.subject.type === 'event') { clearTimeout(tmr); tmr = setTimeout(load, 1500); } });
    return () => { off(); ws.unsub(`event:${id}`); clearTimeout(tmr); };
}
