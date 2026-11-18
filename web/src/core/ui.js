// تنظيم — مكوّنات الواجهة العامة: تنبيهات عائمة، نوافذ حوار، تأكيد، درج جانبي، قوائم، حالات (تحميل/فارغ/خطأ)، وشارات الحالة.
import { h, icon, clear } from './dom.js';
import { t, opt } from './i18n.js';

let toastBox = null;
export function toast(msg, kind = '', ms = 3500) {
    if (!toastBox) { toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
    const el = h(`div.toast${kind ? '.' + kind : ''}`, icon(kind === 'ok' ? 'check-circle' : kind === 'bad' ? 'x-circle' : kind === 'warn' ? 'alert' : 'info'), h('span', msg));
    toastBox.appendChild(el);
    setTimeout(() => el.remove(), ms);
}
/** رسالة خطأ مترجمة من ApiError */
export function errText(e) {
    if (!e) return t('errors.generic');
    if (e.code === 'invalid' && e.errors?.length) return e.errors.map((x) => `${t(`f.${x.field}`)}: ${t(`errors.${x.code}`)}`).join(' — ');
    const k = `errors.${e.code}`;
    const s = t(k);
    return s === k ? (e.status === 0 || e.name === 'TypeError' ? t('errors.network') : t('errors.generic')) : s;
}
export const toastErr = (e) => toast(errText(e), 'bad', 5000);

const stack = [];
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) { e.preventDefault(); stack[stack.length - 1].close(null); }
    if (e.key === 'Tab' && stack.length) {
        const root = stack[stack.length - 1].el;
        const f = [...root.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
});

/** نافذة حوار. body: عنصر أو دالة (close) => عنصر. footer: [{label, kind, onClick(close) | value}] */
export function dialog({ title, body, footer, size = '', onClose, labelledBy } = {}) {
    return new Promise((resolve) => {
        const prev = document.activeElement;
        const id = `dlg-${Math.random().toString(36).slice(2)}`;
        const close = (v) => { const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1); back.remove(); onClose?.(v); prev?.focus?.(); resolve(v); };
        const content = typeof body === 'function' ? body(close) : body;
        const foot = footer ? h('div.dialog-f', footer.map((b) => h(`button.btn${b.kind ? '.' + b.kind : ''}`, { type: 'button', on: { click: () => (b.onClick ? b.onClick(close) : close(b.value)) } }, b.icon ? icon(b.icon) : null, b.label))) : null;
        const el = h(`div.dialog${size ? '.' + size : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy || id },
            h('div.dialog-h', h('h2', { id }, title), h('button.icon-btn', { type: 'button', 'aria-label': t('common.close'), on: { click: () => close(null) } }, icon('x'))),
            h('div.dialog-b', content), foot);
        const back = h('div.dialog-back', { on: { mousedown: (e) => { if (e.target === back) close(null); } } }, el);
        const entry = { el, close };
        stack.push(entry);
        document.body.appendChild(back);
        setTimeout(() => (el.querySelector('[autofocus],input:not([type=hidden]),select,textarea') || el.querySelector('.dialog-f .btn.primary') || el).focus?.(), 30);
    });
}
export function confirm(message, { title = t('common.confirm'), ok = t('common.confirm'), danger = false } = {}) {
    return dialog({ title, size: 'narrow', body: h('p', { style: { margin: 0 } }, message), footer: [{ label: t('common.cancel'), value: false }, { label: ok, kind: danger ? 'danger solid' : 'primary', value: true }] }).then(Boolean);
}
export function drawer({ title, subtitle, body, actions }) {
    const prev = document.activeElement;
    const close = () => { const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1); back.remove(); el.remove(); prev?.focus?.(); };
    const el = h('aside.drawer', { role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : '' },
        h('div.dialog-h', h('div', h('h2', title), subtitle ? h('div.small.muted', subtitle) : null), h('div.actions', actions || null, h('button.icon-btn', { type: 'button', 'aria-label': t('common.close'), on: { click: close } }, icon('x')))),
        h('div.dialog-b', { style: { flex: 1 } }, typeof body === 'function' ? body(close) : body));
    const back = h('div.drawer-back', { on: { click: close } });
    const entry = { el, close };
    stack.push(entry);
    document.body.append(back, el);
    el.querySelector('button')?.focus();
    return { close, el };
}
/** قائمة منبثقة تحت عنصر */
export function popover(anchor, content, { align = 'end' } = {}) {
    const r = anchor.getBoundingClientRect();
    const m = h('div.menu', { role: 'menu' }, content);
    m.style.top = `${r.bottom + 6 + window.scrollY}px`;
    const rtl = document.dir === 'rtl';
    if ((align === 'end') !== rtl) m.style.right = `${document.documentElement.clientWidth - r.right}px`; else m.style.left = `${r.left}px`;
    m.style.position = 'absolute';
    document.body.appendChild(m);
    const off = (e) => { if (!m.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { m.remove(); document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key); };
    setTimeout(() => { document.addEventListener('mousedown', off); document.addEventListener('keydown', key); }, 0);
    m.addEventListener('click', (e) => { if (e.target.closest('button,a')) close(); });
    return { close, el: m };
}

/* ───────── الحالات ───────── */
export const loading = (text) => h('div.state', { role: 'status' }, h('div.spinner'), h('div', { style: { marginTop: '10px' } }, text || t('common.loading')));
export const empty = (title, text, action) => h('div.state', icon('box'), h('h3', title || t('common.empty')), text ? h('div', text) : null, action ? h('div', { style: { marginTop: '14px' } }, action) : null);
export const errorState = (e, retry) => h('div.state', { role: 'alert' }, icon('alert'), h('h3', t('errors.title')), h('div', errText(e)), retry ? h('button.btn', { style: { marginTop: '12px' }, on: { click: retry } }, icon('refresh'), t('common.retry')) : null);
export const skeletonRows = (n = 6) => h('div', { style: { padding: '16px' } }, Array.from({ length: n }, () => h('div.skeleton', { style: { margin: '12px 0', width: `${60 + Math.random() * 40}%` } })));

/** حمّل بيانات داخل حاوية مع حالات التحميل والخطأ */
export async function mount(container, loader, render) {
    clear(container, loading());
    try {
        const data = await loader();
        clear(container, render(data));
    } catch (e) {
        clear(container, errorState(e, () => mount(container, loader, render)));
    }
}

/* ───────── الشارات ───────── */
const TONE = {
    status: { draft: '', published: 'info', running: 'ok', ended: 'plain', cancelled: 'bad' },
    visit_status: { requested: 'warn', approved: 'info', permit_issued: 'primary', checked_in: 'ok', checked_out: '', rejected: 'bad', cancelled: 'bad' },
    invitation_status: { pending: '', sent: 'info', confirmed: 'ok', declined: 'warn', cancelled: 'bad', expired: '', failed: 'bad' },
    device_status: { pending: 'warn', online: 'ok', offline: 'bad', error: 'bad', paper_low: 'warn' },
    priority: { low: '', medium: 'info', high: 'warn', critical: 'bad' },
    notif_status: { new: 'bad', ack: 'warn', resolved: 'ok' },
    presence: { inside: 'ok', left: '', confirmed: 'info', none: 'plain' },
    integration_status: { ok: 'ok', error: 'bad', unknown: '', disabled: '' },
    user_status: { active: 'ok', disabled: '', locked: 'bad' },
};
export function badge(kind, value, text) {
    if (value == null || value === '') return h('span.faint', '—');
    const tone = TONE[kind]?.[value] ?? '';
    return h(`span.badge${tone ? '.' + tone.split(' ').join('.') : ''}`, text || opt(kind, value));
}
export function avatar(name, photoUrl) {
    const init = String(name || '?').trim().split(/\s+/).filter((w) => !['بن', 'بنت', 'آل'].includes(w)).slice(0, 2).map((w) => w[0]).join(''); // i18n-ok: بيانات
    return h('div.avatar', photoUrl ? h('img', { src: photoUrl, alt: '', loading: 'lazy' }) : init);
}
export function progress(pct, { warnAt = 85, badAt = 100 } = {}) {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    return h(`div.progress${pct >= badAt ? '.bad' : pct >= warnAt ? '.warn' : ''}`, { role: 'progressbar', 'aria-valuenow': String(Math.round(pct || 0)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { style: { width: `${v}%` } }));
}
export async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast(t('common.copied'), 'ok'); } catch { toast(text); }
}
/** صوت قصير للنجاح والرفض (شاشة الاستقبال والكشك) */
let actx = null;
export function beep(ok = true) {
    try {
        actx ||= new (window.AudioContext || window.webkitAudioContext)();
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine';
        o.frequency.value = ok ? 880 : 220;
        g.gain.setValueAtTime(0.18, actx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + (ok ? 0.18 : 0.45));
        o.connect(g).connect(actx.destination);
        o.start();
        o.stop(actx.currentTime + (ok ? 0.2 : 0.5));
        if (ok) { const o2 = actx.createOscillator(); o2.frequency.value = 1320; o2.connect(g); o2.start(actx.currentTime + 0.09); o2.stop(actx.currentTime + 0.2); }
    } catch { /* لا صوت */ }
}
