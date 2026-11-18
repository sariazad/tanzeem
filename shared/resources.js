// تنظيم — تعريف الموارد: منه يولّد الخادم الـ REST API ووثيقة OpenAPI، وتولّد الواجهة الجداول والنماذج.
// كل حقل: key, type, req (إلزامي), list (عمود في الجدول), search (يدخل في البحث), filter (فلتر), ro (للقراءة فقط),
// form:false (لا يظهر في نموذج التحرير العام), opts (خيارات select), ref (مورد مرتبط).
// النصوص الظاهرة من ملفات الترجمة: f.<key> و opt.<key>.<value>.

export const EVENT_TYPES = ['students', 'guests', 'official'];
export const EVENT_STATUSES = ['draft', 'published', 'running', 'ended', 'cancelled'];
export const VISIT_STATUSES = ['requested', 'approved', 'permit_issued', 'checked_in', 'checked_out', 'rejected', 'cancelled'];
export const VISITOR_CATEGORIES = ['vip', 'guest', 'student', 'staff', 'media', 'speaker', 'contractor'];
export const ZONE_KINDS = ['stage', 'registration', 'hall', 'services', 'entrance', 'exhibition', 'vip', 'other'];
export const DEVICE_KINDS = ['kiosk', 'printer', 'scanner', 'checkin', 'gate'];
export const DEVICE_STATUSES = ['pending', 'online', 'offline', 'error', 'paper_low'];
export const INVITATION_STATUSES = ['pending', 'sent', 'confirmed', 'declined', 'cancelled', 'expired', 'failed'];
export const NOTIF_PRIORITIES = ['low', 'medium', 'high', 'critical'];
export const NOTIF_STATUSES = ['new', 'ack', 'resolved'];
export const REPORTS = ['attendance', 'timings', 'participation', 'performance', 'visits', 'visitors', 'devices'];

const T = (key, extra = {}) => ({ key, type: 'text', ...extra });

export const RESOURCES = {
    orgs: {
        table: 'orgs', module: 'users', sort: 'name_ar', label: 'name_ar',
        fields: [T('name_ar', { req: 1, list: 1, search: 1 }), T('name_en', { list: 1, search: 1 }), T('code', { list: 1, search: 1 }),
            { key: 'parent_id', type: 'ref', ref: 'orgs', list: 1 }],
    },
    venues: {
        table: 'venues', module: 'events', sort: 'name_ar', label: 'name_ar',
        fields: [T('name_ar', { req: 1, list: 1, search: 1 }), T('name_en', { list: 1, search: 1 }), T('address', { list: 1 }),
            { key: 'map_w', type: 'int', min: 200, max: 5000 }, { key: 'map_h', type: 'int', min: 200, max: 5000 },
            { key: 'map_bg', type: 'image', form: false, maxKb: 1500, svg: true }],
    },
    zones: {
        table: 'zones', module: 'events', sort: 'id', label: 'name_ar',
        fields: [{ key: 'venue_id', type: 'ref', ref: 'venues', req: 1, list: 1, filter: 1 }, T('name_ar', { req: 1, list: 1, search: 1 }), T('name_en', { list: 1 }),
            { key: 'kind', type: 'select', opts: ZONE_KINDS, list: 1, filter: 1 }, { key: 'capacity', type: 'int', min: 0, list: 1 },
            { key: 'x', type: 'number', form: false }, { key: 'y', type: 'number', form: false }, { key: 'w', type: 'number', form: false }, { key: 'h', type: 'number', form: false },
            { key: 'color', type: 'color' }],
    },
    speakers: {
        table: 'speakers', module: 'events', sort: 'name_ar', label: 'name_ar',
        fields: [T('name_ar', { req: 1, list: 1, search: 1 }), T('name_en', { list: 1, search: 1 }), T('title', { list: 1 }), T('org_name', { list: 1, search: 1 }), { key: 'bio', type: 'textarea' }],
    },
    events: {
        table: 'events', module: 'events', sort: 'starts_at', dir: 'desc', label: 'title_ar', scope: 'org',
        fields: [
            T('title_ar', { req: 1, list: 1, search: 1 }), T('title_en', { search: 1 }),
            { key: 'org_id', type: 'ref', ref: 'orgs', list: 1, filter: 1 },
            { key: 'type', type: 'select', opts: EVENT_TYPES, req: 1, list: 1, filter: 1 },
            { key: 'status', type: 'select', opts: EVENT_STATUSES, list: 1, filter: 1 },
            { key: 'starts_at', type: 'datetime', req: 1, list: 1 }, { key: 'ends_at', type: 'datetime', req: 1 },
            { key: 'venue_id', type: 'ref', ref: 'venues' }, T('location', { search: 1 }),
            { key: 'capacity', type: 'int', min: 0, list: 1 }, T('audience'), { key: 'description', type: 'textarea' },
            { key: 'form_id', type: 'ref', ref: 'forms' }, { key: 'badge_template_id', type: 'ref', ref: 'badge_templates' },
            { key: 'organizer_id', type: 'ref', ref: 'users' }, { key: 'open_registration', type: 'bool' },
            { key: 'archived', type: 'bool', form: false, filter: 1 },
        ],
    },
    event_sessions: {
        table: 'event_sessions', module: 'events', sort: 'starts_at', label: 'title_ar', parent: 'event_id',
        fields: [{ key: 'event_id', type: 'ref', ref: 'events', req: 1, form: false, filter: 1 }, { key: 'day', type: 'int', min: 1, max: 30, list: 1, filter: 1 },
            T('track', { list: 1, filter: 1 }), T('title_ar', { req: 1, list: 1, search: 1 }), T('title_en', { search: 1 }),
            { key: 'starts_at', type: 'datetime', req: 1, list: 1 }, { key: 'ends_at', type: 'datetime', req: 1 }, T('hall', { list: 1, filter: 1 }),
            { key: 'speaker_ids', type: 'refs', ref: 'speakers' }, { key: 'featured', type: 'bool', list: 1, filter: 1 }],
    },
    visits: {
        table: 'visits', module: 'visits', sort: 'starts_at', dir: 'desc', label: 'title', scope: 'org',
        fields: [T('title', { req: 1, list: 1, search: 1 }), { key: 'org_id', type: 'ref', ref: 'orgs', list: 1, filter: 1 }, { key: 'purpose', type: 'textarea' },
            T('host_name', { list: 1, search: 1 }), { key: 'host_user_id', type: 'ref', ref: 'users' }, T('location', { list: 1 }),
            { key: 'starts_at', type: 'datetime', req: 1, list: 1 }, { key: 'ends_at', type: 'datetime', req: 1 },
            { key: 'status', type: 'select', opts: VISIT_STATUSES, list: 1, filter: 1, ro: 1 }, { key: 'form_id', type: 'ref', ref: 'forms' },
            { key: 'notes', type: 'textarea' }],
    },
    visitors: {
        table: 'visitors', module: 'visitors', sort: 'id', dir: 'desc', label: 'name_ar',
        fields: [T('name_ar', { req: 1, list: 1, search: 1 }), T('name_en', { search: 1 }), T('org_name', { list: 1, search: 1 }), T('job_title'),
            { key: 'category', type: 'select', opts: VISITOR_CATEGORIES, list: 1, filter: 1 },
            { key: 'phone', type: 'phone', list: 1, search: 1 }, { key: 'email', type: 'email', search: 1 },
            { key: 'national_id', type: 'secret', virtual: 1 }, { key: 'national_id_last4', type: 'text', ro: 1, form: false },
            { key: 'photo', type: 'image', maxKb: 400 }, { key: 'interests', type: 'tags' },
            { key: 'blocked', type: 'bool', list: 1, filter: 1 }, T('block_reason')],
    },
    groups: {
        table: 'groups', module: 'groups', sort: 'id', dir: 'desc', label: 'name',
        fields: [T('name', { req: 1, list: 1, search: 1 }), { key: 'kind', type: 'select', opts: ['delegation', 'cohort', 'org', 'other'], list: 1, filter: 1 },
            { key: 'org_id', type: 'ref', ref: 'orgs', list: 1 }, { key: 'notes', type: 'textarea' }],
    },
    badge_templates: {
        table: 'badge_templates', module: 'badges', sort: 'id', label: 'name',
        fields: [T('name', { req: 1, list: 1, search: 1 }), { key: 'width_mm', type: 'number', min: 20, max: 300, list: 1 }, { key: 'height_mm', type: 'number', min: 20, max: 300, list: 1 },
            { key: 'design', type: 'json', form: false }, { key: 'is_default', type: 'bool', list: 1 }],
    },
    forms: {
        table: 'forms', module: 'forms', sort: 'id', label: 'name',
        fields: [T('name', { req: 1, list: 1, search: 1 }), { key: 'scope', type: 'select', opts: ['event', 'visit'], list: 1, filter: 1 }, { key: 'fields', type: 'json', form: false }],
    },
    devices: {
        table: 'devices', module: 'devices', sort: 'id', label: 'name',
        fields: [T('name', { req: 1, list: 1, search: 1 }), { key: 'kind', type: 'select', opts: DEVICE_KINDS, req: 1, list: 1, filter: 1 }, T('location', { list: 1 }),
            { key: 'status', type: 'select', opts: DEVICE_STATUSES, ro: 1, list: 1, filter: 1 }, T('version', { ro: 1, list: 1 }),
            { key: 'event_id', type: 'ref', ref: 'events' }, { key: 'printer_id', type: 'ref', ref: 'devices' }, { key: 'zone_id', type: 'ref', ref: 'zones' }, T('gate'),
            { key: 'config', type: 'json', form: false }],
    },
    report_schedules: {
        table: 'report_schedules', module: 'reports', sort: 'id', label: 'name',
        fields: [T('name', { req: 1, list: 1 }), { key: 'report', type: 'select', opts: REPORTS, req: 1, list: 1 },
            { key: 'frequency', type: 'select', opts: ['daily', 'weekly', 'monthly'], list: 1 }, { key: 'hour', type: 'int', min: 0, max: 23 },
            T('recipients', { req: 1, list: 1 }), { key: 'format', type: 'select', opts: ['xlsx', 'csv'] }, { key: 'enabled', type: 'bool', list: 1 },
            { key: 'params', type: 'json', form: false }],
    },
};

/** يحوّل قيمة الحقل لقيمة صالحة للتخزين، أو يرمي { field, code }. */
export function coerce(field, raw) {
    const v = raw === undefined ? undefined : raw;
    const bad = (code) => { throw Object.assign(new Error(code), { field: field.key, code, status: 422 }); };
    if (v === undefined) return undefined;
    if (v === null || v === '') {
        if (field.req) bad('required');
        if (field.type === 'bool') return 0;
        return null;
    }
    switch (field.type) {
        case 'text': case 'secret': { const s = String(v).trim(); if (s.length > 500) bad('too_long'); if (field.req && !s) bad('required'); return s; }
        case 'textarea': { const s = String(v); if (s.length > 10000) bad('too_long'); return s; }
        case 'int': case 'number': case 'ref': {
            const n = Number(v);
            if (!Number.isFinite(n)) bad('number');
            if (field.type !== 'number' && !Number.isInteger(n)) bad('number');
            if (field.min != null && n < field.min) bad('min');
            if (field.max != null && n > field.max) bad('max');
            return n;
        }
        case 'bool': return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
        case 'select': if (!field.opts.includes(String(v))) bad('option'); return String(v);
        case 'datetime': case 'date': { const d = new Date(v); if (Number.isNaN(d.getTime())) bad('date'); return field.type === 'date' ? d.toISOString().slice(0, 10) : d.toISOString(); }
        case 'email': { const s = String(v).trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) bad('email'); return s; }
        case 'phone': { const s = String(v).replace(/[\s\-()]/g, '').replace(/^00/, '+'); if (!/^\+?\d{7,15}$/.test(s)) bad('phone'); return normPhone(s); }
        case 'color': if (!/^#[0-9a-fA-F]{6}$/.test(String(v))) bad('color'); return String(v);
        case 'tags': return (Array.isArray(v) ? v : String(v).split(/[,،]/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 30).join(',');
        case 'refs': return JSON.stringify((Array.isArray(v) ? v : JSON.parse(v || '[]')).map(Number).filter(Number.isInteger));
        case 'json': return typeof v === 'string' ? (JSON.parse(v), v) : JSON.stringify(v);
        case 'image': {
            const s = String(v);
            const okType = field.svg ? /^data:image\/(png|jpeg|webp|svg\+xml);base64,/ : /^data:image\/(png|jpeg|webp);base64,/;
            if (!okType.test(s)) bad('image');
            if (s.length * 0.75 > (field.maxKb || 400) * 1024) bad('too_big');
            return s;
        }
        default: return v;
    }
}

/** توحيد أرقام الجوال السعودية: 05xxxxxxxx ← +9665xxxxxxxx */
export function normPhone(s) {
    let p = String(s || '').replace(/[^\d+]/g, '');
    if (/^05\d{8}$/.test(p)) p = '+966' + p.slice(1);
    else if (/^5\d{8}$/.test(p)) p = '+966' + p;
    else if (/^9665\d{8}$/.test(p)) p = '+' + p;
    return p;
}
