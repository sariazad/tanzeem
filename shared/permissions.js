// تنظيم — الوحدات والإجراءات والأدوار الافتراضية. يستخدمه الخادم والواجهة معاً.

/** ترتيب القائمة الجانبية بالضبط كما في المواصفات. */
export const MODULES = [
    { key: 'dashboard', icon: 'grid', path: '/app' },
    { key: 'events', icon: 'calendar', path: '/app/events' },
    { key: 'visits', icon: 'briefcase', path: '/app/visits' },
    { key: 'visitors', icon: 'users', path: '/app/visitors' },
    { key: 'groups', icon: 'layers', path: '/app/groups' },
    { key: 'bulk', icon: 'user-check', path: '/app/bulk' },
    { key: 'reports', icon: 'bar-chart', path: '/app/reports' },
    { key: 'notifications', icon: 'bell', path: '/app/notifications' },
    { key: 'checkin', icon: 'scan', path: '/app/checkin' },
    { key: 'kiosk', icon: 'monitor', path: '/app/kiosk' },
    { key: 'badges', icon: 'id-card', path: '/app/badges' },
    { key: 'devices', icon: 'cpu', path: '/app/devices' },
    { key: 'users', icon: 'shield', path: '/app/users' },
    { key: 'forms', icon: 'file-text', path: '/app/forms' },
    { key: 'audit', icon: 'list', path: '/app/audit' },
    { key: 'integrations', icon: 'link', path: '/app/integrations' },
];
export const MODULE_KEYS = MODULES.map((m) => m.key).concat(['settings']);
export const ACTIONS = ['view', 'create', 'update', 'delete', 'export', 'approve'];
export const SCOPES = ['all', 'org', 'event'];

/** صفحات الفعالية الفرعية الخمس. */
export const EVENT_TABS = ['invitations', 'schedule', 'live', 'map', 'networking', 'design'];

const all = ACTIONS;
export const DEFAULT_ROLES = [
    { key: 'super_admin', system: 1, permissions: { '*': ['*'] } },
    {
        key: 'org_admin', system: 1, permissions: {
            dashboard: ['view'], events: all, visits: all, visitors: all, groups: all, bulk: ['view', 'create'],
            reports: ['view', 'export'], notifications: ['view', 'update'], checkin: ['view', 'create'],
            badges: ['view', 'create', 'update'], forms: all, kiosk: ['view'],
        },
    },
    {
        key: 'organizer', system: 1, permissions: {
            dashboard: ['view'], events: ['view', 'update', 'export'], visitors: ['view', 'create', 'update', 'export'],
            groups: ['view', 'create', 'update'], bulk: ['view', 'create'], reports: ['view', 'export'],
            notifications: ['view', 'create'], checkin: ['view', 'create'], badges: ['view'], forms: ['view'],
        },
    },
    {
        key: 'reception', system: 1, permissions: {
            dashboard: ['view'], events: ['view'], visits: ['view'], visitors: ['view', 'create', 'update'],
            groups: ['view'], bulk: ['view', 'create'], notifications: ['view'], checkin: ['view', 'create'], badges: ['view'],
        },
    },
    {
        key: 'it', system: 1, permissions: {
            dashboard: ['view'], notifications: ['view', 'update'], kiosk: all, badges: ['view'], devices: all,
            integrations: all, audit: ['view', 'export'],
        },
    },
    { key: 'participant', system: 1, permissions: {} },
];

/**
 * هل تمنح الصلاحيات الإجراء؟ grants = [{ permissions, scope_type, scope_id }]
 * ctx = { orgId, eventId } للكيان المستهدف. بلا ctx يكفي أن تمنحه أي إسنادة (للعرض في القائمة والفلترة لاحقاً).
 */
export function can(grants, module, action, ctx = null) {
    for (const g of grants || []) {
        const p = g.permissions || {};
        const acts = p['*'] || p[module];
        if (!acts || !(acts.includes('*') || acts.includes(action))) continue;
        if (!ctx || g.scope_type === 'all') return true;
        if (g.scope_type === 'org' && ctx.orgId != null && Number(ctx.orgId) === Number(g.scope_id)) return true;
        if (g.scope_type === 'event' && ctx.eventId != null && Number(ctx.eventId) === Number(g.scope_id)) return true;
    }
    return false;
}

/** نطاق القراءة لوحدة: { all: true } أو { orgs: [...], events: [...] }. */
export function scopeOf(grants, module, action = 'view') {
    const out = { all: false, orgs: [], events: [] };
    for (const g of grants || []) {
        const p = g.permissions || {};
        const acts = p['*'] || p[module];
        if (!acts || !(acts.includes('*') || acts.includes(action))) continue;
        if (g.scope_type === 'all') return { all: true, orgs: [], events: [] };
        if (g.scope_type === 'org') out.orgs.push(Number(g.scope_id));
        if (g.scope_type === 'event') out.events.push(Number(g.scope_id));
    }
    return out;
}

/** خريطة مسطحة للواجهة: { module: [actions] } (اتحاد كل الإسنادات). */
export function flatten(grants) {
    const out = {};
    for (const g of grants || []) {
        for (const [m, acts] of Object.entries(g.permissions || {})) {
            const mods = m === '*' ? MODULE_KEYS : [m];
            for (const mod of mods) {
                const list = acts.includes('*') ? ACTIONS : acts;
                out[mod] = [...new Set([...(out[mod] || []), ...list])];
            }
        }
    }
    return out;
}
