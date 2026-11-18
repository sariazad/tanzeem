// تنظيم — الإعدادات: الهوية البصرية للجهة (تُطبّق فوراً دون تعديل الكود)، قوالب الرسائل، الأمن، الاحتفاظ بالبيانات، والذكاء الاصطناعي.
import { h, icon, clear, readFileAsDataUrl } from '../../core/dom.js';
import { t, pick, fmtNum } from '../../core/i18n.js';
import { api, put } from '../../core/api.js';
import { toast, errText, mount } from '../../core/ui.js';
import { applyBranding } from '../../core/theme.js';
import { pageHead } from '../main.js';

const TABS = ['branding', 'templates', 'security', 'retention', 'ai'];

export default async function settings({ root, params, can }) {
    const tab = TABS.includes(params[0]) ? params[0] : 'branding';
    const canEdit = can('settings', 'update');
    const body = h('div');
    root.append(pageHead(t('top.settings'), t('settings.subtitle')), h('nav.tabs', TABS.map((k) => h('a', { href: `/app/settings/${k}`, class: k === tab ? 'active' : '' }, t(`settings.tab_${k}`)))), body);
    const save = async (section, value, after) => { try { const r = await put(`settings/${section}`, value); toast(t('common.saved'), 'ok'); after?.(r.value); } catch (e) { toast(errText(e), 'bad'); } };
    mount(body, () => api('settings'), (s) => {
        if (tab === 'branding') {
            const b = { ...s.branding };
            const preview = h('div');
            const drawPreview = () => clear(preview, h('div', { style: { borderRadius: `${b.radius}px`, overflow: 'hidden', border: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '150px 1fr', minHeight: '220px', fontFamily: `'${b.font}', Tahoma` } },
                h('div', { style: { background: b.sidebar, color: '#fff', padding: '14px' } }, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('div', { style: { width: '30px', height: '30px', borderRadius: '8px', background: 'rgba(255,255,255,.12)', overflow: 'hidden' } }, b.logo ? h('img', { src: b.logo, alt: '', style: { width: '100%', height: '100%', objectFit: 'contain' } }) : null), h('b', pick(b, 'name'))),
                    ...[1, 2, 3, 4].map((i) => h('div', { style: { marginTop: '10px', padding: '6px 8px', borderRadius: '7px', background: i === 1 ? b.primary : 'transparent', fontSize: '12px', opacity: i === 1 ? 1 : 0.7 } }, t(`nav.${['dashboard', 'events', 'visits', 'visitors'][i - 1]}`)))),
                h('div', { style: { padding: '16px', background: 'var(--bg)' } }, h('div', { style: { background: 'var(--surface)', borderRadius: `${b.radius}px`, padding: '14px', border: '1px solid var(--border)' } }, h('div', { style: { fontSize: '22px', fontWeight: 700 } }, '1,248'), h('div.small.muted', t('dash.visitors_today'))),
                    h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, h('span', { style: { background: b.primary, color: '#fff', padding: '7px 14px', borderRadius: `${Math.max(4, b.radius - 2)}px`, fontSize: '13px' } }, t('events.new')), h('span', { style: { background: b.accent, color: '#fff', padding: '7px 14px', borderRadius: `${Math.max(4, b.radius - 2)}px`, fontSize: '13px' } }, t('nav.reports'))))));
            const inp = (k, attrs = {}) => h('div.field', h('label', t(`settings.${k}`)), h('input.input', { value: b[k] ?? '', disabled: !canEdit, ...attrs, on: { input: (e) => { b[k] = attrs.type === 'number' ? Number(e.target.value) : e.target.value; drawPreview(); } } }));
            const sel = (k, opts) => h('div.field', h('label', t(`settings.${k}`)), h('select.select', { disabled: !canEdit, on: { change: (e) => { b[k] = e.target.value; drawPreview(); } } }, opts.map(([v, l]) => h('option', { value: v, selected: b[k] === v }, l))));
            drawPreview();
            return h('div.grid.g2',
                h('div.card', h('div.card-b', h('div.form-grid',
                    inp('name_ar'), inp('name_en', { dir: 'ltr' }), inp('tagline_ar'), inp('tagline_en', { dir: 'ltr' }), inp('slogan_ar'), inp('slogan_en', { dir: 'ltr' }),
                    inp('primary', { type: 'color' }), inp('accent', { type: 'color' }), inp('sidebar', { type: 'color' }), inp('radius', { type: 'number', min: 0, max: 24 }),
                    sel('font', s.fonts.map((f) => [f, f])), sel('default_lang', [['ar', 'العربية'], ['en', 'English']]), sel('calendar', [['both', t('settings.cal_both')], ['gregory', t('settings.cal_gregory')], ['hijri', t('settings.cal_hijri')]]),
                    h('div.field', h('label', t('settings.logo')), h('div.actions', h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', disabled: !canEdit, on: { change: async (e) => { if (e.target.files[0]) { b.logo = await readFileAsDataUrl(e.target.files[0], 400); drawPreview(); } } } }), b.logo ? h('button.btn.xs', { type: 'button', on: { click: () => { b.logo = null; drawPreview(); } } }, t('common.remove')) : null))),
                canEdit ? h('div.actions', { style: { marginTop: '16px' } }, h('button.btn.primary', { type: 'button', on: { click: () => save('branding', b, (v) => applyBranding(v)) } }, icon('save'), t('settings.apply'))) : null)),
                h('div.card', h('div.card-h', h('h2', t('settings.preview'))), h('div.card-b', preview, h('div.hint-box', { style: { marginTop: '14px' } }, icon('info'), t('settings.branding_hint')))));
        }
        if (tab === 'templates') {
            const tpl = JSON.parse(JSON.stringify(s.templates));
            return h('div', h('div.hint-box', { style: { marginBottom: '16px' } }, icon('info'), h('div', t('settings.tpl_hint'), h('div.mono', { style: { marginTop: '4px' } }, '{name} {event} {date} {time} {location} {link} {org}'))),
                Object.keys(tpl).filter((k) => k !== 'message').map((kind) => h('div.card', { style: { marginBottom: '16px' } }, h('div.card-h', h('h2', t(`settings.tpl_${kind}`))), h('div.card-b', h('div.grid.g2', ['ar', 'en'].map((lang) => h('div', { style: { display: 'grid', gap: '10px' }, dir: lang === 'ar' ? 'rtl' : 'ltr' },
                    h('div.label', lang === 'ar' ? 'العربية' : 'English'),
                    h('div.field', h('label', t('settings.tpl_subject')), h('input.input', { value: tpl[kind][lang].subject, disabled: !canEdit, on: { input: (e) => { tpl[kind][lang].subject = e.target.value; } } })),
                    h('div.field', h('label', t('settings.tpl_body')), h('textarea.textarea', { rows: 6, disabled: !canEdit, on: { input: (e) => { tpl[kind][lang].body = e.target.value; } } }, tpl[kind][lang].body)),
                    h('div.field', h('label', t('settings.tpl_sms')), h('textarea.textarea', { rows: 2, disabled: !canEdit, on: { input: (e) => { tpl[kind][lang].sms = e.target.value; } } }, tpl[kind][lang].sms)))))))),
                canEdit ? h('button.btn.primary', { type: 'button', on: { click: () => save('templates', tpl) } }, icon('save'), t('common.save')) : null);
        }
        if (tab === 'security') {
            const sec = { ...s.security };
            const roles = ['super_admin', 'org_admin', 'organizer', 'reception', 'it'];
            return h('div.card', h('div.card-b', { style: { display: 'grid', gap: '14px' } }, h('h3', t('settings.mfa_roles')), h('div.small.muted', t('settings.mfa_roles_hint')),
                h('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap' } }, roles.map((r) => h('label.check', h('input', { type: 'checkbox', checked: sec.mfa_required_roles.includes(r), disabled: !canEdit, on: { change: (e) => { sec.mfa_required_roles = sec.mfa_required_roles.filter((x) => x !== r); if (e.target.checked) sec.mfa_required_roles.push(r); } } }), t(`role.${r}`)))),
                h('div.hint-box', icon('shield'), h('div', t('settings.security_facts'))),
                canEdit ? h('button.btn.primary', { type: 'button', style: { justifySelf: 'start' }, on: { click: () => save('security', sec) } }, icon('save'), t('common.save')) : null));
        }
        if (tab === 'retention') {
            const r = { ...s.retention };
            return h('div.card', h('div.card-b', { style: { display: 'grid', gap: '14px', maxWidth: '640px' } }, h('div.hint-box', icon('info'), t('settings.retention_hint')),
                h('div.field', h('label', t('settings.visitor_days')), h('input.input', { type: 'number', min: 30, max: 3650, value: r.visitor_days, disabled: !canEdit, on: { input: (e) => { r.visitor_days = Number(e.target.value); } } }), h('div.hint', t('settings.visitor_days_hint'))),
                h('div.field', h('label', t('settings.logs_days')), h('input.input', { type: 'number', min: 90, max: 3650, value: r.logs_days, disabled: !canEdit, on: { input: (e) => { r.logs_days = Number(e.target.value); } } })),
                canEdit ? h('button.btn.primary', { type: 'button', style: { justifySelf: 'start' }, on: { click: () => save('retention', r) } }, icon('save'), t('common.save')) : null));
        }
        const ai = { ...s.ai };
        return h('div.card', h('div.card-b', { style: { display: 'grid', gap: '14px', maxWidth: '640px' } }, h('div.hint-box', icon('sparkles'), t('settings.ai_hint')),
            h('label.check', h('span.switch', h('input', { type: 'checkbox', checked: ai.enabled !== false, disabled: !canEdit, on: { change: (e) => { ai.enabled = e.target.checked; } } }), h('span')), t('settings.ai_enabled')),
            h('a', { href: '/app/integrations' }, t('settings.ai_provider')),
            canEdit ? h('button.btn.primary', { type: 'button', style: { justifySelf: 'start' }, on: { click: () => save('ai', ai) } }, icon('save'), t('common.save')) : null));
    });
    void fmtNum;
}
