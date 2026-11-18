// تنظيم — إدارة الأكشاك: الإعدادات (الفعالية، اللغات، مهلة الخمول، التسجيل الفوري، الصورة، الطباعة) ومعاينة واجهة الكشك.
import { h, icon, clear } from '../../core/dom.js';
import { t, pick, opt, fmtAgo } from '../../core/i18n.js';
import { api, put, post } from '../../core/api.js';
import { badge, toast, errText, empty, copy } from '../../core/ui.js';
import { pageHead } from '../main.js';

export default async function kiosk({ root, can, ws }) {
    const [devs, events, printers] = await Promise.all([api('devices', { query: { f_kind: 'kiosk', size: 100 } }), api('events', { query: { size: 200, sort: 'starts_at', dir: 'desc' } }), api('devices', { query: { f_kind: 'printer', size: 100 } })]);
    const canEdit = can('kiosk', 'update');
    const list = h('div', { style: { display: 'grid', gap: '16px' } });
    const preview = h('div.card', h('div.card-h', h('h2', t('kiosk.preview')), h('a.btn.sm', { href: '/kiosk?preview=1', target: '_blank' }, icon('external'), t('kiosk.open_full'))),
        h('div.card-b', h('div', { style: { aspectRatio: '9/14', maxHeight: '640px', margin: 'auto', borderRadius: '22px', border: '10px solid #1c2522', overflow: 'hidden', background: '#000' } },
            h('iframe', { src: '/kiosk?preview=1', title: t('kiosk.preview'), style: { width: '100%', height: '100%', border: 0, background: '#fff' } }))));
    root.append(pageHead(t('nav.kiosk'), t('kiosk.subtitle'), [h('a.btn', { href: '/app/devices' }, icon('cpu'), t('kiosk.manage_devices'))]),
        h('div.hint-box', { style: { marginBottom: '16px' } }, icon('info'), h('div', t('kiosk.setup_hint'), h('div.mono', { style: { marginTop: '4px' } }, `${location.origin}/kiosk`))),
        h('div.grid.g-main', list, preview));
    if (!devs.rows.length) list.append(empty(t('kiosk.none'), t('kiosk.none_hint'), h('a.btn.primary', { href: '/app/devices' }, icon('plus'), t('devices.new'))));
    for (const d of devs.rows) {
        const full = await api(`devices/${d.id}`);
        const cfg = { idle_seconds: 45, allow_walkin: true, capture_photo: true, languages: ['ar', 'en'], print_mode: 'auto', welcome_ar: '', welcome_en: '', exit_mode: false, ...JSON.parse(full.config || '{}') };
        const st = { ...cfg, event_id: d.event_id || '', printer_id: full.printer_id || '' };
        const card = h('div.card');
        const field = (label, input) => h('div.field', h('label', label), input);
        const sw = (k, label) => h('label.check', h('span.switch', h('input', { type: 'checkbox', checked: !!st[k], disabled: !canEdit, on: { change: (e) => { st[k] = e.target.checked; } } }), h('span')), label);
        clear(card, h('div.card-h', h('div', h('h2', d.name), h('div.small.muted', [d.location, d.gate].filter(Boolean).join(' · '))), h('div.actions', badge('device_status', d.status), d.online ? h('span.badge.ok', t('devices.connected')) : h('span.small.faint', d.last_seen ? fmtAgo(d.last_seen) : '—'))),
            h('div.card-b', d.status === 'pending' ? h('div.hint-box.warn', { style: { marginBottom: '12px' } }, icon('key'), h('div', t('kiosk.pair_with'), ' ', h('b.mono', { style: { fontSize: '18px', letterSpacing: '3px' } }, d.pair_code || '—'), h('button.btn.xs.ghost', { type: 'button', on: { click: () => copy(d.pair_code) } }, icon('copy')))) : null,
                h('div.form-grid',
                    field(t('nav.events'), h('select.select', { disabled: !canEdit, on: { change: (e) => { st.event_id = e.target.value; } } }, h('option', { value: '' }, '—'), events.rows.filter((e) => !['cancelled', 'ended'].includes(e.status)).map((e) => h('option', { value: e.id, selected: String(e.id) === String(st.event_id) }, pick(e, 'title'))))),
                    field(t('kiosk.printer'), h('select.select', { disabled: !canEdit, on: { change: (e) => { st.printer_id = e.target.value; } } }, h('option', { value: '' }, t('kiosk.browser_print')), printers.rows.map((p) => h('option', { value: p.id, selected: String(p.id) === String(st.printer_id) }, p.name)))),
                    field(t('kiosk.idle'), h('input.input', { type: 'number', min: 10, max: 600, value: st.idle_seconds, disabled: !canEdit, on: { input: (e) => { st.idle_seconds = Number(e.target.value); } } })),
                    field(t('kiosk.print_mode'), h('select.select', { disabled: !canEdit, on: { change: (e) => { st.print_mode = e.target.value; } } }, ['auto', 'browser', 'agent', 'none'].map((m) => h('option', { value: m, selected: m === st.print_mode }, t(`kiosk.pm_${m}`))))),
                    field(t('kiosk.welcome_ar'), h('input.input', { value: st.welcome_ar, disabled: !canEdit, on: { input: (e) => { st.welcome_ar = e.target.value; } } })),
                    field(t('kiosk.welcome_en'), h('input.input', { value: st.welcome_en, dir: 'ltr', disabled: !canEdit, on: { input: (e) => { st.welcome_en = e.target.value; } } })),
                    h('div.wide', { style: { display: 'flex', gap: '20px', flexWrap: 'wrap' } }, sw('allow_walkin', t('kiosk.walkin')), sw('capture_photo', t('kiosk.photo')), sw('exit_mode', t('kiosk.exit_mode')),
                        h('label.check', h('input', { type: 'checkbox', checked: st.languages.includes('en'), disabled: !canEdit, on: { change: (e) => { st.languages = e.target.checked ? ['ar', 'en'] : ['ar']; } } }), t('kiosk.bilingual')))),
                canEdit ? h('div.actions', { style: { marginTop: '16px', justifyContent: 'flex-end' } },
                    h('button.btn.sm', { type: 'button', on: { click: async () => { const r = await post(`devices/${d.id}/command`, { cmd: 'reload' }); toast(r.delivered ? t('devices.cmd_sent') : t('devices.cmd_offline'), r.delivered ? 'ok' : 'warn'); } } }, icon('refresh'), t('devices.cmd_reload')),
                    h('button.btn.sm.primary', { type: 'button', on: { click: async () => { try { await put(`devices/${d.id}/config?from=kiosk`, { ...st, event_id: st.event_id ? Number(st.event_id) : null, printer_id: st.printer_id ? Number(st.printer_id) : null }); toast(t('kiosk.saved'), 'ok'); } catch (e) { toast(errText(e), 'bad'); } } } }, icon('save'), t('common.save'))) : null));
        list.append(card);
    }
    const off = ws.on('device', () => {});
    return () => off();
    void opt;
}
