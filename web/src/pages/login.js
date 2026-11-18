// تنظيم — صفحة الدخول: محلي أو Active Directory أو الدخول الموحد (SSO)، ثم التحقق الثنائي (أو تفعيله إن كان إلزامياً).
import '../core/style.css';
import { h, icon, clear } from '../core/dom.js';
import { t, setLang, getLang, pick } from '../core/i18n.js';
import { api } from '../core/api.js';
import { loadBranding } from '../core/theme.js';
import { errText } from '../core/ui.js';
import { qrEl } from '../core/qr.js';

const q = new URLSearchParams(location.search);
const next = (q.get('next') || '/app').startsWith('/') && !(q.get('next') || '').startsWith('//') ? q.get('next') || '/app' : '/app';
let b = {};

async function boot() {
    b = await loadBranding();
    const methods = await api('/api/v1/auth/methods').catch(() => ({}));
    render(methods);
}
function shell(content) {
    clear(document.getElementById('root'), h('div.login-page',
        h('div.login-art', h('div.pattern'), h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, h('div.brand-logo', { style: { width: '52px', height: '52px' } }, b.logo ? h('img', { src: b.logo, alt: '' }) : icon('layers')), h('div', h('div', { style: { fontSize: '24px', fontWeight: 700 } }, pick(b, 'name')), h('div', { style: { opacity: 0.8 } }, pick(b, 'tagline')))),
            h('div', h('h1', { style: { fontSize: '34px', lineHeight: 1.3, maxWidth: '460px' } }, t('login.hero')), h('p', { style: { opacity: 0.8, maxWidth: '440px', fontSize: '15px' } }, t('login.hero_sub'))),
            h('div', { style: { opacity: 0.7, fontSize: '13px' } }, pick(b, 'slogan'))),
        h('div.login-form', h('div.login-box',
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' } }, h('button.btn.sm.ghost', { type: 'button', on: { click: () => { setLang(getLang() === 'ar' ? 'en' : 'ar'); boot(); } } }, icon('globe'), getLang() === 'ar' ? 'English' : 'العربية')),
            content))));
}
function render(methods) {
    const mfa = q.get('mfa');
    if (mfa === 'verify') return mfaVerify();
    if (mfa === 'enroll') return mfaEnroll();
    const err = h('div', { role: 'alert' });
    if (q.get('expired')) err.append(h('div.hint-box.warn', icon('clock'), t('login.expired')));
    if (q.get('error')) err.append(h('div.hint-box.bad', icon('alert'), t(`errors.${q.get('error')}`)));
    let method = 'local';
    const login = h('input.input', { name: 'username', autocomplete: 'username', required: true, dir: 'ltr', style: { height: '44px' }, autofocus: true });
    const pass = h('input.input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, dir: 'ltr', style: { height: '44px' } });
    const btn = h('button.btn.primary.lg', { type: 'submit', style: { width: '100%' } }, t('login.submit'));
    const form = h('form', { style: { display: 'grid', gap: '14px' }, on: { submit: async (e) => {
        e.preventDefault();
        btn.disabled = true;
        err.replaceChildren();
        try {
            const r = await api('/api/v1/auth/login', { method: 'POST', body: { login: login.value, password: pass.value, method } });
            if (r.mfa) location.replace(`/login?mfa=${r.mfa}&next=${encodeURIComponent(next)}`);
            else location.replace(r.mustChangePassword ? '/app/profile' : next);
        } catch (ex) {
            err.replaceChildren(h('div.hint-box.bad', icon('alert'), ex.code === 'locked' ? t('login.locked', { m: Math.ceil((ex.body.until - Date.now()) / 60000) }) : errText(ex)));
            btn.disabled = false;
        }
    } } },
    methods.ldap ? h('div.btn-group', { style: { width: '100%' } }, ['local', 'ldap'].map((m) => h('button', { type: 'button', style: { flex: 1 }, class: m === method ? 'on' : '', on: { click: (e) => { method = m; e.target.parentNode.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.target)); } } }, t(`login.m_${m}`)))) : null,
    h('div.field', h('label', { for: 'u' }, t('login.user')), Object.assign(login, { id: 'u' })),
    h('div.field', h('label', { for: 'p' }, t('login.password')), Object.assign(pass, { id: 'p' })),
    err, btn,
    methods.oidc ? [h('div', { style: { textAlign: 'center', color: 'var(--faint)', fontSize: '12px' } }, t('login.or')), h('a.btn.lg', { href: '/auth/oidc/start', style: { width: '100%' } }, icon('key'), methods.oidc_label || t('login.sso'))] : null);
    shell(h('div', h('h1', { style: { marginBottom: '6px' } }, t('login.title')), h('p.muted', { style: { marginTop: 0, marginBottom: '22px' } }, t('login.subtitle')), form,
        h('p.small.faint', { style: { marginTop: '28px', textAlign: 'center' } }, t('login.notice'))));
}
function codeInput() { return h('input.input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, dir: 'ltr', autofocus: true, style: { height: '52px', fontSize: '24px', letterSpacing: '10px', textAlign: 'center' } }); }
function mfaVerify() {
    const code = codeInput();
    const err = h('div', { role: 'alert' });
    shell(h('form', { style: { display: 'grid', gap: '14px' }, on: { submit: async (e) => { e.preventDefault(); try { await api('/api/v1/auth/mfa/verify', { method: 'POST', body: { code: code.value } }); location.replace(next); } catch (ex) { err.replaceChildren(h('div.hint-box.bad', icon('alert'), errText(ex))); code.select(); } } } },
        h('div.kpi-ico', { style: { width: '52px', height: '52px' } }, icon('shield')), h('h1', t('login.mfa_title')), h('p.muted', { style: { margin: 0 } }, t('login.mfa_sub')), code, err, h('button.btn.primary.lg', { type: 'submit' }, t('login.verify')),
        h('button.btn.ghost', { type: 'button', on: { click: async () => { await api('/api/v1/auth/logout', { method: 'POST', body: {} }).catch(() => {}); location.replace('/login'); } } }, t('login.back'))));
}
async function mfaEnroll() {
    let s;
    try { s = await api('/api/v1/auth/mfa/setup', { method: 'POST', body: {} }); } catch { location.replace('/login'); return; }
    const code = codeInput();
    const err = h('div', { role: 'alert' });
    shell(h('form', { style: { display: 'grid', gap: '14px', justifyItems: 'center', textAlign: 'center' }, on: { submit: async (e) => { e.preventDefault(); try { await api('/api/v1/auth/mfa/verify', { method: 'POST', body: { code: code.value } }); location.replace(next); } catch (ex) { err.replaceChildren(h('div.hint-box.bad', icon('alert'), errText(ex))); } } } },
        h('h1', t('login.enroll_title')), h('p.muted', { style: { margin: 0 } }, t('login.enroll_sub')), qrEl(s.uri, 210), h('div.mono.small.muted', s.secret), code, err, h('button.btn.primary.lg', { type: 'submit', style: { width: '100%' } }, t('login.verify'))));
}
boot();
