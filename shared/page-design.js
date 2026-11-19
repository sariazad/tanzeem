// تنظيم — تصميم صفحة الفعالية والتسجيل: القيم الافتراضية، القوالب الجاهزة، والتحقق (يُستخدم في الخادم والواجهة).
// كل قيمة تمر عبر normalizeDesign: تعداد معروف، ألوان hex، أرقام محصورة، نصوص مقصوصة، وصور data: محدودة الحجم.

export const LAYOUTS = ['cover', 'split', 'card', 'minimal'];
export const BG_KINDS = ['solid', 'gradient', 'animated', 'pattern', 'image'];
export const PATTERNS = ['dots', 'grid', 'geo', 'waves'];
export const MODES = ['auto', 'light', 'dark'];
export const HERO_HEIGHTS = ['sm', 'md', 'lg', 'full'];
export const ALIGNS = ['center', 'start'];
export const FORM_STYLES = ['single', 'steps'];
export const BUTTONS = ['filled', 'outline', 'pill', 'glow'];
export const ENTRANCES = ['fade', 'slide', 'zoom', 'none'];
export const SECTION_KEYS = ['countdown', 'seats', 'about', 'highlights', 'speakers', 'location', 'custom'];
export const PAGE_FONTS = ['', 'IBM Plex Sans Arabic', 'Tajawal', 'Tahoma', 'system-ui'];
export const MAX_IMAGE_CHARS = 1_200_000; // ≈ 900 كيلوبايت بعد الترميز

export const DEFAULT_DESIGN = Object.freeze({
    layout: 'cover',
    theme: { primary: '', accent: '', mode: 'auto', radius: 16, font: '' },
    background: { kind: 'gradient', from: '#0f6e56', to: '#0b3b31', angle: 135, pattern: 'dots', image: null, overlay: 0.45 },
    hero: { cover: null, overlay: 0.45, align: 'center', height: 'md', show_logo: true, parallax: true, title_ar: '', title_en: '', subtitle_ar: '', subtitle_en: '' },
    sections: SECTION_KEYS.map((key) => ({ key, on: key !== 'custom' })),
    custom: { title_ar: '', title_en: '', body_ar: '', body_en: '' },
    form: { style: 'single', button: 'filled', cta_ar: '', cta_en: '', success_ar: '', success_en: '', confetti: true },
    motion: { entrance: 'fade', hover: true, sticky_cta: true },
    maps_url: '',
});

/** قوالب جاهزة: تُدمج فوق التصميم الحالي فتبقى النصوص والصور كما هي. */
export const PRESETS = {
    official: {
        layout: 'cover',
        theme: { primary: '#0b2e59', accent: '#b8862b', mode: 'light', radius: 10 },
        background: { kind: 'gradient', from: '#0b2e59', to: '#123f73', angle: 160 },
        hero: { align: 'center', height: 'lg', overlay: 0.55 },
        form: { style: 'single', button: 'filled', confetti: false },
        motion: { entrance: 'fade' },
    },
    students: {
        layout: 'card',
        theme: { primary: '#6d28d9', accent: '#f59e0b', mode: 'light', radius: 22 },
        background: { kind: 'animated', from: '#7c3aed', to: '#ec4899', angle: 120 },
        hero: { align: 'center', height: 'md' },
        form: { style: 'steps', button: 'glow', confetti: true },
        motion: { entrance: 'zoom' },
    },
    tech: {
        layout: 'split',
        theme: { primary: '#06b6d4', accent: '#a3e635', mode: 'dark', radius: 14 },
        background: { kind: 'pattern', from: '#0b1220', to: '#111827', pattern: 'grid', angle: 180 },
        hero: { align: 'start', height: 'md' },
        form: { style: 'steps', button: 'outline', confetti: true },
        motion: { entrance: 'slide' },
    },
    calm: {
        layout: 'minimal',
        theme: { primary: '#0f6e56', accent: '#b8862b', mode: 'light', radius: 18 },
        background: { kind: 'pattern', from: '#f6f4ef', to: '#efe9dd', pattern: 'geo', angle: 180 },
        hero: { align: 'center', height: 'sm' },
        form: { style: 'single', button: 'pill', confetti: false },
        motion: { entrance: 'fade' },
    },
};

const HEX = /^#[0-9a-f]{6}$/i;
const IMG = /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const color = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const num = (v, min, max, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.min(max, Math.max(min, Number(v))) : d);
const str = (v, max, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const image = (v) => (typeof v === 'string' && v.length <= MAX_IMAGE_CHARS && IMG.test(v) ? v : null);

/** دمج عميق بسيط: الكائنات تُدمج والمصفوفات والقيم تُستبدل. */
export function mergeDesign(base, patch) {
    const out = structuredClone(base);
    if (!isObj(patch)) return out;
    for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(out[k]) ? mergeDesign(out[k], v) : structuredClone(v);
    return out;
}

/** يحوّل أي مدخل إلى تصميم صالح كامل. */
export function normalizeDesign(input) {
    const d = DEFAULT_DESIGN;
    const i = isObj(input) ? input : {};
    const th = isObj(i.theme) ? i.theme : {}, bg = isObj(i.background) ? i.background : {}, he = isObj(i.hero) ? i.hero : {};
    const fo = isObj(i.form) ? i.form : {}, mo = isObj(i.motion) ? i.motion : {}, cu = isObj(i.custom) ? i.custom : {};
    const seen = new Set();
    const sections = (Array.isArray(i.sections) ? i.sections : [])
        .filter((s) => isObj(s) && SECTION_KEYS.includes(s.key) && !seen.has(s.key) && seen.add(s.key))
        .map((s) => ({ key: s.key, on: bool(s.on, true) }));
    for (const s of d.sections) if (!seen.has(s.key)) sections.push({ ...s });
    return {
        layout: oneOf(i.layout, LAYOUTS, d.layout),
        theme: { primary: color(th.primary, ''), accent: color(th.accent, ''), mode: oneOf(th.mode, MODES, d.theme.mode), radius: num(th.radius, 0, 32, d.theme.radius), font: oneOf(th.font, PAGE_FONTS, '') },
        background: {
            kind: oneOf(bg.kind, BG_KINDS, d.background.kind), from: color(bg.from, d.background.from), to: color(bg.to, d.background.to),
            angle: num(bg.angle, 0, 360, d.background.angle), pattern: oneOf(bg.pattern, PATTERNS, d.background.pattern), image: image(bg.image), overlay: num(bg.overlay, 0, 0.9, d.background.overlay),
        },
        hero: {
            cover: image(he.cover), overlay: num(he.overlay, 0, 0.9, d.hero.overlay), align: oneOf(he.align, ALIGNS, d.hero.align), height: oneOf(he.height, HERO_HEIGHTS, d.hero.height),
            show_logo: bool(he.show_logo, d.hero.show_logo), parallax: bool(he.parallax, d.hero.parallax),
            title_ar: str(he.title_ar, 160), title_en: str(he.title_en, 160), subtitle_ar: str(he.subtitle_ar, 400), subtitle_en: str(he.subtitle_en, 400),
        },
        sections,
        custom: { title_ar: str(cu.title_ar, 120), title_en: str(cu.title_en, 120), body_ar: str(cu.body_ar, 3000), body_en: str(cu.body_en, 3000) },
        form: {
            style: oneOf(fo.style, FORM_STYLES, d.form.style), button: oneOf(fo.button, BUTTONS, d.form.button),
            cta_ar: str(fo.cta_ar, 60), cta_en: str(fo.cta_en, 60), success_ar: str(fo.success_ar, 300), success_en: str(fo.success_en, 300), confetti: bool(fo.confetti, d.form.confetti),
        },
        motion: { entrance: oneOf(mo.entrance, ENTRANCES, d.motion.entrance), hover: bool(mo.hover, d.motion.hover), sticky_cta: bool(mo.sticky_cta, d.motion.sticky_cta) },
        maps_url: /^https:\/\/[^\s"'<>]{4,500}$/.test(String(i.maps_url || '')) ? String(i.maps_url) : '',
    };
}

/** قراءة آمنة لعمود page من قاعدة البيانات. */
export function parseDesign(raw) {
    if (!raw) return normalizeDesign({});
    try { return normalizeDesign(JSON.parse(raw)); } catch { return normalizeDesign({}); }
}
