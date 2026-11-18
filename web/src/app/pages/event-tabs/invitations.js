// تنظيم — الدعوات: إرسال بالبريد أو SMS، اختيار المستلمين (أفراد / مجموعات / Excel / Active Directory)، تتبع الحالة، إعادة الإرسال، والتذكير المجدول.
import { h, icon, debounce } from '../../../core/dom.js';
import { t, fmtNum, fmtDateTime, pick, opt, fromLocalInput } from '../../../core/i18n.js';
import { api, post } from '../../../core/api.js';
import { badge, dialog, toast, errText, confirm, copy, popover } from '../../../core/ui.js';
import { dataTable } from '../../components/table.js';
import { INVITATION_STATUSES } from '../../../../../shared/resources.js';

export default async function invitations({ root, eventId, can, ws }) {
    const canEdit = can('events', 'update');
    const counts = h('div.actions', { style: { marginBottom: '12px' } });
    const tbl = dataTable({
        fetch: (p) => api(`events/${eventId}/invitations`, { query: { ...p, status: p.f_status, channel: p.f_channel } }),
        onData: (r) => counts.replaceChildren(...INVITATION_STATUSES.filter((s) => r.counts[s]).map((s) => h('span', badge('invitation_status', s, `${opt('invitation_status', s)}: ${fmtNum(r.counts[s])}`)))),
        filters: [
            { key: 'f_status', label: t('f.status'), options: INVITATION_STATUSES.map((s) => ({ value: s, label: opt('invitation_status', s) })) },
            { key: 'f_channel', label: t('f.channel'), options: ['email', 'sms', 'both', 'none'].map((s) => ({ value: s, label: opt('channel', s) })) },
        ],
        selectable: canEdit,
        bulkActions: canEdit ? (ids, done) => [
            h('button.btn.sm', { type: 'button', on: { click: async () => { await send(ids, 'invitation'); done(); } } }, icon('send'), t('inv.resend')),
            h('button.btn.sm', { type: 'button', on: { click: async () => { await send(ids, 'reminder'); done(); } } }, icon('bell'), t('inv.remind')),
        ] : null,
        columns: [
            { key: 'name', label: t('f.name_ar'), sort: true, render: (r) => h('div', h('a.cell-main', { href: `/app/visitors/${r.visitor_id}` }, pick(r, 'name')), h('div.cell-sub', r.org_name || '')) },
            { key: 'contact', label: t('inv.contact'), render: (r) => h('div.small', r.email ? h('div.mono', r.email) : null, r.phone ? h('div.mono', r.phone) : null) },
            { key: 'channel', label: t('f.channel'), render: (r) => h('span.chip', opt('channel', r.channel)) },
            { key: 'status', label: t('f.status'), sort: true, render: (r) => h('div', badge('invitation_status', r.status), r.last_error ? h('div.cell-sub', { style: { color: 'var(--bad)' } }, t(`errors.${r.last_error}`) === `errors.${r.last_error}` ? r.last_error : t(`errors.${r.last_error}`)) : null) },
            { key: 'sent_at', label: t('inv.sent_at'), sort: true, render: (r) => h('div.small', r.sent_at ? fmtDateTime(r.sent_at.replace(' ', 'T') + (r.sent_at.includes('Z') ? '' : 'Z')) : '—', r.reminded_at ? h('div.cell-sub', t('inv.reminded')) : r.remind_at ? h('div.cell-sub', `${t('inv.remind_at')}: ${fmtDateTime(r.remind_at)}`) : null) },
            { key: 'responded_at', label: t('inv.responded_at'), sort: true, render: (r) => h('span.small', r.responded_at ? fmtDateTime(r.responded_at.replace(' ', 'T') + 'Z') : '—') },
        ],
        actions: canEdit ? (r) => [h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.more'), on: { click: (e) => popover(e.currentTarget, [
            r.link ? h('button', { type: 'button', on: { click: () => copy(r.link) } }, icon('copy'), t('inv.copy_link')) : null,
            r.link ? h('a', { href: r.link, target: '_blank' }, icon('external'), t('inv.open_page')) : null,
            h('button', { type: 'button', on: { click: () => send([r.id], 'invitation') } }, icon('send'), t('inv.resend')),
            !['confirmed', 'cancelled'].includes(r.status) ? h('button', { type: 'button', on: { click: async () => { await post(`invitations/${r.id}/confirm`); toast(t('common.saved'), 'ok'); tbl.reload(); } } }, icon('check'), t('inv.confirm_manual')) : null,
            r.status !== 'cancelled' ? h('button', { type: 'button', on: { click: async () => { if (await confirm(t('inv.cancel_confirm'), { danger: true })) { await post(`invitations/${r.id}/cancel`); tbl.reload(); } } } }, icon('ban'), t('inv.cancel')) : null,
        ]) } }, icon('more'))] : null,
        emptyTitle: t('inv.empty'), emptyText: t('inv.empty_hint'),
    });
    async function send(ids, kind) {
        try { const r = await post(`events/${eventId}/invitations/send`, { ids, kind }); toast(t('inv.sent_result', { ok: fmtNum(r.ok), failed: fmtNum(r.failed) }), r.failed ? 'warn' : 'ok'); tbl.reload(); } catch (e) { toast(errText(e), 'bad'); }
    }
    root.append(h('div.page-head', h('div', h('h2', t('event.tabs.invitations')), h('p', t('inv.subtitle'))), canEdit ? h('div.actions',
        h('button.btn', { type: 'button', on: { click: scheduleReminder } }, icon('clock'), t('inv.schedule_reminder')),
        h('button.btn', { type: 'button', on: { click: async () => { if (await confirm(t('inv.send_pending_confirm'))) send(null, 'invitation'); } } }, icon('send'), t('inv.send_pending')),
        h('button.btn.primary', { type: 'button', on: { click: () => addDialog(eventId).then((r) => r && tbl.reload()) } }, icon('plus'), t('inv.add'))) : null), counts, tbl.el);

    async function scheduleReminder() {
        const input = h('input.input', { type: 'datetime-local', dir: 'ltr' });
        const ok = await dialog({ title: t('inv.schedule_reminder'), size: 'narrow', body: h('div.field', h('label', t('inv.remind_at')), input, h('div.hint', t('inv.remind_hint'))), footer: [{ label: t('common.cancel'), value: false }, { label: t('common.save'), kind: 'primary', value: true }] });
        if (!ok || !input.value) return;
        try { const r = await post(`events/${eventId}/invitations/schedule-reminder`, { at: fromLocalInput(input.value), ids: tbl.selected().length ? tbl.selected() : undefined }); toast(t('inv.scheduled', { n: fmtNum(r.scheduled) }), 'ok'); tbl.reload(); } catch (e) { toast(errText(e), 'bad'); }
    }
    ws.sub(`event:${eventId}`);
    const off = ws.on('invitation', () => tbl.reload());
    return () => off();
}

/** نافذة إضافة مدعوين من مصادر متعددة */
function addDialog(eventId) {
    const st = { tab: 'people', visitors: new Map(), groups: new Set(), rows: [], directory: new Map(), channel: 'email', lang: 'ar', send: true };
    const tabBar = h('div.tabs');
    const pane = h('div', { style: { minHeight: '280px' } });
    const summary = h('div.small.muted');
    const updateSummary = () => summary.textContent = t('inv.add_summary', { p: fmtNum(st.visitors.size), g: fmtNum(st.groups.size), x: fmtNum(st.rows.length), d: fmtNum(st.directory.size) });
    const draw = () => {
        tabBar.replaceChildren(...['people', 'groups', 'excel', 'directory'].map((k) => h('button', { type: 'button', class: st.tab === k ? 'active' : '', on: { click: () => { st.tab = k; draw(); } } }, t(`inv.src_${k}`))));
        if (st.tab === 'people') {
            const results = h('div', { style: { maxHeight: '240px', overflow: 'auto', marginTop: '8px' } });
            const chips = h('div.actions', { style: { marginTop: '8px' } });
            const drawChips = () => chips.replaceChildren(...[...st.visitors.values()].map((v) => h('span.chip', pick(v, 'name'), h('button', { type: 'button', 'aria-label': t('common.remove'), on: { click: () => { st.visitors.delete(v.id); drawChips(); updateSummary(); } } }, '×'))));
            const q = h('input.input', { type: 'search', placeholder: t('inv.search_visitors'), autofocus: true, on: { input: debounce(async (e) => {
                if (e.target.value.trim().length < 2) return results.replaceChildren();
                const r = await api('visitors', { query: { q: e.target.value.trim(), size: 20 } });
                results.replaceChildren(...r.rows.map((v) => h('label.check', { style: { display: 'flex', padding: '6px 4px', borderBottom: '1px solid var(--border)' } }, h('input', { type: 'checkbox', checked: st.visitors.has(v.id), on: { change: (ev) => { ev.target.checked ? st.visitors.set(v.id, v) : st.visitors.delete(v.id); drawChips(); updateSummary(); } } }), h('span', pick(v, 'name'), h('span.small.muted', ` — ${v.org_name || ''} ${v.email || v.phone || ''}`)))));
            }) } });
            pane.replaceChildren(q, chips, results);
            drawChips();
        } else if (st.tab === 'groups') {
            pane.replaceChildren(h('div', t('common.loading')));
            api('groups', { query: { size: 500 } }).then((g) => pane.replaceChildren(h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '8px' } }, g.rows.map((x) => h('label.check', { style: { border: '1px solid var(--border)', borderRadius: '10px', padding: '10px' } }, h('input', { type: 'checkbox', checked: st.groups.has(x.id), on: { change: (e) => { e.target.checked ? st.groups.add(x.id) : st.groups.delete(x.id); updateSummary(); } } }), h('span', x.name, h('span.small.muted', ` (${x.members})`)))))));
        } else if (st.tab === 'excel') {
            const info = h('div.small.muted', { style: { marginTop: '8px' } }, st.rows.length ? t('inv.rows_loaded', { n: fmtNum(st.rows.length) }) : '');
            const file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', on: { change: async (e) => {
                const f = e.target.files[0];
                if (!f) return;
                const rows = await parseSheet(f);
                st.rows = rows;
                info.textContent = t('inv.rows_loaded', { n: fmtNum(rows.length) });
                updateSummary();
            } } });
            pane.replaceChildren(h('div.hint-box', icon('info'), h('div', t('inv.excel_hint'), h('div.mono', { style: { marginTop: '4px' } }, 'name_ar, name_en, phone, email, org_name, job_title, category, national_id'))),
                h('div', { style: { marginTop: '12px' } }, file), info, h('button.btn.sm.ghost', { type: 'button', style: { marginTop: '10px' }, on: { click: () => templateDownload() } }, icon('download'), t('inv.template')));
        } else {
            const results = h('div', { style: { maxHeight: '240px', overflow: 'auto', marginTop: '8px' } });
            const q = h('input.input', { type: 'search', placeholder: t('inv.search_directory'), on: { input: debounce(async (e) => {
                if (e.target.value.trim().length < 2) return results.replaceChildren();
                try {
                    const r = await api('directory/search', { query: { q: e.target.value.trim() } });
                    results.replaceChildren(...r.rows.map((p, i) => { const k = p.email || `${p.name}-${i}`; return h('label.check', { style: { display: 'flex', padding: '6px 4px', borderBottom: '1px solid var(--border)' } }, h('input', { type: 'checkbox', checked: st.directory.has(k), on: { change: (ev) => { ev.target.checked ? st.directory.set(k, { name_ar: p.name, email: p.email, phone: p.phone, org_name: p.org_name, job_title: p.job_title, category: 'staff' }) : st.directory.delete(k); updateSummary(); } } }), h('span', p.name, h('span.small.muted', ` — ${p.org_name || ''} ${p.email || ''}`))); }));
                } catch (er) { results.replaceChildren(h('div.hint-box.warn', icon('alert'), errText(er))); }
            }, 400) } });
            pane.replaceChildren(q, results);
        }
        updateSummary();
    };
    draw();
    const opts = h('div.form-grid', { style: { marginTop: '14px', borderTop: '1px solid var(--border)', paddingTop: '14px' } },
        h('div.field', h('label', t('f.channel')), h('select.select', { on: { change: (e) => { st.channel = e.target.value; } } }, ['email', 'sms', 'both', 'none'].map((c) => h('option', { value: c }, opt('channel', c))))),
        h('div.field', h('label', t('inv.lang')), h('select.select', { on: { change: (e) => { st.lang = e.target.value; } } }, h('option', { value: 'ar' }, 'العربية'), h('option', { value: 'en' }, 'English'))),
        h('label.check.wide', h('input', { type: 'checkbox', checked: true, on: { change: (e) => { st.send = e.target.checked; } } }), t('inv.send_immediately')));
    return dialog({ title: t('inv.add'), size: 'wide', body: h('div', tabBar, pane, h('div', { style: { marginTop: '10px' } }, summary), opts), footer: [
        { label: t('common.cancel'), value: null },
        { label: t('inv.create'), kind: 'primary', icon: 'send', onClick: async (close) => {
            try {
                const r = await post(`events/${eventId}/invitations`, { visitor_ids: [...st.visitors.keys()], group_ids: [...st.groups], rows: [...st.rows, ...st.directory.values()], channel: st.channel, lang: st.lang, send: st.send });
                toast(t('inv.created', { n: fmtNum(r.created), total: fmtNum(r.total) }) + (r.sent ? ` — ${t('inv.sent_result', { ok: fmtNum(r.sent.ok), failed: fmtNum(r.sent.failed) })}` : ''), r.errors?.length ? 'warn' : 'ok', 6000);
                close(r);
            } catch (e) { toast(errText(e), 'bad'); }
        } },
    ] });
}

export async function parseSheet(file) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const alias = { 'الاسم': 'name_ar', 'الاسم بالعربية': 'name_ar', name: 'name_ar', 'الاسم بالإنجليزية': 'name_en', 'الجوال': 'phone', 'رقم الجوال': 'phone', mobile: 'phone', 'البريد': 'email', 'البريد الإلكتروني': 'email', 'الجهة': 'org_name', organization: 'org_name', 'المسمى': 'job_title', 'التصنيف': 'category', 'رقم الهوية': 'national_id', 'الهوية': 'national_id' }; // i18n-ok: بيانات
    return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [alias[String(k).trim()] || String(k).trim(), String(v).trim()]).filter(([, v]) => v !== '')));
}
async function templateDownload() {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['name_ar', 'name_en', 'phone', 'email', 'org_name', 'job_title', 'category', 'national_id'], ['محمد بن عبدالله', 'Mohammed Abdullah', '0500000000', 'name@example.com', 'جامعة الملك سعود', 'مدير', 'guest', '']]); // i18n-ok: بيانات
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'invitees');
    XLSX.writeFile(wb, 'invitees-template.xlsx');
}
