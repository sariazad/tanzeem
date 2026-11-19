// تنظيم — نماذج مولّدة من تعريف الموارد، ونافذة إنشاء/تعديل موحّدة مع عرض أخطاء التحقق بجانب الحقول.
import { h, icon, readFileAsDataUrl } from '../../core/dom.js';
import { t, opt, toLocalInput, fromLocalInput, pick } from '../../core/i18n.js';
import { api } from '../../core/api.js';
import { dialog, toast, errText } from '../../core/ui.js';
import { RESOURCES } from '../../../../shared/resources.js';

/** مفتاح الترجمة لخيارات حقل (لتفادي تعارض «status» بين الموارد) */
export function optKey(resource, key) {
    const map = { 'visits.status': 'visit_status', 'devices.status': 'device_status', 'devices.kind': 'device_kind', 'zones.kind': 'zone_kind', 'events.type': 'event_type', 'groups.kind': 'group_kind', 'report_schedules.report': 'report', 'report_schedules.frequency': 'frequency', 'forms.scope': 'form_scope', 'visitors.category': 'category' };
    return map[`${resource}.${key}`] || key;
}

// تخزين قصير فقط (20 ثانية) حتى تظهر الفعاليات والقاعات الجديدة دون إعادة تحميل الصفحة.
const refCache = new Map();
const REF_TTL = 20_000;
export async function refOptions(ref, force = false) {
    const hit = refCache.get(ref);
    if (!force && hit && Date.now() - hit.at < REF_TTL) return hit.p;
    const p = (async () => {
        if (ref === 'users') return (await api('users', { query: { size: 200 } })).rows.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }));
        const d = RESOURCES[ref];
        const res = await api(`options/${ref}`);
        return res.rows.map((r) => ({ value: r.id, label: d.label.endsWith('_ar') ? pick(r, d.label.slice(0, -3)) : r[d.label] }));
    })();
    refCache.set(ref, { p, at: Date.now() });
    p.catch(() => refCache.delete(ref));
    return p;
}
export const invalidateRef = (ref) => refCache.delete(ref);

/** يبني حقلاً واحداً؛ يعيد { el, get(), setError(code) } */
export function fieldInput(resource, f, value) {
    const id = `f-${resource}-${f.key}-${Math.random().toString(36).slice(2, 7)}`;
    const label = f.label || t(`f.${f.key}`);
    const err = h('div.err', { id: `${id}-err`, role: 'alert' });
    let input, get;
    const common = { id, name: f.key, 'aria-describedby': `${id}-err`, required: !!f.req };
    switch (f.type) {
        case 'textarea': input = h('textarea.textarea', { ...common, rows: 3 }); input.value = value ?? ''; get = () => input.value; break;
        case 'int': case 'number': input = h('input.input', { ...common, type: 'number', step: f.type === 'int' ? '1' : 'any', min: f.min, max: f.max, dir: 'ltr' }); input.value = value ?? ''; get = () => (input.value === '' ? null : Number(input.value)); break;
        case 'bool': {
            input = h('input', { ...common, type: 'checkbox', checked: !!value });
            const sw = h('label.check', h('span.switch', input, h('span')), h('span', label));
            return { el: h('div.field', sw, err), get: () => (input.checked ? 1 : 0), setError: (c) => { err.textContent = c ? t(`errors.${c}`) : ''; }, key: f.key, input };
        }
        case 'select': input = h('select.select', common, h('option', { value: '' }, '—'), f.opts.map((o) => h('option', { value: o, selected: o === value }, opt(optKey(resource, f.key), o)))); get = () => input.value || null; break;
        case 'datetime': input = h('input.input', { ...common, type: 'datetime-local', value: toLocalInput(value), dir: 'ltr' }); get = () => fromLocalInput(input.value); break;
        case 'date': input = h('input.input', { ...common, type: 'date', value: value || '', dir: 'ltr' }); get = () => input.value || null; break;
        case 'email': input = h('input.input', { ...common, type: 'email', value: value || '', dir: 'ltr', autocomplete: 'off' }); get = () => input.value.trim(); break;
        case 'phone': input = h('input.input', { ...common, type: 'tel', value: value || '', dir: 'ltr', placeholder: '05XXXXXXXX' }); get = () => input.value.trim(); break;
        case 'color': input = h('input.input', { ...common, type: 'color', value: value || '#0f6e56', style: { padding: '2px', width: '72px' } }); get = () => input.value; break;
        case 'secret': input = h('input.input', { ...common, type: 'password', autocomplete: 'off', dir: 'ltr', placeholder: f.placeholder || t('common.unchanged') }); get = () => (input.value === '' ? undefined : input.value); break;
        case 'tags': input = h('input.input', { ...common, value: value || '', placeholder: t('common.tags_hint') }); get = () => input.value; break;
        case 'image': {
            let cur = value && value !== '__omitted__' ? value : null;
            let changed = false;
            const prev = h('div', { style: { width: '72px', height: '72px', borderRadius: '10px', background: 'var(--neutral-bg)', overflow: 'hidden', display: 'grid', placeItems: 'center' } });
            const show = () => prev.replaceChildren(cur ? h('img', { src: cur, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover' } }) : icon('image'));
            show();
            const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id, on: { change: async (e) => { const fl = e.target.files[0]; if (fl) { cur = await readFileAsDataUrl(fl, 600); changed = true; show(); } } } });
            input = h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, prev, h('div.actions', file, cur || value === '__omitted__' ? h('button.btn.xs', { type: 'button', on: { click: () => { cur = null; changed = true; show(); } } }, t('common.remove')) : null));
            if (value === '__omitted__') prev.replaceChildren(icon('check'));
            get = () => (changed ? cur : undefined);
            break;
        }
        case 'ref': {
            input = h('select.select', common, h('option', { value: '' }, t('common.loading')));
            refOptions(f.ref).then((opts) => { input.replaceChildren(h('option', { value: '' }, '—'), ...opts.map((o) => h('option', { value: o.value, selected: Number(value) === o.value }, o.label))); }).catch(() => input.replaceChildren(h('option', { value: '' }, `— ${t('scan.network')} —`)));
            get = () => (input.value ? Number(input.value) : null);
            break;
        }
        case 'refs': {
            const selected = new Set((Array.isArray(value) ? value : JSON.parse(value || '[]')).map(Number));
            input = h('div', { style: { maxHeight: '150px', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '9px', padding: '6px 10px' } }, t('common.loading'));
            refOptions(f.ref).then((opts) => input.replaceChildren(...opts.map((o) => h('label.check', { style: { display: 'flex', padding: '3px 0' } }, h('input', { type: 'checkbox', checked: selected.has(o.value), on: { change: (e) => (e.target.checked ? selected.add(o.value) : selected.delete(o.value)) } }), o.label))));
            get = () => [...selected];
            break;
        }
        default: input = h('input.input', { ...common, value: value ?? '' }); get = () => input.value;
    }
    const el = h(`div.field${f.wide || ['textarea', 'refs', 'image'].includes(f.type) ? '.wide' : ''}`, h('label', { for: id }, label, f.req ? h('span.req', ' *') : null), input, f.hint ? h('div.hint', f.hint) : null, err);
    return { el, get, setError: (c) => { err.textContent = c ? t(`errors.${c}`) : ''; input.classList?.toggle('invalid', !!c); }, key: f.key, input };
}

/** نموذج كامل لمورد */
export function resourceForm(resource, values = {}, { only, exclude = [], extra = [] } = {}) {
    const d = RESOURCES[resource];
    const fields = [...d.fields.filter((f) => f.form !== false && !(f.ro && !f.virtual) && !exclude.includes(f.key) && (!only || only.includes(f.key))), ...extra];
    const inputs = fields.map((f) => fieldInput(resource, f, values[f.key]));
    const el = h('div.form-grid', inputs.map((i) => i.el));
    return {
        el,
        values() { const o = {}; for (const i of inputs) { const v = i.get(); if (v !== undefined) o[i.key] = v; } return o; },
        setErrors(errors = []) { for (const i of inputs) i.setError(null); for (const e of errors) inputs.find((i) => i.key === e.field)?.setError(e.code); inputs.find((i) => errors.some((e) => e.field === i.key))?.input?.focus?.(); },
    };
}

/** نافذة إنشاء/تعديل لمورد. تعيد السجل المحفوظ أو null */
export function editResource(resource, row = null, { title, defaults = {}, only, exclude, extra, size } = {}) {
    const form = resourceForm(resource, { ...defaults, ...(row || {}) }, { only, exclude, extra });
    return dialog({
        title: title || t(row ? 'common.edit_x' : 'common.new_x', { x: t(`res.${resource}`) }), size, body: form.el,
        footer: [
            { label: t('common.cancel'), value: null },
            { label: t('common.save'), kind: 'primary', icon: 'save', onClick: async (close) => {
                try {
                    const body = { ...defaults, ...form.values() };
                    const saved = row ? await api(`${resource}/${row.id}`, { method: 'PUT', body }) : await api(resource, { method: 'POST', body });
                    invalidateRef(resource);
                    toast(t('common.saved'), 'ok');
                    close(saved);
                } catch (e) { form.setErrors(e.errors); if (!e.errors?.length) toast(errText(e), 'bad'); }
            } },
        ],
    });
}
