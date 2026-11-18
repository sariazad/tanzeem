// تنظيم — الترجمة والتنسيق: كل نص في ملفات ar.js و en.js، والتواريخ ميلادية/هجرية حسب الإعداد، والأرقام حسب اللغة.
import ar from './i18n/ar.js';
import en from './i18n/en.js';

const DICTS = { ar, en };
const store = (() => { try { return window.localStorage; } catch { return null; } })();
let lang = store?.getItem('tz_lang') || document.documentElement.lang || 'ar';
if (!DICTS[lang]) lang = 'ar';
let calendar = 'both';
const listeners = new Set();

const lookup = (dict, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict);

export function t(key, params) {
    let s = lookup(DICTS[lang], key);
    if (s == null) s = lookup(DICTS[lang === 'ar' ? 'en' : 'ar'], key);
    if (s == null) return key;
    if (params) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
    return s;
}
export const has = (key) => lookup(DICTS[lang], key) != null;
export const getLang = () => lang;
export const isRtl = () => lang === 'ar';
export const dir = () => (lang === 'ar' ? 'rtl' : 'ltr');
/** حقل ثنائي اللغة من سجل: pick(row, 'title') → title_ar أو title_en */
export const pick = (row, base) => (row ? (lang === 'en' ? row[`${base}_en`] || row[`${base}_ar`] : row[`${base}_ar`] || row[`${base}_en`]) ?? row[base] ?? '' : '');
export const opt = (field, value) => (value == null || value === '' ? '' : t(`opt.${field}.${value}`));
export const f = (key) => t(`f.${key}`);

export function setLang(l, { silent } = {}) {
    if (!DICTS[l]) return;
    lang = l;
    store?.setItem('tz_lang', l);
    apply();
    if (!silent) for (const fn of listeners) fn(l);
}
export function apply() {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir();
}
export const onLang = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const setCalendar = (c) => { calendar = c || 'both'; };

const TZ = 'Asia/Riyadh';
const loc = () => (lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB');
const valid = (v) => { if (!v) return null; const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : v); return Number.isNaN(d.getTime()) ? null : d; };

export function fmtDate(v, { weekday = false, hijri } = {}) {
    const d = valid(v);
    if (!d) return '—';
    const useH = hijri ?? (calendar === 'hijri' || (calendar === 'both' && lang === 'ar'));
    const g = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB-u-ca-gregory', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', ...(weekday ? { weekday: 'long' } : {}) }).format(d);
    if (calendar === 'gregory' || !useH) return g;
    const hj = new Intl.DateTimeFormat(`${lang === 'ar' ? 'ar-SA' : 'en'}-u-ca-islamic-umalqura-nu-latn`, { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    return calendar === 'hijri' ? hj : `${g} · ${hj}`;
}
export const fmtTime = (v) => { const d = valid(v); return d ? new Intl.DateTimeFormat(loc(), { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: lang === 'ar' }).format(d) : '—'; };
export const fmtDateTime = (v) => { const d = valid(v); return d ? `${fmtDate(d, { hijri: false })} · ${fmtTime(d)}` : '—'; };
export const fmtShortDate = (v) => { const d = valid(v); return d ? new Intl.DateTimeFormat(loc(), { timeZone: TZ, day: 'numeric', month: 'short' }).format(d) : '—'; };
export const fmtNum = (n, o = {}) => (n == null || Number.isNaN(Number(n)) ? '—' : new Intl.NumberFormat(loc(), o).format(Number(n)));
export const fmtPct = (n) => (n == null ? '—' : `${fmtNum(n)}%`);
export function fmtAgo(v) {
    const d = valid(v);
    if (!d) return '—';
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(lang === 'ar' ? 'ar' : 'en', { numeric: 'auto' });
    if (Math.abs(s) < 60) return rtf.format(-s, 'second');
    if (Math.abs(s) < 3600) return rtf.format(-Math.round(s / 60), 'minute');
    if (Math.abs(s) < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    return rtf.format(-Math.round(s / 86400), 'day');
}
/** قيمة لحقل datetime-local (بتوقيت الرياض) */
export function toLocalInput(v) {
    const d = valid(v);
    if (!d) return '';
    const r = new Date(d.getTime() + 3 * 3600_000);
    return r.toISOString().slice(0, 16);
}
export const fromLocalInput = (s) => (s ? new Date(`${s}:00+03:00`).toISOString() : null);

apply();
