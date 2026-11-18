// تنظيم — الحضور الجماعي: تسجيل دخول أو خروج مجموعة كاملة بعملية واحدة، مع استثناء أفراد منها.
import { h, icon, clear } from '../../core/dom.js';
import { t, pick, opt, fmtNum } from '../../core/i18n.js';
import { api, post } from '../../core/api.js';
import { toast, errText, empty, loading, badge, confirm } from '../../core/ui.js';
import { pageHead } from '../main.js';

export default async function bulk({ root, query }) {
    const st = { subjectType: 'event', subjectId: '', groupId: query.group_id || '', direction: 'in', gate: '', exclude: new Set(), members: [] };
    const [events, visits, groups] = await Promise.all([api('events', { query: { size: 200, sort: 'starts_at', dir: 'desc', f_archived: 0 } }), api('visits', { query: { size: 200, sort: 'starts_at', dir: 'desc' } }).catch(() => ({ rows: [] })), api('groups', { query: { size: 500 } })]);
    const usable = events.rows.filter((e) => ['published', 'running'].includes(e.status));
    if (!st.subjectId && usable[0]) st.subjectId = String(usable[0].id);
    const form = h('div.card', h('div.card-b'));
    const list = h('div.card', { style: { marginTop: '16px' } });
    const result = h('div');
    root.append(pageHead(t('nav.bulk'), t('bulk.subtitle')), form, list, result);
    function drawForm() {
        const subjOpts = st.subjectType === 'event' ? usable.map((e) => ({ value: e.id, label: pick(e, 'title') })) : visits.rows.filter((v) => ['approved', 'permit_issued', 'checked_in'].includes(v.status)).map((v) => ({ value: v.id, label: v.title }));
        clear(form.firstChild, h('div.form-grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' } },
            h('div.field', h('label', t('bulk.subject_type')), h('div.btn-group', ['event', 'visit'].map((k) => h('button', { type: 'button', class: st.subjectType === k ? 'on' : '', on: { click: () => { st.subjectType = k; st.subjectId = ''; drawForm(); loadMembers(); } } }, opt('subject', k))))),
            h('div.field', h('label', opt('subject', st.subjectType)), h('select.select', { on: { change: (e) => { st.subjectId = e.target.value; loadMembers(); } } }, h('option', { value: '' }, '—'), subjOpts.map((o) => h('option', { value: o.value, selected: String(o.value) === String(st.subjectId) }, o.label)))),
            h('div.field', h('label', t('nav.groups')), h('select.select', { on: { change: (e) => { st.groupId = e.target.value; st.exclude.clear(); loadMembers(); } } }, h('option', { value: '' }, '—'), groups.rows.map((g) => h('option', { value: g.id, selected: String(g.id) === String(st.groupId) }, `${g.name} (${g.members})`)))),
            h('div.field', h('label', t('bulk.direction')), h('div.btn-group', ['in', 'out'].map((k) => h('button', { type: 'button', class: st.direction === k ? 'on' : '', on: { click: () => { st.direction = k; drawForm(); drawList(); } } }, icon(k === 'in' ? 'log-in' : 'log-out'), ' ', t(`common.${k}`))))),
            h('div.field', h('label', t('f.gate')), h('input.input', { value: st.gate, on: { input: (e) => { st.gate = e.target.value; } } }))));
    }
    async function loadMembers() {
        if (!st.groupId) { st.members = []; return drawList(); }
        clear(list, loading());
        const r = await api(`groups/${st.groupId}/members`, { query: { subject_type: st.subjectType, subject_id: st.subjectId || undefined } });
        st.members = r.rows;
        drawList();
    }
    function drawList() {
        if (!st.groupId) return clear(list, empty(t('bulk.pick_group')));
        const eligible = st.members.filter((m) => !m.blocked && (st.direction === 'in' ? !m.inside : m.inside));
        const n = eligible.filter((m) => !st.exclude.has(m.id)).length;
        clear(list, h('div.card-h', h('h2', t('bulk.members', { n: fmtNum(st.members.length) })), h('div.actions',
            h('button.btn.sm.ghost', { type: 'button', on: { click: () => { st.exclude.clear(); drawList(); } } }, t('bulk.include_all')),
            h('button.btn.sm.ghost', { type: 'button', on: { click: () => { st.members.forEach((m) => st.exclude.add(m.id)); drawList(); } } }, t('bulk.exclude_all')),
            h('button.btn.primary', { type: 'button', disabled: !n || !st.subjectId, on: { click: run } }, icon(st.direction === 'in' ? 'log-in' : 'log-out'), t(st.direction === 'in' ? 'bulk.checkin_n' : 'bulk.checkout_n', { n: fmtNum(n) })))),
        h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th.cb', t('bulk.include')), h('th', t('f.name_ar')), h('th', t('f.org_name')), h('th', t('f.status')))),
            h('tbody', st.members.map((m) => {
                const ok = !m.blocked && (st.direction === 'in' ? !m.inside : m.inside);
                return h(`tr${!ok ? '' : st.exclude.has(m.id) ? '' : '.selected'}`, h('td.cb', h('input', { type: 'checkbox', disabled: !ok, checked: ok && !st.exclude.has(m.id), 'aria-label': pick(m, 'name'), on: { change: (e) => { e.target.checked ? st.exclude.delete(m.id) : st.exclude.add(m.id); drawList(); } } })),
                    h('td', pick(m, 'name')), h('td.muted', m.org_name || '—'), h('td', m.blocked ? h('span.badge.bad', t('visitors.blocked')) : m.inside ? badge('presence', 'inside') : h('span.faint', t('bulk.not_inside'))));
            })))));
    }
    async function run() {
        const ids = st.members.filter((m) => !m.blocked && (st.direction === 'in' ? !m.inside : m.inside) && !st.exclude.has(m.id)).map((m) => m.id);
        const n = ids.length;
        if (!(await confirm(t('bulk.confirm', { n: fmtNum(n), d: t(`common.${st.direction}`) })))) return;
        try {
            const r = await post('attendance/bulk', { subject_type: st.subjectType, subject_id: Number(st.subjectId), group_id: Number(st.groupId), visitor_ids: ids, exclude: [...st.exclude], direction: st.direction, gate: st.gate || undefined });
            toast(t('bulk.done', { ok: fmtNum(r.ok), total: fmtNum(r.total) }), r.ok === r.total ? 'ok' : 'warn', 6000);
            const bad = r.results.filter((x) => !x.ok);
            clear(result, bad.length ? h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h2', t('bulk.skipped', { n: fmtNum(bad.length) }))), h('div.list', bad.map((x) => h('div.list-item', h('span', { style: { flex: 1 } }, x.name || `#${x.visitor_id}`), h('span.badge.warn', t(`scan.${x.code}`)))))) : null);
            loadMembers();
        } catch (e) { toast(errText(e), 'bad'); }
    }
    drawForm();
    loadMembers();
}
