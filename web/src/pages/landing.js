// تنظيم — الصفحة الرئيسية: مدخل للوحة التحكم وتطبيق المشارك والكشك.
import '../core/style.css';
import { h, icon, clear } from '../core/dom.js';
import { t, setLang, getLang, pick } from '../core/i18n.js';
import { loadBranding } from '../core/theme.js';

async function boot() {
    const b = await loadBranding();
    const card = (href, ic, title, sub) => h('a.card', { href, style: { padding: '22px', display: 'flex', gap: '14px', color: 'inherit', textDecoration: 'none' } }, h('div.kpi-ico', icon(ic)), h('div', h('h3', title), h('div.small.muted', sub)));
    clear(document.getElementById('root'), h('div', { style: { minHeight: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr auto' } },
        h('header', { style: { background: 'var(--sidebar)', color: '#fff', padding: '18px 28px', display: 'flex', alignItems: 'center', gap: '12px' } },
            h('div.brand-logo', b.logo ? h('img', { src: b.logo, alt: '' }) : icon('layers')), h('div', h('div', { style: { fontWeight: 700, fontSize: '18px' } }, pick(b, 'name')), h('div', { style: { opacity: 0.75, fontSize: '12px' } }, pick(b, 'tagline'))),
            h('button.btn.sm', { type: 'button', style: { marginInlineStart: 'auto' }, on: { click: () => { setLang(getLang() === 'ar' ? 'en' : 'ar'); boot(); } } }, icon('globe'), getLang() === 'ar' ? 'English' : 'العربية')),
        h('main', { style: { maxWidth: '980px', margin: '0 auto', padding: '56px 24px', width: '100%' } },
            h('h1', { style: { fontSize: '34px', marginBottom: '10px' } }, pick(b, 'tagline')), h('p.muted', { style: { fontSize: '16px', maxWidth: '640px' } }, t('landing.intro')),
            h('div.grid.g3', { style: { marginTop: '32px' } },
                card('/app', 'grid', t('landing.admin'), t('landing.admin_sub')), card('/m', 'phone', t('landing.mobile'), t('landing.mobile_sub')), card('/kiosk', 'monitor', t('landing.kiosk'), t('landing.kiosk_sub')))),
        h('footer.small.faint', { style: { textAlign: 'center', padding: '20px' } }, pick(b, 'slogan'))));
    document.title = pick(b, 'name');
}
boot();
