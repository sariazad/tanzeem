// تنظيم — الزيارات الرسمية والوفود: دورة الاعتماد (طلب ← اعتماد ← إصدار تصريح ← دخول ← خروج)، المشاركون، وعرض التقويم.
import { h, icon, clear, debounce } from '../../core/dom.js';
import { t, fmtDate, fmtTime, fmtDateTime, pick, opt, fmtNum } from '../../core/i18n.js';
import { api, post } from '../../core/api.js';
import { badge, dialog, drawer, toast, errText, confirm, empty, mount, copy } from '../../core/ui.js';
import { dataTable } from '../components/table.js';
import { editResource, refOptions } from '../components/form.js';
import { pageHead } from '../main.js';
import { VISIT_STATUSES } from '../../../../shared/resources.js';

const FLOW = ['requested', 'approved', 'permit_issued', 'checked_in', 'checked_out'];

export default async function visits({ root, params, can, navigate, ws }) {
    const st = { view: 'list', month: new Date() };
    const body = h('div');
    const orgs = await refOptions('orgs').catch(() => []);
    const head = () => pageHead(t('nav.visits'), t('visits.subtitle'), [
        h('div.btn-group', ['list', 'calendar'].map((v) => h('button', { type: 'button', class: st.view === v ? 'on' : '', on: { click: () => { st.view = v; draw(); } } }, icon(v === 'list' ? 'list' : 'calendar'), ' ', t(`visits.view_${v}`)))),
        can('visits', 'create') ? h('button.btn.primary', { type: 'button', on: { click: async () => { const r = await editResource('visits'); if (r) { tbl?.reload(); open(r.id); } } } }, icon('plus'), t('visits.new')) : null]);
    let tbl = null;
    root.append(h('div', { id: 'visits-head' }), body);
    function draw() {
        clear(root.querySelector('#visits-head'), head());
        if (st.view === 'list') {
            tbl = dataTable({
                resource: 'visits', exportResource: can('visits', 'export') ? 'visits' : null, sort: 'starts_at', dir: 'desc',
                filters: [{ key: 'f_status', label: t('f.status'), options: VISIT_STATUSES.map((s) => ({ value: s, label: opt('visit_status', s) })) }, { key: 'f_org_id', label: t('f.org_id'), options: orgs }, { key: 'from', label: t('common.from'), type: 'date' }],
                columns: [
                    { key: 'title', label: t('f.title'), sort: true, render: (r) => h('div', h('div.cell-main', r.title), h('div.cell-sub', r.org_id__label || '')) },
                    { key: 'host_name', label: t('f.host_name'), sort: true },
                    { key: 'starts_at', label: t('f.starts_at'), sort: true, render: (r) => h('div', fmtDate(r.starts_at), h('div.cell-sub', `${fmtTime(r.starts_at)} — ${fmtTime(r.ends_at)}`)) },
                    { key: 'location', label: t('f.location') },
                    { key: 'participants', label: t('visits.participants'), render: (r) => fmtNum(r.participants) },
                    { key: 'status', label: t('f.status'), sort: true, render: (r) => badge('visit_status', r.status) },
                ],
                rowClick: (r) => open(r.id), emptyTitle: t('visits.empty'),
            });
            clear(body, tbl.el);
        } else calendar();
    }
    async function calendar() {
        const m = st.month;
        const first = new Date(m.getFullYear(), m.getMonth(), 1);
        const last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
        clear(body, h('div.card', h('div.card-b', t('common.loading'))));
        const r = await api('visits', { query: { from: new Date(first.getTime() - 7 * 864e5).toISOString(), to: new Date(last.getTime() + 8 * 864e5).toISOString(), size: 500 } });
        const start = new Date(first); start.setDate(first.getDate() - first.getDay());
        const cells = [];
        const today = new Date().toDateString();
        for (let i = 0; i < 42; i++) {
            const d = new Date(start); d.setDate(start.getDate() + i);
            const items = r.rows.filter((v) => new Date(v.starts_at).toDateString() === d.toDateString());
            cells.push(h('div', { class: `${d.getMonth() !== m.getMonth() ? 'out' : ''} ${d.toDateString() === today ? 'today' : ''}` }, h('div.small', { style: { fontWeight: 600 } }, String(d.getDate())),
                items.map((v) => h('span.ev', { title: v.title, style: { background: `var(--${{ requested: 'warn', rejected: 'bad', cancelled: 'bad', checked_in: 'ok' }[v.status] || 'info'}-bg)`, color: `var(--${{ requested: 'warn', rejected: 'bad', cancelled: 'bad', checked_in: 'ok' }[v.status] || 'info'})` }, on: { click: () => open(v.id) } }, `${fmtTime(v.starts_at)} ${v.title}`))));
        }
        const dows = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(document.documentElement.lang === 'ar' ? 'ar-SA' : 'en', { weekday: 'short' }).format(new Date(2024, 0, 7 + i)));
        clear(body, h('div.card', h('div.card-h',
            h('button.btn.sm.icon', { type: 'button', 'aria-label': t('common.prev'), on: { click: () => { st.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); calendar(); } } }, icon(document.dir === 'rtl' ? 'chevron-right' : 'chevron-left')),
            h('h2', new Intl.DateTimeFormat(document.documentElement.lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en', { month: 'long', year: 'numeric' }).format(m)),
            h('button.btn.sm.icon', { type: 'button', 'aria-label': t('common.next'), on: { click: () => { st.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); calendar(); } } }, icon(document.dir === 'rtl' ? 'chevron-left' : 'chevron-right'))),
        h('div.cal', dows.map((d) => h('div.dow', d)), cells)));
    }

    async function open(id) {
        const body2 = h('div');
        const dr = drawer({ title: t('visits.details'), body: body2 });
        const load = () => mount(body2, () => Promise.all([api(`visits/${id}`), api(`visits/${id}/visitors`)]), ([v, people]) => {
            const idx = FLOW.indexOf(v.status);
            const act = (action, label, kind, ic, extra) => h(`button.btn.sm${kind ? '.' + kind : ''}`, { type: 'button', on: { click: () => doAction(v, action, extra) } }, icon(ic), label);
            return h('div', { style: { display: 'grid', gap: '16px' } },
                h('div', h('h3', v.title), h('div.small.muted', `${fmtDate(v.starts_at, { weekday: true })} · ${fmtTime(v.starts_at)} — ${fmtTime(v.ends_at)}`)),
                h('div.steps', FLOW.map((s, i) => h(`div.step${i === idx ? '.on' : i < idx ? '.done' : ''}`, h('b', i < idx ? '✓' : String(i + 1)), opt('visit_status', s)))),
                ['rejected', 'cancelled'].includes(v.status) ? h('div.hint-box.bad', icon('ban'), opt('visit_status', v.status)) : null,
                h('div.actions',
                    v.status === 'requested' && can('visits', 'approve') ? [act('approve', t('visits.approve'), 'primary', 'check'), act('reject', t('visits.reject'), 'danger', 'x')] : null,
                    ['approved', 'permit_issued'].includes(v.status) && can('visits', 'update') ? act('issue_permit', v.status === 'permit_issued' ? t('visits.reissue') : t('visits.issue_permit'), 'primary', 'id-card', true) : null,
                    ['requested', 'approved', 'permit_issued'].includes(v.status) && can('visits', 'update') ? act('cancel', t('visits.cancel'), 'danger', 'ban') : null,
                    ['rejected', 'cancelled'].includes(v.status) && can('visits', 'update') ? act('reopen', t('visits.reopen'), '', 'refresh') : null,
                    can('visits', 'update') ? h('button.btn.sm', { type: 'button', on: { click: async () => { if (await editResource('visits', v)) { load(); tbl?.reload(); } } } }, icon('edit'), t('common.edit')) : null,
                    can('checkin') && ['permit_issued', 'checked_in', 'approved'].includes(v.status) ? h('a.btn.sm', { href: `/app/checkin?subject_type=visit&subject_id=${v.id}` }, icon('scan'), t('nav.checkin')) : null),
                h('dl.kv', h('dt', t('f.org_id')), h('dd', v.org_id__label || '—'), h('dt', t('f.host_name')), h('dd', v.host_name || '—'), h('dt', t('f.location')), h('dd', v.location || '—'), h('dt', t('f.purpose')), h('dd', v.purpose || '—'), v.notes ? [h('dt', t('f.notes')), h('dd', { style: { whiteSpace: 'pre-wrap' } }, v.notes)] : null),
                h('div', h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } }, h('h3', `${t('visits.participants')} (${fmtNum(people.rows.length)})`),
                    can('visits', 'update') ? h('button.btn.sm', { type: 'button', on: { click: () => addPeople(v.id).then((ok) => ok && load()) } }, icon('plus'), t('common.add')) : null),
                    people.rows.length ? h('div.list', { style: { border: '1px solid var(--border)', borderRadius: '10px' } }, people.rows.map((p) => h('div.list-item',
                        h('div', { style: { flex: 1 } }, h('a.cell-main', { href: `/app/visitors/${p.id}` }, pick(p, 'name')), h('div.cell-sub', p.org_name || '')),
                        p.blocked ? h('span.badge.bad', t('visitors.blocked')) : p.inside ? badge('presence', 'inside') : null,
                        p.permit ? h('button.btn.xs.ghost.icon', { type: 'button', title: t('visits.permit_link'), 'aria-label': t('visits.permit_link'), on: { click: () => copy(location.origin + p.permit) } }, icon('qr')) : null,
                        can('visits', 'update') ? h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.remove'), on: { click: async () => { if (await confirm(t('visits.remove_person'))) { await post(`visits/${v.id}/visitors`, { remove: [p.id] }); load(); } } } }, icon('x')) : null)))
                        : empty(t('visits.no_people'))));
        });
        async function doAction(v, action, permit) {
            let extra = {};
            if (permit) {
                const ch = h('select.select', ['email', 'sms', 'both', 'none'].map((c) => h('option', { value: c }, opt('channel', c))));
                const ok = await dialog({ title: t('visits.issue_permit'), size: 'narrow', body: h('div', h('p.muted', t('visits.permit_hint')), h('div.field', h('label', t('f.channel')), ch)), footer: [{ label: t('common.cancel'), value: false }, { label: t('visits.issue_permit'), kind: 'primary', value: true }] });
                if (!ok) return;
                extra = { channel: ch.value };
            } else if (['reject', 'cancel'].includes(action)) {
                const n = h('textarea.textarea', { placeholder: t('visits.reason') });
                const ok = await dialog({ title: t(`visits.${action}`), size: 'narrow', body: n, footer: [{ label: t('common.cancel'), value: false }, { label: t('common.confirm'), kind: 'danger solid', value: true }] });
                if (!ok) return;
                extra = { notes: n.value };
            }
            try {
                const r = await post(`visits/${v.id}/workflow/${action}`, extra);
                toast(r.sent ? t('visits.permits_sent', { ok: fmtNum(r.sent.ok), failed: fmtNum(r.sent.failed) }) : t('common.saved'), 'ok');
                load(); tbl?.reload();
            } catch (e) { toast(errText(e), 'bad'); }
        }
        load();
        return dr;
    }
    draw();
    if (params[0]) open(Number(params[0]));
    void navigate; void ws; void fmtDateTime; void debounce;
}

async function addPeople(visitId) {
    const sel = new Map();
    const res = h('div', { style: { maxHeight: '260px', overflow: 'auto', marginTop: '8px' } });
    const chips = h('div.actions', { style: { marginTop: '8px' } });
    const drawChips = () => chips.replaceChildren(...[...sel.values()].map((v) => h('span.chip', pick(v, 'name'))));
    const groupSel = h('select.select', h('option', { value: '' }, t('visits.or_group')));
    api('groups', { query: { size: 500 } }).then((g) => g.rows.forEach((x) => groupSel.append(h('option', { value: x.id }, `${x.name} (${x.members})`))));
    const newName = h('input.input', { placeholder: t('f.name_ar') });
    const newPhone = h('input.input', { placeholder: t('f.phone'), dir: 'ltr' });
    const newOrg = h('input.input', { placeholder: t('f.org_name') });
    const q = h('input.input', { type: 'search', placeholder: t('inv.search_visitors'), on: { input: debounce(async (e) => {
        if (e.target.value.trim().length < 2) return res.replaceChildren();
        const r = await api('visitors', { query: { q: e.target.value.trim(), size: 20 } });
        res.replaceChildren(...r.rows.map((v) => h('label.check', { style: { display: 'flex', padding: '6px 4px', borderBottom: '1px solid var(--border)' } }, h('input', { type: 'checkbox', checked: sel.has(v.id), on: { change: (ev) => { ev.target.checked ? sel.set(v.id, v) : sel.delete(v.id); drawChips(); } } }), h('span', pick(v, 'name'), h('span.small.muted', ` — ${v.org_name || ''}`)))));
    }) } });
    return dialog({ title: t('visits.add_people'), size: 'wide', body: h('div', q, chips, res, h('div', { style: { margin: '14px 0 6px' } }, groupSel),
        h('div.label', { style: { marginTop: '14px' } }, t('visits.new_person')), h('div.form-grid', { style: { gridTemplateColumns: '1fr 1fr 1fr' } }, newName, newPhone, newOrg)), footer: [
        { label: t('common.cancel'), value: false },
        { label: t('common.add'), kind: 'primary', onClick: async (close) => {
            try {
                await post(`visits/${visitId}/visitors`, { add: [...sel.keys()], group_id: groupSel.value || undefined, create: newName.value.trim() ? [{ name_ar: newName.value.trim(), phone: newPhone.value.trim() || undefined, org_name: newOrg.value.trim() || undefined, category: 'guest' }] : [] });
                close(true);
            } catch (e) { toast(errText(e), 'bad'); }
        } }] });
}
