// تنظيم — الزوار: سجل موحد بالحالة (مؤكد / دخل / خرج)، ملف الزائر وسجله الكامل، التواصل المباشر، الاستيراد، وقائمة الحظر.
import { h, icon, clear } from '../../core/dom.js';
import { t, fmtDate, fmtDateTime, pick, opt, fmtNum, fmtAgo } from '../../core/i18n.js';
import { api, post, del } from '../../core/api.js';
import { badge, dialog, drawer, toast, errText, confirm, empty, mount, avatar } from '../../core/ui.js';
import { dataTable } from '../components/table.js';
import { editResource } from '../components/form.js';
import { pageHead } from '../main.js';
import { VISITOR_CATEGORIES } from '../../../../shared/resources.js';
import { parseSheet } from './event-tabs/invitations.js';

export default async function visitors({ root, params, can }) {
    const st = { tab: 'all' };
    const tabs = h('div.tabs');
    const body = h('div');
    root.append(pageHead(t('nav.visitors'), t('visitors.subtitle'), [
        can('visitors', 'create') ? h('button.btn', { type: 'button', on: { click: importDialog } }, icon('upload'), t('common.import')) : null,
        can('visitors', 'create') ? h('button.btn.primary', { type: 'button', on: { click: async () => { if (await editResource('visitors', null, { size: 'wide' })) tbl.reload(); } } }, icon('plus'), t('visitors.new')) : null]), tabs, body);
    let tbl;
    function draw() {
        tabs.replaceChildren(...['all', 'blocked'].map((k) => h('button', { type: 'button', class: st.tab === k ? 'active' : '', on: { click: () => { st.tab = k; draw(); } } }, icon(k === 'all' ? 'users' : 'ban'), t(`visitors.tab_${k}`))));
        tbl = dataTable({
            resource: 'visitors', exportResource: can('visitors', 'export') ? 'visitors' : null, sort: 'id', dir: 'desc',
            initialFilters: st.tab === 'blocked' ? { f_blocked: '1' } : {},
            filters: [{ key: 'f_category', label: t('f.category'), options: VISITOR_CATEGORIES.map((c) => ({ value: c, label: opt('category', c) })) }],
            searchPlaceholder: t('visitors.search'),
            selectable: can('visitors', 'update'),
            bulkActions: (ids, done) => [h('button.btn.sm', { type: 'button', on: { click: async () => { if (await messageDialog(ids)) done(); } } }, icon('message'), t('visitors.message'))],
            columns: [
                { key: 'name_ar', label: t('f.name_ar'), sort: true, render: (r) => h('div.cell-person', avatar(pick(r, 'name'), r.photo && r.photo !== '__omitted__' ? r.photo : r.photo === '__omitted__' ? `/api/v1/visitors/${r.id}/photo` : null), h('div', h('div.cell-main', pick(r, 'name')), h('div.cell-sub', r.org_name || ''))) },
                { key: 'category', label: t('f.category'), sort: true, render: (r) => h('span.chip', opt('category', r.category)) },
                { key: 'phone', label: t('f.phone'), render: (r) => h('span.mono.small', r.phone || '—') },
                { key: 'presence', label: t('f.status'), render: (r) => (r.blocked ? h('span.badge.bad', t('visitors.blocked')) : badge('presence', r.presence)) },
                st.tab === 'blocked' ? { key: 'block_reason', label: t('f.block_reason') } : { key: 'last_seen', label: t('visitors.last_seen'), render: (r) => h('span.small.muted', r.last_seen ? fmtAgo(r.last_seen) : '—') },
            ],
            rowClick: (r) => profile(r.id, () => tbl.reload()),
            emptyTitle: st.tab === 'blocked' ? t('visitors.no_blocked') : t('visitors.empty'),
        });
        clear(body, tbl.el);
    }
    async function importDialog() {
        let rows = [];
        const info = h('div.small.muted');
        const groupSel = h('select.select', h('option', { value: '' }, t('visitors.import_no_group')));
        api('groups', { query: { size: 500 } }).then((g) => g.rows.forEach((x) => groupSel.append(h('option', { value: x.id }, x.name))));
        await dialog({ title: t('visitors.import'), body: h('div', { style: { display: 'grid', gap: '12px' } }, h('div.hint-box', icon('info'), t('inv.excel_hint')),
            h('input', { type: 'file', accept: '.xlsx,.xls,.csv', on: { change: async (e) => { rows = await parseSheet(e.target.files[0]); info.textContent = t('inv.rows_loaded', { n: fmtNum(rows.length) }); } } }), info,
            h('div.field', h('label', t('visitors.import_group')), groupSel)), footer: [
            { label: t('common.cancel'), value: null },
            { label: t('common.import'), kind: 'primary', onClick: async (close) => {
                if (!rows.length) return toast(t('visitors.import_empty'), 'warn');
                try {
                    const r = await post('visitors/import', { rows, group_id: groupSel.value || undefined });
                    toast(t('visitors.imported', { ok: fmtNum(r.ok), bad: fmtNum(r.errors.length) }), r.errors.length ? 'warn' : 'ok', 6000);
                    close(r); tbl.reload();
                } catch (e) { toast(errText(e), 'bad'); }
            } }] });
    }
    draw();
    if (params[0]) profile(Number(params[0]), () => tbl.reload());

    function profile(id, onChange) {
        const b = h('div');
        const dr = drawer({ title: t('visitors.profile'), body: b });
        const load = () => mount(b, () => api(`visitors/${id}/profile`), (v) => {
            const photo = v.photo ? v.photo : null;
            return h('div', { style: { display: 'grid', gap: '18px' } },
                h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } }, h('div', { style: { width: '72px', height: '72px', borderRadius: '14px', overflow: 'hidden', background: 'var(--neutral-bg)', flex: 'none', display: 'grid', placeItems: 'center' } }, photo ? h('img', { src: photo, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover' } }) : avatar(v.name_ar)),
                    h('div', h('h3', v.name_ar), v.name_en ? h('div.muted', { dir: 'ltr' }, v.name_en) : null, h('div.actions', { style: { marginTop: '6px' } }, h('span.chip', opt('category', v.category)), v.blocked ? h('span.badge.bad', t('visitors.blocked')) : null))),
                v.blocked ? h('div.hint-box.bad', icon('ban'), h('div', h('b', t('visitors.blocked')), v.block_reason ? h('div', v.block_reason) : null)) : null,
                h('div.actions',
                    can('visitors', 'update') ? h('button.btn.sm', { type: 'button', on: { click: async () => { if (await editResource('visitors', await api(`visitors/${id}`), { size: 'wide' })) { load(); onChange(); } } } }, icon('edit'), t('common.edit')) : null,
                    can('visitors', 'update') ? h('button.btn.sm', { type: 'button', on: { click: () => messageDialog([id]) } }, icon('message'), t('visitors.message')) : null,
                    can('visitors', 'update') ? h(`button.btn.sm${v.blocked ? '' : '.danger'}`, { type: 'button', on: { click: () => block(v).then((ok) => ok && (load(), onChange())) } }, icon(v.blocked ? 'unlock' : 'ban'), v.blocked ? t('visitors.unblock') : t('visitors.block')) : null,
                    can('visitors', 'delete') ? h('button.btn.sm.ghost.danger', { type: 'button', on: { click: async () => { if (await confirm(t('visitors.delete_confirm'), { danger: true })) { await del(`visitors/${id}`); dr.close(); onChange(); } } } }, icon('trash')) : null),
                h('dl.kv', h('dt', t('f.org_name')), h('dd', v.org_name || '—'), h('dt', t('f.job_title')), h('dd', v.job_title || '—'), h('dt', t('f.phone')), h('dd.mono', v.phone || '—'), h('dt', t('f.email')), h('dd.mono', v.email || '—'),
                    h('dt', t('f.national_id')), h('dd', v.national_id_last4 ? h('span', h('span.mono', `••••••${v.national_id_last4}`), can('visitors', 'update') ? h('button.btn.xs.ghost', { type: 'button', style: { marginInlineStart: '8px' }, on: { click: async (e) => { const r = await api(`visitors/${id}/national-id`); e.target.closest('dd').replaceChildren(h('span.mono', r.national_id || '—')); } } }, icon('eye'), t('visitors.reveal')) : null) : '—'),
                    h('dt', t('f.interests')), h('dd', v.interests ? h('div.actions', v.interests.split(',').map((x) => h('span.chip', x))) : '—'),
                    h('dt', t('nav.groups')), h('dd', v.groups.length ? v.groups.map((g) => h('a', { href: `/app/groups/${g.id}`, style: { marginInlineEnd: '8px' } }, g.name)) : '—'),
                    h('dt', t('visitors.since')), h('dd', fmtDate(v.created_at.replace(' ', 'T') + 'Z'))),
                h('div', h('h3', { style: { marginBottom: '8px' } }, t('visitors.events_history')), v.events.length ? h('table.tbl', h('thead', h('tr', h('th', t('f.title')), h('th', t('inv.status')), h('th', t('visitors.in_out')))),
                    h('tbody', v.events.map((e) => h('tr', h('td', h('a', { href: `/app/events/${e.id}` }, pick(e, 'title')), h('div.cell-sub', fmtDate(e.starts_at))), h('td', e.inv_status ? badge('invitation_status', e.inv_status) : h('span.chip', opt('source', e.source))),
                        h('td.small', e.first_in ? `${fmtDateTime(e.first_in)}${e.last_out ? ' ← ' + fmtDateTime(e.last_out) : ''}` : '—'))))) : empty(t('visitors.no_events'))),
                v.visits.length ? h('div', h('h3', { style: { marginBottom: '8px' } }, t('nav.visits')), h('div.list', v.visits.map((x) => h('a.list-item', { href: `/app/visits/${x.id}` }, h('span', { style: { flex: 1 } }, x.title), h('span.small.muted', fmtDate(x.starts_at)), badge('visit_status', x.status))))) : null,
                h('div', h('h3', { style: { marginBottom: '8px' } }, t('visitors.log')), v.logs.length ? h('div', v.logs.slice(0, 30).map((l) => h('div.feed-item', { style: { padding: '7px 0' } }, h(`div.dir.${l.direction}`, icon(l.direction === 'in' ? 'log-in' : 'log-out')), h('div', { style: { flex: 1 } }, `${opt('subject', l.subject_type)} #${l.subject_id}`, h('div.cell-sub', [l.gate, opt('method', l.method)].filter(Boolean).join(' · '))), h('span.small.faint', fmtDateTime(l.at))))) : empty(t('dash.no_activity'))));
        });
        load();
    }
    async function block(v) {
        if (v.blocked) { await post(`visitors/${v.id}/block`, { blocked: false }); toast(t('common.saved'), 'ok'); return true; }
        const reason = h('textarea.textarea', { placeholder: t('f.block_reason') });
        const ok = await dialog({ title: t('visitors.block'), size: 'narrow', body: h('div', h('p.muted', t('visitors.block_hint')), reason), footer: [{ label: t('common.cancel'), value: false }, { label: t('visitors.block'), kind: 'danger solid', value: true }] });
        if (!ok) return false;
        await post(`visitors/${v.id}/block`, { blocked: true, reason: reason.value });
        toast(t('common.saved'), 'ok');
        return true;
    }
}

export async function messageDialog(ids) {
    const subject = h('input.input');
    const bodyEl = h('textarea.textarea', { rows: 5 });
    const ch = h('select.select', ['email', 'sms', 'both'].map((c) => h('option', { value: c }, opt('channel', c))));
    return dialog({ title: t('visitors.message_n', { n: fmtNum(ids.length) }), body: h('div', { style: { display: 'grid', gap: '12px' } }, h('div.field', h('label', t('f.channel')), ch), h('div.field', h('label', t('visitors.msg_subject')), subject), h('div.field', h('label', t('visitors.msg_body')), bodyEl)), footer: [
        { label: t('common.cancel'), value: false },
        { label: t('common.send'), kind: 'primary', icon: 'send', onClick: async (close) => {
            try { const r = await post('visitors/message', { ids, channel: ch.value, subject: subject.value, body: bodyEl.value }); toast(t('inv.sent_result', { ok: fmtNum(r.ok), failed: fmtNum(r.failed) }), r.failed ? 'warn' : 'ok'); close(true); } catch (e) { toast(errText(e), 'bad'); }
        } }] });
}
