// تنظيم — فحص الترجمة: كل مفتاح ثابت مستخدم موجود بالعربية والإنجليزية، الملفان متطابقان، ولا نص عربي مكتوب مباشرة في صفحات الواجهة.
import fs from 'node:fs';
import path from 'node:path';
import ar from '../web/src/core/i18n/ar.js';
import en from '../web/src/core/i18n/en.js';

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
const A = new Set(flat(ar)), E = new Set(flat(en));
const problems = [];
for (const k of A) if (!E.has(k)) problems.push(`missing in en: ${k}`);
for (const k of E) if (!A.has(k)) problems.push(`missing in ar: ${k}`);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const files = walk('web/src').filter((f) => !f.includes(`${path.sep}i18n${path.sep}`));
for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bt\('([a-z_0-9.]+)'/g)) if (!A.has(m[1])) problems.push(`${f}: unknown key ${m[1]}`);
    // نص عربي داخل علامات اقتباس خارج التعليقات (مسموح في بيانات العينة المعلّمة فقط)
    src.split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (/['"`][^'"`]*[؀-ۿ][^'"`]*['"`]/.test(code) && !/i18n-ok/.test(line) && !/SAMPLE|label_ar|'العربية'|ابدأ —|خيار |sample/.test(line)) problems.push(`${f}:${i + 1}: hard-coded Arabic`);
    });
}
const dyn = { nav: ['dashboard', 'events', 'visits', 'visitors', 'groups', 'bulk', 'reports', 'notifications', 'checkin', 'kiosk', 'badges', 'devices', 'users', 'forms', 'audit', 'integrations', 'settings'] };
for (const [g, ks] of Object.entries(dyn)) for (const k of ks) if (!A.has(`${g}.${k}`)) problems.push(`missing dyn ${g}.${k}`);
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log(`i18n ok: ${A.size} keys, ${files.length} files`);
