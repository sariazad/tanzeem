// تنظيم — المجموعات: تجميع الزوار (وفد، دفعة طلاب، جهة) لإرسال الدعوات وتسجيل الحضور جماعياً.
import { h, icon, clear, debounce } from '../../core/dom.js';
import { t, pick, opt, fmtNum } from '../../core/i18n.js';
import { api, post, del } from '../../core/api.js';
import { dialog, drawer, toast, errText, confirm, empty, mount, avatar } from '../../core/ui.js';
import { dataTable } from '../components/table.js';
import { editResource } from '../components/form.js';
import { pageHead } from '../main.js';
import { messageDialog } from './visitors.js';

export default async function groups({ root, params, can }) {
    const tbl = dataTable({
        resource: 'groups', exportResource: can('groups', 'export') ? 'groups' : null,
        filters: [{ key: 'f_kind', label: t('f.kind'), options: ['delegation', 'cohort', 'org', 'other'].map((k) => ({ value: k, label: opt('group_kind', k) })) }],
        columns: [
            { key: 'name', label: t('f.name'), sort: true, render: (r) => h('div', h('div.cell-main', r.name), r.notes ? h('div.cell-sub', r.notes.slice(0, 80)) : null) },
            { key: 'kind', label: t('f.kind'), render: (r) => h('span.chip', opt('group_kind', r.kind)) },
            { key: 'org_id', label: t('f.org_id'), render: (r) => r.org_id__label || '—' },
            { key: 'members', label: t('groups.members'), render: (r) => h('b.num', fmtNum(r.members)) },
        ],
        rowClick: (r) => open(r),
        emptyTitle: t('groups.empty'),
        emptyAction: can('groups', 'create') ? h('button.btn.primary', { type: 'button', on: { click: () => create() } }, icon('plus'), t('groups.new')) : null,
    });
    const create = async () => { const r = await editResource('groups'); if (r) { tbl.reload(); open(r); } };
    root.append(pageHead(t('nav.groups'), t('groups.subtitle'), [can('groups', 'create') ? h('button.btn.primary', { type: 'button', on: { click: create } }, icon('plus'), t('groups.new')) : null]), tbl.el);

    function open(g) {
        const b = h('div');
        const dr = drawer({ title: g.name, subtitle: opt('group_kind', g.kind), body: b, actions: [
            can('groups', 'update') ? h('button.btn.sm', { type: 'button', on: { click: async () => { const r = await editResource('groups', g); if (r) { Object.assign(g, r); tbl.reload(); } } } }, icon('edit')) : null,
            can('groups', 'delete') ? h('button.btn.sm.danger', { type: 'button', on: { click: async () => { if (await confirm(t('common.delete_confirm'), { danger: true })) { await del(`groups/${g.id}`); dr.close(); tbl.reload(); } } } }, icon('trash')) : null] });
        const load = () => mount(b, () => api(`groups/${g.id}/members`), (m) => h('div', { style: { display: 'grid', gap: '14px' } },
            h('div.actions',
                can('groups', 'update') ? h('button.btn.sm.primary', { type: 'button', on: { click: () => addMembers(g.id).then((ok) => { if (ok) { load(); tbl.reload(); } }) } }, icon('plus'), t('groups.add_members')) : null,
                can('bulk', 'create') ? h('a.btn.sm', { href: `/app/bulk?group_id=${g.id}` }, icon('user-check'), t('nav.bulk')) : null,
                can('visitors', 'update') && m.rows.length ? h('button.btn.sm', { type: 'button', on: { click: () => messageDialog(m.rows.map((x) => x.id)) } }, icon('message'), t('visitors.message')) : null),
            m.rows.length ? h('div.list', { style: { border: '1px solid var(--border)', borderRadius: '10px' } }, m.rows.map((v) => h('div.list-item', avatar(pick(v, 'name')),
                h('div', { style: { flex: 1, minWidth: 0 } }, h('a.cell-main', { href: `/app/visitors/${v.id}` }, pick(v, 'name')), h('div.cell-sub', [v.org_name, opt('category', v.category)].filter(Boolean).join(' · '))),
                v.blocked ? h('span.badge.bad', t('visitors.blocked')) : null,
                can('groups', 'update') ? h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.remove'), on: { click: async () => { await post(`groups/${g.id}/members`, { remove: [v.id] }); load(); tbl.reload(); } } }, icon('x')) : null)))
                : empty(t('groups.no_members'))));
        load();
    }
    if (params[0]) api(`groups/${params[0]}`).then(open).catch(() => {});
}

function addMembers(groupId) {
    const sel = new Map();
    const res = h('div', { style: { maxHeight: '300px', overflow: 'auto', marginTop: '8px' } });
    const count = h('div.small.muted', { style: { marginTop: '8px' } });
    const q = h('input.input', { type: 'search', autofocus: true, placeholder: t('inv.search_visitors'), on: { input: debounce(async (e) => {
        if (e.target.value.trim().length < 2) return res.replaceChildren();
        const r = await api('visitors', { query: { q: e.target.value.trim(), size: 30 } });
        res.replaceChildren(...r.rows.map((v) => h('label.check', { style: { display: 'flex', padding: '6px 4px', borderBottom: '1px solid var(--border)' } }, h('input', { type: 'checkbox', checked: sel.has(v.id), on: { change: (ev) => { ev.target.checked ? sel.set(v.id, v) : sel.delete(v.id); count.textContent = t('common.selected_n', { n: fmtNum(sel.size) }); } } }), h('span', pick(v, 'name'), h('span.small.muted', ` — ${v.org_name || ''}`)))));
    }) } });
    return dialog({ title: t('groups.add_members'), body: h('div', q, res, count), footer: [{ label: t('common.cancel'), value: false }, { label: t('common.add'), kind: 'primary', onClick: async (close) => { try { await post(`groups/${groupId}/members`, { add: [...sel.keys()] }); toast(t('common.saved'), 'ok'); close(true); } catch (e) { toast(errText(e), 'bad'); } } }] });
}
void clear;
