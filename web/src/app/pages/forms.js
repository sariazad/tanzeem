// تنظيم — منشئ نماذج التسجيل الديناميكية للفعاليات والزيارات: أنواع الحقول، الإلزامي، التحقق، المنطق الشرطي، الحقول ثنائية اللغة، ورفع الصورة.
import { h, icon, clear } from '../../core/dom.js';
import { t, opt, fmtNum, getLang } from '../../core/i18n.js';
import { api, post, put, del } from '../../core/api.js';
import { toast, errText, confirm, empty } from '../../core/ui.js';
import { dataTable } from '../components/table.js';
import { pageHead } from '../main.js';

export const FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'radio', 'multi', 'checkbox', 'photo', 'national_id'];

export default async function forms(ctx) {
    if (ctx.params[0]) return builder(ctx, ctx.params[0]);
    const { root, can, navigate } = ctx;
    const tbl = dataTable({
        resource: 'forms', filters: [{ key: 'f_scope', label: t('f.scope'), options: ['event', 'visit'].map((s) => ({ value: s, label: opt('form_scope', s) })) }],
        columns: [{ key: 'name', label: t('f.name'), sort: true, render: (r) => h('b', r.name) }, { key: 'scope', label: t('f.scope'), render: (r) => h('span.chip', opt('form_scope', r.scope)) }, { key: 'field_count', label: t('forms.fields'), render: (r) => fmtNum(r.field_count ?? 0) }],
        rowClick: (r) => navigate(`/app/forms/${r.id}`),
        actions: (r) => [can('forms', 'create') ? h('button.btn.xs.ghost', { type: 'button', on: { click: async () => { const full = await api(`forms/${r.id}`); const c = await post('forms', { name: `${r.name} (${t('badges.copy')})`, scope: r.scope, fields: JSON.parse(full.fields) }); navigate(`/app/forms/${c.id}`); } } }, icon('copy')) : null,
            can('forms', 'delete') ? h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.delete'), on: { click: async () => { if (await confirm(t('common.delete_confirm'), { danger: true })) { await del(`forms/${r.id}`); tbl.reload(); } } } }, icon('trash')) : null],
        emptyTitle: t('forms.empty'),
    });
    root.append(pageHead(t('nav.forms'), t('forms.subtitle'), [can('forms', 'create') ? h('a.btn.primary', { href: '/app/forms/new' }, icon('plus'), t('forms.new')) : null]), tbl.el);
}

async function builder({ root, can, navigate }, idParam) {
    const isNew = idParam === 'new';
    const form = isNew ? { name: t('forms.untitled'), scope: 'event', fields: [{ key: 'org', type: 'text', label_ar: 'الجهة', label_en: 'Organization', required: true }] } : await api(`forms/${idParam}`).then((r) => ({ ...r, fields: JSON.parse(r.fields || '[]') }));
    const canEdit = can('forms', isNew ? 'create' : 'update');
    const st = { sel: 0 };
    const list = h('div');
    const editor = h('div');
    const preview = h('div');
    const name = h('input.input', { value: form.name, 'aria-label': t('f.name'), style: { maxWidth: '300px' } });
    const scope = h('select.select', { 'aria-label': t('f.scope'), style: { width: 'auto' } }, ['event', 'visit'].map((s) => h('option', { value: s, selected: s === form.scope }, opt('form_scope', s))));
    root.append(pageHead(t('forms.builder'), t('forms.builder_hint'), [name, scope, canEdit ? h('button.btn.primary', { type: 'button', on: { click: save } }, icon('save'), t('common.save')) : null], [{ label: t('nav.forms'), href: '/app/forms' }, { label: form.name }]),
        h('div.grid', { style: { gridTemplateColumns: '260px minmax(0,1fr) minmax(0,1fr)', alignItems: 'start' } },
            h('div.card', h('div.card-h', h('h2', t('forms.fields')), canEdit ? h('button.btn.xs.primary', { type: 'button', on: { click: addField } }, icon('plus'), t('common.add')) : null), list),
            h('div.card', h('div.card-h', h('h2', t('forms.field_settings'))), h('div.card-b', editor)),
            h('div.card', h('div.card-h', h('h2', t('forms.preview')), h('span.small.muted', getLang() === 'ar' ? 'العربية' : 'English')), h('div.card-b', preview))));

    function addField() {
        let n = form.fields.length + 1;
        while (form.fields.some((f) => f.key === `field_${n}`)) n++;
        form.fields.push({ key: `field_${n}`, type: 'text', label_ar: t('forms.new_field'), label_en: 'New field', required: false });
        st.sel = form.fields.length - 1;
        draw();
    }
    function draw() { drawList(); drawEditor(); drawPreview(); }
    function drawList() {
        clear(list, ...(form.fields.length ? form.fields.map((f, i) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderBottom: '1px solid var(--border)', background: i === st.sel ? 'var(--primary-50)' : '', cursor: 'pointer' }, on: { click: () => { st.sel = i; draw(); } } },
            h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 500 } }, f[`label_${getLang()}`] || f.key, f.required ? h('span.req', { style: { color: 'var(--bad)' } }, ' *') : null), h('div.small.muted', `${t(`forms.t_${f.type}`)}${f.show_if ? ' · ' + t('forms.conditional') : ''}`)),
            canEdit ? [h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('badges.forward'), disabled: i === 0, on: { click: (e) => { e.stopPropagation(); [form.fields[i - 1], form.fields[i]] = [form.fields[i], form.fields[i - 1]]; st.sel = i - 1; draw(); } } }, icon('chevron-up')),
                h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('badges.backward'), disabled: i === form.fields.length - 1, on: { click: (e) => { e.stopPropagation(); [form.fields[i + 1], form.fields[i]] = [form.fields[i], form.fields[i + 1]]; st.sel = i + 1; draw(); } } }, icon('chevron-down'))] : null)) : [empty(t('forms.no_fields'))]));
    }
    function drawEditor() {
        const f = form.fields[st.sel];
        if (!f) return clear(editor, h('div.muted', t('forms.pick_field')));
        const inp = (k, label, attrs = {}) => h('div.field', h('label', label), h('input.input', { value: f[k] ?? '', disabled: !canEdit, ...attrs, on: { input: (e) => { f[k] = attrs.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value; drawPreview(); if (k.startsWith('label')) drawListOnly(); } } }));
        const others = form.fields.filter((x) => x !== f && ['select', 'radio', 'checkbox'].includes(x.type));
        clear(editor, h('div', { style: { display: 'grid', gap: '12px' } },
            h('div.form-grid',
                h('div.field', h('label', t('forms.type')), h('select.select', { disabled: !canEdit, on: { change: (e) => { f.type = e.target.value; if (['select', 'radio', 'multi'].includes(f.type) && !f.options) f.options = [{ value: 'a', label_ar: 'خيار 1', label_en: 'Option 1' }]; draw(); } } }, FIELD_TYPES.map((x) => h('option', { value: x, selected: x === f.type }, t(`forms.t_${x}`))))),
                inp('key', t('forms.key'), { dir: 'ltr', pattern: '[a-z0-9_]+' }),
                inp('label_ar', t('forms.label_ar')), inp('label_en', t('forms.label_en'), { dir: 'ltr' }),
                ['text', 'textarea', 'email', 'phone', 'number'].includes(f.type) ? [inp('placeholder_ar', t('forms.placeholder_ar')), inp('placeholder_en', t('forms.placeholder_en'), { dir: 'ltr' })] : null,
                f.type === 'number' ? [inp('min', t('forms.min'), { type: 'number' }), inp('max', t('forms.max'), { type: 'number' })] : null,
                f.type === 'text' || f.type === 'national_id' ? h('div.field.wide', h('label', t('forms.pattern')), h('input.input', { value: f.pattern || '', dir: 'ltr', placeholder: f.type === 'national_id' ? '[12]\\d{9}' : '', disabled: !canEdit, on: { input: (e) => { f.pattern = e.target.value || undefined; } } }), h('div.hint', t('forms.pattern_hint'))) : null),
            h('label.check', h('input', { type: 'checkbox', checked: !!f.required, disabled: !canEdit, on: { change: (e) => { f.required = e.target.checked; draw(); } } }), t('forms.required')),
            ['select', 'radio', 'multi'].includes(f.type) ? h('div', h('div.label', { style: { marginBottom: '6px' } }, t('forms.options')),
                (f.options || []).map((o, i) => h('div', { style: { display: 'grid', gridTemplateColumns: '0.8fr 1.2fr 1.2fr auto', gap: '6px', marginBottom: '6px' } },
                    h('input.input', { value: o.value, dir: 'ltr', 'aria-label': t('forms.opt_value'), disabled: !canEdit, on: { input: (e) => { o.value = e.target.value; drawPreview(); } } }),
                    h('input.input', { value: o.label_ar, 'aria-label': t('forms.label_ar'), disabled: !canEdit, on: { input: (e) => { o.label_ar = e.target.value; drawPreview(); } } }),
                    h('input.input', { value: o.label_en, dir: 'ltr', 'aria-label': t('forms.label_en'), disabled: !canEdit, on: { input: (e) => { o.label_en = e.target.value; drawPreview(); } } }),
                    h('button.btn.icon.ghost', { type: 'button', 'aria-label': t('common.remove'), disabled: !canEdit, on: { click: () => { f.options.splice(i, 1); drawEditor(); drawPreview(); } } }, icon('x')))),
                canEdit ? h('button.btn.sm', { type: 'button', on: { click: () => { const n = (f.options || []).length + 1; (f.options ||= []).push({ value: `opt${n}`, label_ar: `خيار ${n}`, label_en: `Option ${n}` }); drawEditor(); drawPreview(); } } }, icon('plus'), t('forms.add_option')) : null) : null,
            h('div', h('div.label', { style: { marginBottom: '6px' } }, t('forms.condition')), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } },
                h('select.select', { disabled: !canEdit, 'aria-label': t('forms.condition'), on: { change: (e) => { f.show_if = e.target.value ? { field: e.target.value, equals: f.show_if?.equals ?? '' } : undefined; draw(); } } }, h('option', { value: '' }, t('forms.always_show')), others.map((x) => h('option', { value: x.key, selected: f.show_if?.field === x.key }, x[`label_${getLang()}`] || x.key))),
                f.show_if ? h('input.input', { value: f.show_if.equals, placeholder: t('forms.equals'), disabled: !canEdit, on: { input: (e) => { f.show_if.equals = e.target.value; drawPreview(); } } }) : h('div'))),
            canEdit ? h('button.btn.sm.danger', { type: 'button', style: { justifySelf: 'start' }, on: { click: () => { form.fields.splice(st.sel, 1); st.sel = Math.max(0, st.sel - 1); draw(); } } }, icon('trash'), t('forms.delete_field')) : null));
    }
    const drawListOnly = () => drawList();
    const answers = {};
    function drawPreview() {
        const L = getLang();
        clear(preview, h('div', { style: { display: 'grid', gap: '12px' } }, form.fields.filter((f) => !f.show_if || String(answers[f.show_if.field] ?? '') === String(f.show_if.equals)).map((f) => {
            const label = h('label', f[`label_${L}`] || f.key, f.required ? h('span.req', ' *') : null);
            const ph = f[`placeholder_${L}`] || '';
            let input;
            if (f.type === 'textarea') input = h('textarea.textarea', { placeholder: ph });
            else if (f.type === 'select') input = h('select.select', { on: { change: (e) => { answers[f.key] = e.target.value; drawPreview(); } } }, h('option', { value: '' }, '—'), (f.options || []).map((o) => h('option', { value: o.value, selected: answers[f.key] === o.value }, o[`label_${L}`])));
            else if (f.type === 'radio') input = h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } }, (f.options || []).map((o) => h('label.check', h('input', { type: 'radio', name: `pv-${f.key}`, checked: answers[f.key] === o.value, on: { change: () => { answers[f.key] = o.value; drawPreview(); } } }), o[`label_${L}`])));
            else if (f.type === 'multi') input = h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } }, (f.options || []).map((o) => h('label.check', h('input', { type: 'checkbox' }), o[`label_${L}`])));
            else if (f.type === 'checkbox') return h('label.check', h('input', { type: 'checkbox', checked: answers[f.key] === 'true', on: { change: (e) => { answers[f.key] = String(e.target.checked); drawPreview(); } } }), f[`label_${L}`], f.required ? h('span.req', { style: { color: 'var(--bad)' } }, ' *') : null);
            else if (f.type === 'photo') input = h('div.btn', { style: { justifySelf: 'start' } }, icon('camera'), t('forms.t_photo'));
            else input = h('input.input', { type: { email: 'email', phone: 'tel', number: 'number', date: 'date' }[f.type] || 'text', placeholder: ph, dir: ['email', 'phone', 'national_id'].includes(f.type) ? 'ltr' : null });
            return h('div.field', label, input);
        })));
    }
    async function save() {
        const keys = form.fields.map((f) => f.key);
        if (keys.some((k) => !/^[a-z0-9_]+$/i.test(k)) || new Set(keys).size !== keys.length) return toast(t('forms.bad_keys'), 'bad');
        try {
            const body = { name: name.value.trim() || form.name, scope: scope.value, fields: form.fields };
            const r = isNew ? await post('forms', body) : await put(`forms/${form.id}`, body);
            toast(t('common.saved'), 'ok');
            if (isNew) navigate(`/app/forms/${r.id}`, { replace: true });
        } catch (e) { toast(errText(e), 'bad'); }
    }
    draw();
}
