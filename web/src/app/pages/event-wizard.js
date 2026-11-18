// تنظيم — معالج إنشاء فعالية: البيانات الأساسية ← الموقع والمناطق ← نموذج التسجيل ← قالب البطاقة ← الدعوات ← النشر.
import { h, icon, clear } from '../../core/dom.js';
import { t, opt, fmtDate, fmtTime, pick } from '../../core/i18n.js';
import { api, post } from '../../core/api.js';
import { toast, errText } from '../../core/ui.js';
import { resourceForm, refOptions, invalidateRef } from '../components/form.js';
import { pageHead } from '../main.js';
import { ZONE_KINDS } from '../../../../shared/resources.js';

const STEPS = ['basic', 'location', 'form', 'badge', 'invitations', 'publish'];

export default async function wizard({ root, navigate }) {
    const st = { step: 0, data: { type: 'guests', open_registration: 1 }, zones: [], venue_mode: 'existing', newVenue: { name_ar: '', name_en: '' }, groups: [], channel: 'email', sendNow: false, publish: true };
    const stepsEl = h('div.steps');
    const body = h('div.card-b');
    const foot = h('div.dialog-f');
    root.append(pageHead(t('wizard.title'), t('wizard.subtitle'), null, [{ label: t('nav.events'), href: '/app/events' }, { label: t('events.new') }]), stepsEl, h('div.card', body, foot));
    const [venues, forms, templates, groups] = await Promise.all([api('venues', { query: { size: 200 } }), api('forms', { query: { size: 200, f_scope: 'event' } }), api('badge_templates', { query: { size: 100 } }), api('groups', { query: { size: 500 } })]);
    let basicForm = null;

    function render() {
        stepsEl.replaceChildren(...STEPS.map((s, i) => h(`div.step${i === st.step ? '.on' : i < st.step ? '.done' : ''}`, h('b', i < st.step ? '✓' : String(i + 1)), t(`wizard.${s}`))));
        const s = STEPS[st.step];
        if (s === 'basic') {
            basicForm = resourceForm('events', st.data, { only: ['title_ar', 'title_en', 'org_id', 'type', 'starts_at', 'ends_at', 'capacity', 'audience', 'description', 'organizer_id', 'open_registration'] });
            clear(body, basicForm.el);
        } else if (s === 'location') {
            const venueSel = h('select.select', { on: { change: (e) => { st.data.venue_id = e.target.value ? Number(e.target.value) : null; loadZones(); } } }, h('option', { value: '' }, '—'), venues.rows.map((v) => h('option', { value: v.id, selected: v.id === st.data.venue_id }, pick(v, 'name'))));
            const zonesBox = h('div');
            const loadZones = async () => {
                if (st.venue_mode === 'existing' && st.data.venue_id) {
                    const z = await api('zones', { query: { f_venue_id: st.data.venue_id, size: 200 } });
                    zonesBox.replaceChildren(h('div.label', { style: { margin: '14px 0 6px' } }, t('wizard.venue_zones')), z.rows.length ? h('div.actions', z.rows.map((x) => h('span.chip', `${pick(x, 'name')} · ${opt('zone_kind', x.kind)} · ${x.capacity}`))) : h('div.small.muted', t('wizard.no_zones')));
                } else zonesBox.replaceChildren();
            };
            const newZones = h('div');
            const drawNew = () => newZones.replaceChildren(
                ...st.zones.map((z, i) => h('div', { style: { display: 'grid', gridTemplateColumns: '2fr 1.3fr 1fr auto', gap: '8px', marginBottom: '8px' } },
                    h('input.input', { value: z.name_ar, placeholder: t('f.name_ar'), 'aria-label': t('f.name_ar'), on: { input: (e) => { z.name_ar = e.target.value; } } }),
                    h('select.select', { 'aria-label': t('f.kind'), on: { change: (e) => { z.kind = e.target.value; } } }, ZONE_KINDS.map((k) => h('option', { value: k, selected: k === z.kind }, opt('zone_kind', k)))),
                    h('input.input', { type: 'number', min: 0, value: z.capacity, 'aria-label': t('f.capacity'), on: { input: (e) => { z.capacity = Number(e.target.value); } } }),
                    h('button.btn.icon.ghost', { type: 'button', 'aria-label': t('common.remove'), on: { click: () => { st.zones.splice(i, 1); drawNew(); } } }, icon('trash')))),
                h('button.btn.sm', { type: 'button', on: { click: () => { st.zones.push({ name_ar: '', kind: 'hall', capacity: 100 }); drawNew(); } } }, icon('plus'), t('wizard.add_zone')));
            const modeBtns = h('div.btn-group', ['existing', 'new'].map((m) => h('button', { type: 'button', class: st.venue_mode === m ? 'on' : '', on: { click: () => { st.venue_mode = m; render(); } } }, t(`wizard.venue_${m}`))));
            clear(body, modeBtns, h('div', { style: { marginTop: '16px' } },
                st.venue_mode === 'existing'
                    ? h('div.form-grid', h('div.field', h('label', t('f.venue_id')), venueSel), h('div.field', h('label', t('f.location')), h('input.input', { value: st.data.location || '', on: { input: (e) => { st.data.location = e.target.value; } } })))
                    : h('div', h('div.form-grid',
                        h('div.field', h('label', t('f.name_ar'), h('span.req', ' *')), h('input.input', { value: st.newVenue.name_ar, on: { input: (e) => { st.newVenue.name_ar = e.target.value; } } })),
                        h('div.field', h('label', t('f.name_en')), h('input.input', { value: st.newVenue.name_en, dir: 'ltr', on: { input: (e) => { st.newVenue.name_en = e.target.value; } } }))),
                    h('div.label', { style: { margin: '16px 0 8px' } }, t('wizard.zones')), newZones, h('div.hint', { style: { marginTop: '6px' } }, t('wizard.zones_hint')))),
            zonesBox);
            if (st.venue_mode === 'new') drawNew();
            loadZones();
        } else if (s === 'form') {
            clear(body, h('p.muted', t('wizard.form_hint')), h('div', { style: { display: 'grid', gap: '10px' } },
                choice(null, t('wizard.no_form'), t('wizard.no_form_hint'), st.data.form_id == null, () => { st.data.form_id = null; render(); }),
                forms.rows.map((f) => choice(f.id, f.name, t('forms.n_fields', { n: f.field_count ?? '—' }), st.data.form_id === f.id, () => { st.data.form_id = f.id; render(); }))),
            h('a.btn.sm', { href: '/app/forms/new', target: '_blank', style: { marginTop: '12px' } }, icon('external'), t('wizard.new_form')));
        } else if (s === 'badge') {
            const preview = h('div', { style: { minHeight: '200px', display: 'grid', placeItems: 'center' } });
            const show = async () => {
                const tpl = templates.rows.find((x) => x.id === st.data.badge_template_id) || templates.rows.find((x) => x.is_default);
                if (!tpl) return;
                const full = await api(`badge_templates/${tpl.id}`);
                const r = await post('badges/preview', { design: JSON.parse(full.design), width_mm: full.width_mm, height_mm: full.height_mm });
                preview.replaceChildren(h('div', { style: { width: `${full.width_mm * 3.4}px`, boxShadow: 'var(--shadow-lg)', borderRadius: '8px', overflow: 'hidden' }, html: r.svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%"') }));
            };
            clear(body, h('div.grid.g2', h('div', { style: { display: 'grid', gap: '10px', alignContent: 'start' } },
                templates.rows.map((tp) => choice(tp.id, tp.name, `${tp.width_mm}×${tp.height_mm} mm${tp.is_default ? ` · ${t('badges.default')}` : ''}`, (st.data.badge_template_id ?? templates.rows.find((x) => x.is_default)?.id) === tp.id, () => { st.data.badge_template_id = tp.id; render(); }))), preview));
            show().catch(() => {});
        } else if (s === 'invitations') {
            const sel = new Set(st.groups);
            clear(body, h('p.muted', t('wizard.inv_hint')),
                h('div.label', t('wizard.pick_groups')),
                h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '8px', margin: '8px 0 16px' } }, groups.rows.map((g) => h('label.check', { style: { border: '1px solid var(--border)', borderRadius: '10px', padding: '10px' } },
                    h('input', { type: 'checkbox', checked: sel.has(g.id), on: { change: (e) => { e.target.checked ? sel.add(g.id) : sel.delete(g.id); st.groups = [...sel]; } } }), h('span', g.name, h('span.small.muted', ` (${g.members})`))))),
                h('div.form-grid',
                    h('div.field', h('label', t('f.channel')), h('select.select', { on: { change: (e) => { st.channel = e.target.value; } } }, ['email', 'sms', 'both', 'none'].map((c) => h('option', { value: c, selected: c === st.channel }, opt('channel', c))))),
                    h('label.check', { style: { alignSelf: 'end' } }, h('input', { type: 'checkbox', checked: st.sendNow, on: { change: (e) => { st.sendNow = e.target.checked; } } }), t('wizard.send_now'))),
                h('div.hint', { style: { marginTop: '10px' } }, t('wizard.inv_later')));
        } else if (s === 'publish') {
            const d = st.data;
            clear(body, h('dl.kv',
                h('dt', t('f.title')), h('dd', d.title_ar || '—'), h('dt', t('f.type')), h('dd', opt('event_type', d.type)),
                h('dt', t('f.starts_at')), h('dd', `${fmtDate(d.starts_at)} ${fmtTime(d.starts_at)}`), h('dt', t('f.ends_at')), h('dd', `${fmtDate(d.ends_at)} ${fmtTime(d.ends_at)}`),
                h('dt', t('f.capacity')), h('dd', String(d.capacity ?? '—')), h('dt', t('f.venue_id')), h('dd', st.venue_mode === 'new' ? st.newVenue.name_ar : venues.rows.find((v) => v.id === d.venue_id)?.name_ar || '—'),
                h('dt', t('wizard.zones')), h('dd', String(st.zones.length)), h('dt', t('f.form_id')), h('dd', forms.rows.find((f) => f.id === d.form_id)?.name || t('wizard.no_form')),
                h('dt', t('wizard.pick_groups')), h('dd', st.groups.length ? groups.rows.filter((g) => st.groups.includes(g.id)).map((g) => g.name).join(t('common.sep')) : '—')),
            h('div', { style: { marginTop: '18px', display: 'flex', gap: '10px', flexWrap: 'wrap' } },
                h('label.check', h('input', { type: 'radio', name: 'pub', checked: st.publish, on: { change: () => { st.publish = true; } } }), t('wizard.publish_now')),
                h('label.check', h('input', { type: 'radio', name: 'pub', checked: !st.publish, on: { change: () => { st.publish = false; } } }), t('wizard.save_draft'))));
        }
        foot.replaceChildren(
            st.step ? h('button.btn', { type: 'button', on: { click: () => { st.step--; render(); } } }, t('common.back')) : h('a.btn', { href: '/app/events' }, t('common.cancel')),
            st.step < STEPS.length - 1 ? h('button.btn.primary', { type: 'button', on: { click: next } }, t('common.next')) : h('button.btn.primary', { type: 'button', on: { click: finish } }, icon('check'), t('wizard.finish')));
    }
    const choice = (id, title, sub, on, click) => h('button', { type: 'button', on: { click }, style: { textAlign: 'start', border: `2px solid ${on ? 'var(--primary)' : 'var(--border)'}`, background: on ? 'var(--primary-50)' : 'var(--surface)', borderRadius: '12px', padding: '12px 14px', cursor: 'pointer' } }, h('div', { style: { fontWeight: 600 } }, title), h('div.small.muted', sub));

    function next() {
        if (STEPS[st.step] === 'basic') {
            Object.assign(st.data, basicForm.values());
            const errs = [];
            if (!st.data.title_ar) errs.push({ field: 'title_ar', code: 'required' });
            if (!st.data.starts_at) errs.push({ field: 'starts_at', code: 'required' });
            if (!st.data.ends_at) errs.push({ field: 'ends_at', code: 'required' });
            if (st.data.starts_at && st.data.ends_at && st.data.ends_at <= st.data.starts_at) errs.push({ field: 'ends_at', code: 'after_start' });
            if (errs.length) return basicForm.setErrors(errs);
        }
        if (STEPS[st.step] === 'location' && st.venue_mode === 'new' && !st.newVenue.name_ar.trim()) return toast(t('wizard.venue_required'), 'warn');
        st.step++;
        render();
    }
    async function finish() {
        try {
            if (st.venue_mode === 'new') {
                const v = await post('venues', st.newVenue);
                st.data.venue_id = v.id;
                let y = 20;
                for (const z of st.zones.filter((x) => x.name_ar.trim())) { await post('zones', { ...z, venue_id: v.id, x: 20, y, w: 220, h: 90 }); y += 100; }
                invalidateRef('venues');
            }
            const ev = await post('events', { ...st.data, status: 'draft' });
            if (st.groups.length) await post(`events/${ev.id}/invitations`, { group_ids: st.groups, channel: st.channel, send: st.sendNow && st.publish });
            if (st.publish) await post(`events/${ev.id}/status`, { status: 'published' });
            toast(t('wizard.done'), 'ok');
            navigate(`/app/events/${ev.id}`);
        } catch (e) { toast(errText(e), 'bad', 6000); }
    }
    render();
    refOptions('orgs');
}
