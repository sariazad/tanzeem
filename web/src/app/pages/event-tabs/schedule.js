// تنظيم — جدول الفعالية: الجلسات حسب الأيام والمسارات، بحث وفلترة، وإبراز الجلسات المميزة.
import { h, icon, clear } from '../../../core/dom.js';
import { t, fmtTime, fmtDate, pick, fmtNum } from '../../../core/i18n.js';
import { api, del } from '../../../core/api.js';
import { confirm, empty, mount, toast } from '../../../core/ui.js';
import { editResource, invalidateRef } from '../../components/form.js';
import { dataTable } from '../../components/table.js';
import { dialog } from '../../../core/ui.js';

export default async function schedule({ root, eventId, event, can }) {
    const canEdit = can('events', 'update');
    const st = { day: null, track: '', hall: '', q: '', featured: false };
    const body = h('div');
    root.append(h('div.page-head', h('div', h('h2', t('event.tabs.schedule')), h('p', t('sched.subtitle'))), canEdit ? h('div.actions',
        h('button.btn', { type: 'button', on: { click: speakersDialog } }, icon('users'), t('sched.speakers')),
        h('button.btn.primary', { type: 'button', on: { click: async () => { if (await editResource('event_sessions', null, { defaults: { event_id: eventId, day: st.day || 1, starts_at: event.starts_at, ends_at: event.starts_at } })) load(); } } }, icon('plus'), t('sched.add'))) : null), body);
    let data = null;
    const load = () => mount(body, () => api(`events/${eventId}/schedule`), (d) => { data = d; return render(); });
    function render() {
        const sp = new Map(data.speakers.map((s) => [s.id, s]));
        const days = [...new Set(data.sessions.map((s) => s.day))].sort((a, b) => a - b);
        if (!days.length) return empty(t('sched.empty'), t('sched.empty_hint'));
        if (!days.includes(st.day)) st.day = days[0];
        const tracks = [...new Set(data.sessions.map((s) => s.track).filter(Boolean))];
        const halls = [...new Set(data.sessions.map((s) => s.hall).filter(Boolean))];
        const q = st.q.toLowerCase();
        const list = data.sessions.filter((s) => s.day === st.day && (!st.track || s.track === st.track) && (!st.hall || s.hall === st.hall) && (!st.featured || s.featured)
            && (!q || `${s.title_ar} ${s.title_en || ''} ${s.speaker_ids.map((i) => sp.get(i)?.name_ar || '').join(' ')}`.toLowerCase().includes(q)));
        const wrap = h('div');
        const rerender = () => clear(body, render());
        wrap.append(
            h('div.tabs', days.map((d) => h('button', { type: 'button', class: d === st.day ? 'active' : '', on: { click: () => { st.day = d; rerender(); } } }, t('sched.day_n', { n: fmtNum(d) }), h('span.small.faint', ` · ${fmtDate(new Date(new Date(event.starts_at).getTime() + (d - 1) * 86400_000))}`)))),
            h('div.card', h('div.toolbar',
                h('input.input.grow', { type: 'search', value: st.q, placeholder: t('sched.search'), 'aria-label': t('common.search'), on: { input: (e) => { st.q = e.target.value; const pos = e.target.selectionStart; rerender(); const i = body.querySelector('input[type=search]'); i.focus(); i.setSelectionRange(pos, pos); } } }),
                h('select.select', { 'aria-label': t('f.track'), on: { change: (e) => { st.track = e.target.value; rerender(); } } }, h('option', { value: '' }, `${t('f.track')}: ${t('common.all')}`), tracks.map((x) => h('option', { value: x, selected: x === st.track }, x))),
                h('select.select', { 'aria-label': t('f.hall'), on: { change: (e) => { st.hall = e.target.value; rerender(); } } }, h('option', { value: '' }, `${t('f.hall')}: ${t('common.all')}`), halls.map((x) => h('option', { value: x, selected: x === st.hall }, x))),
                h('label.check', h('input', { type: 'checkbox', checked: st.featured, on: { change: (e) => { st.featured = e.target.checked; rerender(); } } }), t('sched.featured_only'))),
            h('div', list.length ? list.map((s) => h('div', { style: { display: 'flex', gap: '16px', padding: '14px 18px', borderBottom: '1px solid var(--border)', background: s.featured ? 'color-mix(in srgb, var(--accent) 7%, transparent)' : '', borderInlineStart: s.featured ? '4px solid var(--accent)' : '4px solid transparent' } },
                h('div', { style: { width: '92px', flex: 'none' } }, h('div', { style: { fontWeight: 700 } }, fmtTime(s.starts_at)), h('div.small.muted', fmtTime(s.ends_at))),
                h('div', { style: { flex: 1, minWidth: 0 } },
                    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, s.featured ? h('span.badge.warn.plain', icon('star'), t('sched.featured')) : null, h('b', pick(s, 'title'))),
                    h('div.small.muted', { style: { marginTop: '4px', display: 'flex', gap: '14px', flexWrap: 'wrap' } }, s.hall ? h('span', icon('map-pin'), ' ', s.hall) : null, s.track ? h('span', icon('layers'), ' ', s.track) : null),
                    s.speaker_ids.length ? h('div.actions', { style: { marginTop: '8px' } }, s.speaker_ids.map((i) => sp.get(i)).filter(Boolean).map((x) => h('span.chip', icon('user'), ` ${pick(x, 'name')}${x.title ? ' — ' + x.title : ''}`))) : null),
                canEdit ? h('div.actions', h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.edit'), on: { click: async () => { if (await editResource('event_sessions', await api(`event_sessions/${s.id}`))) load(); } } }, icon('edit')),
                    h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.delete'), on: { click: async () => { if (await confirm(t('common.delete_confirm'), { danger: true })) { await del(`event_sessions/${s.id}`); load(); } } } }, icon('trash'))) : null))
                : [empty(t('common.no_results'))])));
        return wrap;
    }
    async function speakersDialog() {
        const tbl = dataTable({ resource: 'speakers', columns: [{ key: 'name_ar', label: t('f.name_ar'), sort: true, render: (r) => pick(r, 'name') }, { key: 'title', label: t('f.title') }, { key: 'org_name', label: t('f.org_name') }],
            actions: (r) => [h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.edit'), on: { click: async () => { if (await editResource('speakers', r)) { tbl.reload(); invalidateRef('speakers'); } } } }, icon('edit'))],
            toolbar: h('button.btn.sm.primary', { type: 'button', on: { click: async () => { if (await editResource('speakers')) { tbl.reload(); invalidateRef('speakers'); } } } }, icon('plus'), t('common.add')) });
        await dialog({ title: t('sched.speakers'), size: 'wide', body: tbl.el });
        load();
    }
    load();
    void toast;
}
