// تنظيم — لوحة التحكم: الهيكل (القائمة الجانبية بالترتيب المحدد، الشريط العلوي)، الموجّه، والتحديث اللحظي.
import '../core/style.css';
import { h, icon, clear, $, debounce } from '../core/dom.js';
import { t, setLang, getLang, onLang, pick } from '../core/i18n.js';
import { api, setOnAuthLost } from '../core/api.js';
import { loadBranding, getBranding, setTheme, getTheme, applyBranding } from '../core/theme.js';
import { connect } from '../core/ws.js';
import { popover, toast, errorState, loading, avatar } from '../core/ui.js';
import { MODULES } from '../../../shared/permissions.js';

const ROUTES = [
    [/^\/app\/?$/, 'dashboard', () => import('./pages/dashboard.js')],
    [/^\/app\/events\/new$/, 'events', () => import('./pages/event-wizard.js')],
    [/^\/app\/events\/(\d+)(?:\/(\w+))?$/, 'events', () => import('./pages/event.js')],
    [/^\/app\/events\/?$/, 'events', () => import('./pages/events.js')],
    [/^\/app\/visits(?:\/(\d+))?\/?$/, 'visits', () => import('./pages/visits.js')],
    [/^\/app\/visitors(?:\/(\d+))?\/?$/, 'visitors', () => import('./pages/visitors.js')],
    [/^\/app\/groups(?:\/(\d+))?\/?$/, 'groups', () => import('./pages/groups.js')],
    [/^\/app\/bulk\/?$/, 'bulk', () => import('./pages/bulk.js')],
    [/^\/app\/reports(?:\/(\w+))?\/?$/, 'reports', () => import('./pages/reports.js')],
    [/^\/app\/notifications\/?$/, 'notifications', () => import('./pages/notifications.js')],
    [/^\/app\/checkin\/?$/, 'checkin', () => import('./pages/checkin.js')],
    [/^\/app\/kiosk\/?$/, 'kiosk', () => import('./pages/kiosk.js')],
    [/^\/app\/badges(?:\/(\d+|new))?\/?$/, 'badges', () => import('./pages/badges.js')],
    [/^\/app\/devices\/?$/, 'devices', () => import('./pages/devices.js')],
    [/^\/app\/users(?:\/(\w+))?\/?$/, 'users', () => import('./pages/users.js')],
    [/^\/app\/forms(?:\/(\d+|new))?\/?$/, 'forms', () => import('./pages/forms.js')],
    [/^\/app\/audit\/?$/, 'audit', () => import('./pages/audit.js')],
    [/^\/app\/integrations\/?$/, 'integrations', () => import('./pages/integrations.js')],
    [/^\/app\/settings(?:\/(\w+))?\/?$/, 'settings', () => import('./pages/settings.js')],
    [/^\/app\/profile\/?$/, null, () => import('./pages/profile.js')],
];

const state = { me: null, ws: null, cleanup: null, unread: 0 };
export const can = (module, action = 'view') => !!state.me?.permissions?.[module]?.includes(action);
export const me = () => state.me;
export const ws = () => state.ws;
export function navigate(path, { replace = false } = {}) {
    if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
    route();
}

async function boot() {
    await loadBranding();
    try { state.me = await api('me'); } catch { location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`); return; }
    if (state.me.mfa) { location.replace(`/login?mfa=${state.me.mfa}&next=${encodeURIComponent(location.pathname)}`); return; }
    if (!localStorage.getItem('tz_lang') && state.me.lang) setLang(state.me.lang, { silent: true });
    setOnAuthLost(() => location.replace('/login?expired=1'));
    state.ws = connect({ onStatus: (ok) => { const d = $('#live-dot'); if (d) { d.className = `dot ${ok ? 'ok pulse' : 'bad'}`; d.title = ok ? t('common.live') : t('common.offline'); } } });
    const subs = ['dashboard'];
    if (can('notifications')) subs.push('notifications');
    if (can('devices') || can('kiosk')) subs.push('devices');
    state.ws.sub(...subs);
    state.ws.on('notification', (n) => { state.unread++; renderBell(); if (['high', 'critical'].includes(n.priority)) toast(`${t(`notif.${n.type}.title`)} — ${t(`notif.${n.type}.body`, n.params)}`, n.priority === 'critical' ? 'bad' : 'warn', 6000); });
    state.ws.on('branding', (b) => applyBranding(b));
    renderShell();
    onLang(() => { renderShell(); api('me', { method: 'PUT', body: { lang: getLang() } }).catch(() => {}); });
    window.addEventListener('popstate', route);
    document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href^="/app"]');
        if (!a || e.ctrlKey || e.metaKey || e.shiftKey || a.target === '_blank') return;
        e.preventDefault();
        navigate(a.getAttribute('href'));
    });
    refreshUnread();
}

async function refreshUnread() {
    if (!can('notifications')) return;
    try { state.unread = (await api('notifications', { query: { status: 'new', size: 1 } })).unread; renderBell(); } catch { /* ignore */ }
}
function renderBell() {
    const b = $('#bell-count');
    if (b) { b.textContent = state.unread > 99 ? '99+' : String(state.unread); b.style.display = state.unread ? '' : 'none'; }
    const n = $('#nav-count-notifications');
    if (n) { n.textContent = String(state.unread); n.style.display = state.unread ? '' : 'none'; }
}

function renderShell() {
    const b = getBranding();
    const nav = h('nav.nav', { 'aria-label': t('nav.main') }, MODULES.filter((m) => can(m.key)).map((m) =>
        h('a', { href: m.path, 'data-mod': m.key }, icon(m.icon), h('span', t(`nav.${m.key}`)), m.key === 'notifications' ? h('span.count', { id: 'nav-count-notifications', style: { display: 'none' } }) : null)));
    const sidebar = h('aside.sidebar', { id: 'sidebar' },
        h('div.brand', h('div.brand-logo', b.logo ? h('img', { src: b.logo, alt: '' }) : icon('layers')), h('div', h('div.brand-name', pick(b, 'name')), h('div.brand-tag', pick(b, 'tagline')))),
        nav, h('div.side-foot', pick(b, 'slogan')));
    const search = h('input', { type: 'search', placeholder: t('top.search'), 'aria-label': t('top.search'), autocomplete: 'off' });
    const pop = h('div.search-pop', { style: { display: 'none' }, role: 'listbox' });
    search.addEventListener('input', debounce(async () => {
        const q = search.value.trim();
        if (q.length < 2) { pop.style.display = 'none'; return; }
        try {
            const r = await api('search', { query: { q } });
            const groups = [
                ['events', r.events, (x) => [`/app/events/${x.id}`, pick(x, 'title'), 'calendar']],
                ['visits', r.visits, (x) => [`/app/visits/${x.id}`, x.title, 'briefcase']],
                ['visitors', r.visitors, (x) => [`/app/visitors/${x.id}`, `${pick(x, 'name')}${x.org_name ? ` — ${x.org_name}` : ''}`, 'user']],
                ['groups', r.groups, (x) => [`/app/groups/${x.id}`, x.name, 'layers']],
            ].filter(([, rows]) => rows?.length);
            pop.replaceChildren(...(groups.length ? groups.flatMap(([k, rows, fn]) => [h('div.grp', t(`nav.${k}`)), ...rows.map((x) => { const [href, label, ic] = fn(x); return h('a', { href, role: 'option', on: { click: () => { pop.style.display = 'none'; search.value = ''; } } }, icon(ic), label); })]) : [h('div.state', { style: { padding: '18px' } }, t('common.no_results'))]));
            pop.style.display = '';
        } catch { pop.style.display = 'none'; }
    }, 250));
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { pop.style.display = 'none'; search.blur(); } if (e.key === 'ArrowDown') pop.querySelector('a')?.focus(); });
    document.addEventListener('mousedown', (e) => { if (!pop.contains(e.target) && e.target !== search) pop.style.display = 'none'; });
    const theme = getTheme();
    const userBtn = h('button.user-btn', { type: 'button', 'aria-haspopup': 'menu', on: { click: (e) => popover(e.currentTarget, [
        h('div', { style: { padding: '8px 10px' } }, h('div', { style: { fontWeight: 600 } }, state.me.name), h('div.small.muted', state.me.email), h('div.small.faint', state.me.roles.map((r) => t(`role.${r.role}`)).join(t('common.sep')))),
        h('hr'),
        h('a', { href: '/app/profile' }, icon('user'), t('top.profile')),
        can('settings') ? h('a', { href: '/app/settings' }, icon('settings'), t('top.settings')) : null,
        h('a', { href: '/docs', target: '_blank' }, icon('file-text'), t('top.api_docs')),
        h('hr'),
        h('button', { type: 'button', on: { click: logout } }, icon('log-out'), t('top.logout')),
    ]) } }, avatar(state.me.name), h('span.uname', { style: { fontWeight: 500, fontSize: '13px' } }, state.me.name), icon('chevron-down'));
    const top = h('header.topbar',
        h('button.icon-btn.menu-toggle', { type: 'button', 'aria-label': t('top.menu'), on: { click: () => $('.shell').classList.toggle('nav-open') } }, icon('menu')),
        h('div.search', icon('search'), search, pop),
        h('div.top-actions',
            h('span.dot', { id: 'live-dot', style: { margin: '0 8px' }, class: state.ws?.alive ? 'dot ok pulse' : 'dot' }),
            h('button.icon-btn.lang-btn', { type: 'button', 'aria-label': t('top.lang'), on: { click: () => setLang(getLang() === 'ar' ? 'en' : 'ar') } }, t('common.other_lang')),
            h('button.icon-btn', { type: 'button', 'aria-label': t('top.theme'), title: t('top.theme'), on: { click: () => { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); renderShell(); } } }, icon(theme === 'dark' ? 'sun' : 'moon')),
            can('notifications') ? h('button.icon-btn', { type: 'button', 'aria-label': t('nav.notifications'), on: { click: (e) => bellMenu(e.currentTarget) } }, icon('bell'), h('span.dot', { id: 'bell-count', style: { display: 'none' } })) : null,
            userBtn));
    const content = h('main.content', { id: 'content', tabindex: '-1' });
    clear(document.getElementById('root'), h('a.skip', { href: '#content' }, t('common.skip')), h('div.shell', sidebar, h('div.main', top, content)));
    renderBell();
    route();
}

async function bellMenu(anchor) {
    const list = h('div', { style: { width: '340px', maxHeight: '420px', overflow: 'auto' } }, loading());
    popover(anchor, [list, h('hr'), h('a', { href: '/app/notifications' }, icon('list'), t('notif.view_all'))]);
    try {
        const r = await api('notifications', { query: { status: 'new', size: 8 } });
        list.replaceChildren(...(r.rows.length ? r.rows.map((n) => h('a', { href: '/app/notifications', style: { alignItems: 'flex-start' } }, h('span.dot', { class: `dot ${n.priority === 'critical' ? 'bad' : n.priority === 'high' ? 'warn' : 'info'}`, style: { marginTop: '7px' } }),
            h('div', h('div', { style: { fontWeight: 500 } }, t(`notif.${n.type}.title`)), h('div.small.muted', t(`notif.${n.type}.body`, n.params))))) : [h('div.state', { style: { padding: '20px' } }, t('notif.none'))]));
    } catch (e) { list.replaceChildren(errorState(e)); }
}

async function logout() {
    try { await api('auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
    location.replace('/login');
}

async function route() {
    const path = location.pathname.replace(/\/+$/, '') || '/app';
    let match = null;
    for (const [rx, mod, loader] of ROUTES) { const m = path.match(rx); if (m) { match = { mod, loader, params: m.slice(1) }; break; } }
    const content = $('#content');
    if (!content) return;
    state.cleanup?.();
    state.cleanup = null;
    document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', match?.mod === a.dataset.mod));
    $('.shell')?.classList.remove('nav-open');
    if (!match) { clear(content, errorState({ code: 'not_found' })); return; }
    if (match.mod && !can(match.mod)) { clear(content, errorState({ code: 'forbidden' })); return; }
    if (state.me.must_change_password && match.mod) { navigate('/app/profile', { replace: true }); return; }
    clear(content, loading());
    try {
        const page = await match.loader();
        const query = Object.fromEntries(new URLSearchParams(location.search));
        const ctx = { root: content, params: match.params, query, me: state.me, can, ws: state.ws, navigate, setTitle: (s) => { document.title = `${s} — ${pick(getBranding(), 'name')}`; } };
        ctx.setTitle(match.mod ? t(`nav.${match.mod}`) : t('top.profile'));
        clear(content);
        state.cleanup = (await page.default(ctx)) || null;
        content.focus({ preventScroll: true });
        window.scrollTo(0, 0);
    } catch (e) {
        console.error(e);
        clear(content, errorState(e, route));
    }
}

/** رأس صفحة موحّد */
export function pageHead(title, sub, actions, crumbs) {
    return h('div.page-head', h('div', crumbs ? h('div.crumbs', crumbs.map((c, i) => [i ? h('span', '/') : null, c.href ? h('a', { href: c.href }, c.label) : h('span', c.label)])) : null, h('h1', title), sub ? h('p', sub) : null), actions ? h('div.actions', actions) : null);
}

boot();
