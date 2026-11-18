// تنظيم — تطبيق الهوية البصرية للجهة (الألوان، الخط، الزوايا، الشعار) والوضع الداكن.
import { setCalendar } from './i18n.js';

const store = (() => { try { return window.localStorage; } catch { return null; } })();
let branding = null;

export function applyBranding(b) {
    branding = b;
    const r = document.documentElement.style;
    if (b.primary) r.setProperty('--primary', b.primary);
    if (b.accent) r.setProperty('--accent', b.accent);
    if (b.sidebar) r.setProperty('--sidebar', b.sidebar);
    if (b.radius != null) r.setProperty('--radius', `${b.radius}px`);
    if (b.font) r.setProperty('--font', `'${b.font}', 'IBM Plex Sans Arabic', Tahoma, system-ui, sans-serif`);
    setCalendar(b.calendar);
    const ico = document.querySelector('link[rel=icon]');
    if (ico && b.logo) ico.href = b.logo;
}
export const getBranding = () => branding || {};
export async function loadBranding() {
    try { applyBranding(await (await fetch('/api/public/branding')).json()); } catch { applyBranding({}); }
    return branding;
}
export function getTheme() { return store?.getItem('tz_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
export function setTheme(t) { store?.setItem('tz_theme', t); document.documentElement.dataset.theme = t; }
setTheme(getTheme());
