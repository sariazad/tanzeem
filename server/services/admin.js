// تنظيم — المستخدمون والأدوار ومصفوفة الصلاحيات والجلسات، الإعدادات (الهوية البصرية، الأمن، القوالب، الاحتفاظ)،
// سجل التدقيق، البحث الشامل، ومسارات الدخول.
import { one, all, run, tx } from '../db.js';
import { fail, readJson } from '../http.js';
import { hashPassword, passwordProblems, randomToken } from '../security.js';
import { MODULE_KEYS, ACTIONS, SCOPES } from '../../shared/permissions.js';
import { coerce } from '../../shared/resources.js';
import { DEFAULT_TEMPLATES } from '../../shared/messages.js';

export const BRANDING_DEFAULTS = {
    name_ar: 'تنظيم', name_en: 'Tanzeem', tagline_ar: 'المنظومة الذكية لإدارة الفعاليات والزوار', tagline_en: 'Smart Events & Visitors Platform',
    slogan_ar: 'تكامل رقمي بمعايير وطنية', slogan_en: 'Digital integration to national standards',
    primary: '#0f6e56', accent: '#b8862b', sidebar: '#0b3b31', radius: 12, font: 'IBM Plex Sans Arabic', logo: null, default_lang: 'ar', calendar: 'both',
};
const FONTS = ['IBM Plex Sans Arabic', 'Tajawal', 'Tahoma', 'system-ui'];

export function registerAdmin(r, app) {
    const { db } = app;

    /* ───────── الدخول ───────── */
    r.post('/api/v1/auth/login', { public: true, tag: 'auth', summary: 'تسجيل الدخول (محلي أو AD)' }, async (ctx) => {
        if (app.limited('login:' + ctx.ip, 15, 60_000)) fail(429, 'slow_down');
        return app.auth.login(ctx, await readJson(ctx.req, 5000));
    });
    r.post('/api/v1/auth/mfa/verify', { tag: 'auth', mfa: true, summary: 'التحقق برمز TOTP' }, async (ctx) => {
        if (app.limited('mfa:' + ctx.ip, 10, 60_000)) fail(429, 'slow_down');
        return app.auth.mfaVerify(ctx, (await readJson(ctx.req, 1000)).code);
    });
    r.post('/api/v1/auth/mfa/setup', { tag: 'auth', mfa: true, summary: 'بدء تفعيل التحقق الثنائي' }, (ctx) => {
        if (ctx.actor?.kind !== 'user') fail(401, 'unauthenticated');
        if (ctx.actor.mfaPending === 1) fail(403, 'mfa_required');
        return app.auth.mfaSetup(ctx);
    });
    r.post('/api/v1/auth/mfa/disable', { tag: 'auth', summary: 'إيقاف التحقق الثنائي' }, (ctx) => {
        if (ctx.actor?.kind !== 'user') fail(401, 'unauthenticated');
        run(db, 'UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?', ctx.actor.userId);
        app.audit.record(app.auth.actorOf(ctx), 'auth.mfa_disabled', 'users', ctx.actor.userId);
        return { ok: true };
    });
    r.post('/api/v1/auth/logout', { tag: 'auth', mfa: true }, (ctx) => { app.auth.logout(ctx); return { ok: true }; });
    r.post('/api/v1/auth/password', { tag: 'auth', summary: 'تغيير كلمة المرور' }, async (ctx) => {
        if (ctx.actor?.kind !== 'user') fail(401, 'unauthenticated');
        app.auth.changePassword(ctx, await readJson(ctx.req, 2000));
        return { ok: true };
    });
    r.get('/api/v1/auth/methods', { public: true, tag: 'auth' }, () => ({ ldap: !!app.integrations.config('ldap'), oidc: !!app.integrations.config('oidc'), oidc_label: app.integrations.config('oidc')?.label || null }));
    r.get('/auth/oidc/start', { public: true, raw: true }, async (ctx) => {
        const url = await app.auth.oidcStart(ctx);
        ctx.res.writeHead(302, { Location: url });
        ctx.res.end();
    });
    r.get('/auth/oidc/callback', { public: true, raw: true }, async (ctx) => {
        try { await app.auth.oidcCallback(ctx); ctx.res.writeHead(302, { Location: '/app', ...(ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {}) }); }
        catch (e) { ctx.res.writeHead(302, { Location: `/login?error=${encodeURIComponent(e.code || 'sso_failed')}` }); }
        ctx.res.end();
    });
    r.get('/api/v1/me', { tag: 'auth', mfa: true, summary: 'المستخدم الحالي وصلاحياته' }, (ctx) => {
        if (ctx.actor?.kind !== 'user') fail(401, 'unauthenticated');
        return app.auth.me(ctx);
    });
    r.put('/api/v1/me', { tag: 'auth' }, async (ctx) => {
        if (ctx.actor?.kind !== 'user') fail(401, 'unauthenticated');
        const b = await readJson(ctx.req);
        if (['ar', 'en'].includes(b.lang)) run(db, 'UPDATE users SET lang = ? WHERE id = ?', b.lang, ctx.actor.userId);
        return { ok: true };
    });

    /* ───────── المستخدمون ───────── */
    const userView = (u) => ({ id: u.id, name: u.name, email: u.email, username: u.username, phone: u.phone, org_id: u.org_id, source: u.source, status: u.status, mfa_enabled: !!u.mfa_enabled, last_login: u.last_login, created_at: u.created_at, locked: !!(u.locked_until && u.locked_until > Date.now()),
        roles: all(db, 'SELECT ur.id, ur.role_id, r.key, r.name_ar, r.name_en, ur.scope_type, ur.scope_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?', u.id) });
    r.get('/api/v1/users', { tag: 'users', summary: 'المستخدمون' }, (ctx) => {
        app.auth.need(ctx, 'users', 'view');
        const q = ctx.query;
        const where = [], args = [];
        if (q.q) { where.push('(name LIKE ? OR email LIKE ? OR username LIKE ?)'); const l = `%${q.q}%`; args.push(l, l, l); }
        if (q.f_status) { where.push('status = ?'); args.push(q.f_status); }
        if (q.f_source) { where.push('source = ?'); args.push(q.f_source); }
        const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const size = Math.min(Number(q.size) || 25, 200), page = Math.max(Number(q.page) || 1, 1);
        const sort = { name: 'name', email: 'email', last_login: 'last_login', status: 'status' }[q.sort] || 'id';
        return { rows: all(db, `SELECT * FROM users ${w} ORDER BY ${sort} ${q.dir === 'desc' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`, ...args, size, (page - 1) * size).map(userView), total: one(db, `SELECT COUNT(*) n FROM users ${w}`, ...args).n, page, size };
    });
    const saveUser = async (ctx, id) => {
        app.auth.need(ctx, 'users', id ? 'update' : 'create');
        const b = await readJson(ctx.req);
        const before = id ? one(db, 'SELECT * FROM users WHERE id = ?', id) || fail(404, 'not_found') : null;
        const data = {};
        const errs = [];
        const put = (k, f) => { if (k in b) { try { data[k] = coerce({ key: k, ...f }, b[k]); } catch (e) { errs.push({ field: k, code: e.code }); } } };
        put('name', { type: 'text', req: 1 }); put('email', { type: 'email', req: 1 }); put('username', { type: 'text' }); put('phone', { type: 'phone' }); put('org_id', { type: 'ref' });
        put('status', { type: 'select', opts: ['active', 'disabled'] }); put('source', { type: 'select', opts: ['local', 'ldap', 'oidc'] });
        if (!id && !data.name) errs.push({ field: 'name', code: 'required' });
        if (!id && !data.email) errs.push({ field: 'email', code: 'required' });
        let tempPassword = null;
        if (b.password) {
            const p = passwordProblems(b.password);
            if (p.length) errs.push({ field: 'password', code: 'weak_password', problems: p });
            else { data.pass_hash = hashPassword(b.password); data.must_change_password = b.must_change ? 1 : 0; }
        } else if (!id && (data.source || 'local') === 'local') {
            tempPassword = `Tz-${randomToken(9)}9a`;
            data.pass_hash = hashPassword(tempPassword);
            data.must_change_password = 1;
        }
        if (errs.length) fail(422, 'invalid', { errors: errs });
        if (data.email && one(db, 'SELECT id FROM users WHERE email = ? AND id != ?', data.email, id || 0)) fail(422, 'invalid', { errors: [{ field: 'email', code: 'taken' }] });
        let uid = id;
        tx(db, () => {
            const cols = Object.keys(data);
            if (id) { if (cols.length) run(db, `UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => data[c]), id); }
            else uid = Number(run(db, `INSERT INTO users (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => data[c])).lastInsertRowid);
            if (Array.isArray(b.roles)) {
                run(db, 'DELETE FROM user_roles WHERE user_id = ?', uid);
                for (const g of b.roles) {
                    if (!SCOPES.includes(g.scope_type || 'all')) continue;
                    run(db, 'INSERT OR IGNORE INTO user_roles (user_id, role_id, scope_type, scope_id) VALUES (?,?,?,?)', uid, Number(g.role_id), g.scope_type || 'all', g.scope_type === 'all' ? null : Number(g.scope_id) || null);
                }
            }
        });
        if (id && (data.status === 'disabled' || b.password || Array.isArray(b.roles))) {
            if (data.status === 'disabled' || b.password) app.auth.revokeUserSessions(id);
        }
        const after = userView(one(db, 'SELECT * FROM users WHERE id = ?', uid));
        app.audit.record(app.auth.actorOf(ctx), `users.${id ? 'update' : 'create'}`, 'users', uid, before ? userView(before) : null, after);
        return { ...after, temp_password: tempPassword };
    };
    r.post('/api/v1/users', { tag: 'users', summary: 'إضافة مستخدم' }, (ctx) => saveUser(ctx, null));
    r.put('/api/v1/users/:id', { tag: 'users', summary: 'تعديل مستخدم وأدواره' }, (ctx) => saveUser(ctx, Number(ctx.params.id)));
    r.del('/api/v1/users/:id', { tag: 'users' }, (ctx) => {
        app.auth.need(ctx, 'users', 'delete');
        const u = one(db, 'SELECT * FROM users WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        if (u.id === ctx.actor.userId) fail(409, 'self');
        app.auth.revokeUserSessions(u.id);
        run(db, 'DELETE FROM users WHERE id = ?', u.id);
        app.audit.record(app.auth.actorOf(ctx), 'users.delete', 'users', u.id, userView(u), null);
        return { ok: true };
    });
    r.post('/api/v1/users/:id/unlock', { tag: 'users', summary: 'فك القفل وتصفير المحاولات' }, (ctx) => {
        app.auth.need(ctx, 'users', 'update');
        run(db, 'UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE id = ?', Number(ctx.params.id));
        app.audit.record(app.auth.actorOf(ctx), 'users.unlock', 'users', ctx.params.id);
        return { ok: true };
    });
    r.post('/api/v1/users/:id/reset-mfa', { tag: 'users' }, (ctx) => {
        app.auth.need(ctx, 'users', 'update');
        run(db, 'UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?', Number(ctx.params.id));
        app.auth.revokeUserSessions(Number(ctx.params.id));
        app.audit.record(app.auth.actorOf(ctx), 'users.reset_mfa', 'users', ctx.params.id);
        return { ok: true };
    });
    r.post('/api/v1/users/:id/logout', { tag: 'users', summary: 'إجبار تسجيل الخروج من كل الجلسات' }, (ctx) => {
        app.auth.need(ctx, 'users', 'update');
        app.auth.revokeUserSessions(Number(ctx.params.id));
        app.audit.record(app.auth.actorOf(ctx), 'users.force_logout', 'users', ctx.params.id);
        return { ok: true };
    });
    r.get('/api/v1/sessions', { tag: 'users', summary: 'الجلسات النشطة' }, (ctx) => {
        app.auth.need(ctx, 'users', 'view');
        const since = Date.now() - app.cfg.sessionIdleMinutes * 60_000;
        return { rows: all(db, 'SELECT s.id, s.user_id, u.name, u.email, s.ip, s.ua, s.created_at, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.revoked = 0 AND s.last_seen > ? ORDER BY s.last_seen DESC', since) };
    });
    r.del('/api/v1/sessions/:id', { tag: 'users', summary: 'إنهاء جلسة' }, (ctx) => {
        app.auth.need(ctx, 'users', 'update');
        const s = one(db, 'SELECT * FROM sessions WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        run(db, 'UPDATE sessions SET revoked = 1 WHERE id = ?', s.id);
        app.audit.record(app.auth.actorOf(ctx), 'sessions.revoke', 'users', s.user_id);
        return { ok: true };
    });

    /* ───────── الأدوار ───────── */
    r.get('/api/v1/roles', { tag: 'users', summary: 'الأدوار ومصفوفة الصلاحيات' }, (ctx) => {
        app.auth.need(ctx, 'users', 'view');
        return { rows: all(db, 'SELECT r.*, (SELECT COUNT(*) FROM user_roles WHERE role_id = r.id) users FROM roles r ORDER BY r.id').map((x) => ({ ...x, permissions: JSON.parse(x.permissions) })), modules: MODULE_KEYS, actions: ACTIONS, scopes: SCOPES };
    });
    const saveRole = async (ctx, id) => {
        app.auth.need(ctx, 'users', id ? 'update' : 'create');
        const b = await readJson(ctx.req);
        const before = id ? one(db, 'SELECT * FROM roles WHERE id = ?', id) || fail(404, 'not_found') : null;
        if (before?.key === 'super_admin' && b.permissions) fail(409, 'protected');
        const perms = {};
        for (const [m, acts] of Object.entries(b.permissions || (before ? JSON.parse(before.permissions) : {}))) {
            if (m !== '*' && !MODULE_KEYS.includes(m)) continue;
            const list = [].concat(acts).filter((a) => a === '*' || ACTIONS.includes(a));
            if (list.length) perms[m] = list;
        }
        const name_ar = String(b.name_ar ?? before?.name_ar ?? '').trim();
        if (!name_ar) fail(422, 'invalid', { errors: [{ field: 'name_ar', code: 'required' }] });
        const key = before?.key || String(b.key || name_ar).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || `role_${Date.now()}`;
        let rid = id;
        if (id) run(db, 'UPDATE roles SET name_ar = ?, name_en = ?, permissions = ? WHERE id = ?', name_ar, b.name_en ?? before.name_en, JSON.stringify(perms), id);
        else {
            if (one(db, 'SELECT id FROM roles WHERE key = ?', key)) fail(422, 'invalid', { errors: [{ field: 'key', code: 'taken' }] });
            rid = Number(run(db, 'INSERT INTO roles (key, name_ar, name_en, permissions) VALUES (?,?,?,?)', key, name_ar, b.name_en || null, JSON.stringify(perms)).lastInsertRowid);
        }
        app.audit.record(app.auth.actorOf(ctx), `roles.${id ? 'update' : 'create'}`, 'roles', rid, before ? { permissions: JSON.parse(before.permissions) } : null, { key, permissions: perms });
        return { ...one(db, 'SELECT * FROM roles WHERE id = ?', rid), permissions: perms };
    };
    r.post('/api/v1/roles', { tag: 'users' }, (ctx) => saveRole(ctx, null));
    r.put('/api/v1/roles/:id', { tag: 'users' }, (ctx) => saveRole(ctx, Number(ctx.params.id)));
    r.del('/api/v1/roles/:id', { tag: 'users' }, (ctx) => {
        app.auth.need(ctx, 'users', 'delete');
        const role = one(db, 'SELECT * FROM roles WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        if (role.system) fail(409, 'protected');
        run(db, 'DELETE FROM roles WHERE id = ?', role.id);
        app.audit.record(app.auth.actorOf(ctx), 'roles.delete', 'roles', role.id, role, null);
        return { ok: true };
    });

    /* ───────── الإعدادات ───────── */
    r.get('/api/public/branding', { public: true, tag: 'settings', summary: 'الهوية البصرية (للواجهات)' }, () => app.publicBranding());
    r.get('/api/v1/settings', { tag: 'settings', summary: 'إعدادات النظام' }, (ctx) => {
        app.auth.need(ctx, 'settings', 'view');
        return { branding: app.publicBranding(), security: { mfa_required_roles: ['super_admin'], ...app.getSetting('security', {}) }, templates: app.events.templates(), default_templates: DEFAULT_TEMPLATES,
            retention: { visitor_days: 730, logs_days: 1095, ...app.getSetting('retention', {}) }, ai: { enabled: true, ...app.getSetting('ai', {}) }, fonts: FONTS };
    });
    r.put('/api/v1/settings/:section', { tag: 'settings', summary: 'تعديل قسم من الإعدادات: branding | security | templates | retention | ai' }, async (ctx) => {
        app.auth.need(ctx, 'settings', 'update');
        const b = await readJson(ctx.req, 2_000_000);
        const sec = ctx.params.section;
        const before = app.getSetting(sec, {});
        let next;
        if (sec === 'branding') {
            next = { ...before };
            for (const k of ['name_ar', 'name_en', 'tagline_ar', 'tagline_en', 'slogan_ar', 'slogan_en']) if (k in b) next[k] = String(b[k] || '').slice(0, 120);
            for (const k of ['primary', 'accent', 'sidebar']) if (k in b) next[k] = coerce({ key: k, type: 'color' }, b[k]);
            if ('radius' in b) next.radius = coerce({ key: 'radius', type: 'int', min: 0, max: 24 }, b.radius);
            if ('font' in b && FONTS.includes(b.font)) next.font = b.font;
            if ('default_lang' in b && ['ar', 'en'].includes(b.default_lang)) next.default_lang = b.default_lang;
            if ('calendar' in b && ['gregory', 'hijri', 'both'].includes(b.calendar)) next.calendar = b.calendar;
            if ('logo' in b) next.logo = b.logo ? coerce({ key: 'logo', type: 'image', maxKb: 300 }, b.logo) : null;
        } else if (sec === 'security') {
            next = { mfa_required_roles: [].concat(b.mfa_required_roles || []).map(String).slice(0, 20) };
        } else if (sec === 'templates') {
            next = {};
            for (const kind of Object.keys(DEFAULT_TEMPLATES)) for (const lang of ['ar', 'en']) {
                const t = b?.[kind]?.[lang];
                if (!t) continue;
                next[kind] ||= {};
                next[kind][lang] = { subject: String(t.subject || '').slice(0, 200), body: String(t.body || '').slice(0, 5000), sms: String(t.sms || '').slice(0, 480) };
            }
        } else if (sec === 'retention') {
            next = { visitor_days: coerce({ key: 'visitor_days', type: 'int', min: 30, max: 3650 }, b.visitor_days ?? 730), logs_days: coerce({ key: 'logs_days', type: 'int', min: 90, max: 3650 }, b.logs_days ?? 1095) };
        } else if (sec === 'ai') {
            next = { enabled: !!b.enabled };
        } else fail(404, 'not_found');
        app.setSetting(sec, next);
        app.audit.record(app.auth.actorOf(ctx), `settings.${sec}`, 'settings', sec, before, next);
        if (sec === 'branding') app.hub?.publish('dashboard', 'branding', app.publicBranding());
        return { ok: true, value: sec === 'branding' ? app.publicBranding() : next };
    });

    /* ───────── سجل التدقيق (قراءة فقط) ───────── */
    const auditQuery = (q) => {
        const where = [], args = [];
        if (q.q) { where.push('(actor LIKE ? OR action LIKE ? OR entity_id = ?)'); args.push(`%${q.q}%`, `%${q.q}%`, q.q); }
        if (q.action) { where.push('action LIKE ?'); args.push(`${q.action}%`); }
        if (q.entity) { where.push('entity = ?'); args.push(q.entity); }
        if (q.user_id) { where.push('user_id = ?'); args.push(Number(q.user_id)); }
        if (q.from) { where.push('at >= ?'); args.push(new Date(q.from).toISOString()); }
        if (q.to) { where.push('at <= ?'); args.push(new Date(new Date(q.to).getTime() + 86400_000 - 1).toISOString()); }
        return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
    };
    r.get('/api/v1/audit', { tag: 'audit', summary: 'سجل التدقيق' }, (ctx) => {
        app.auth.need(ctx, 'audit', 'view');
        const { w, args } = auditQuery(ctx.query);
        const size = Math.min(Number(ctx.query.size) || 50, 500), page = Math.max(Number(ctx.query.page) || 1, 1);
        return { rows: all(db, `SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...args, size, (page - 1) * size), total: one(db, `SELECT COUNT(*) n FROM audit_log ${w}`, ...args).n, page, size,
            actions: all(db, "SELECT DISTINCT substr(action, 1, instr(action, '.') - 1) a FROM audit_log").map((x) => x.a).filter(Boolean) };
    });
    r.get('/api/v1/audit/verify', { tag: 'audit', summary: 'التحقق من سلامة سلسلة التدقيق' }, (ctx) => { app.auth.need(ctx, 'audit', 'view'); return app.audit.verify(); });
    r.get('/api/v1/audit/export', { tag: 'audit', summary: 'تصدير سجل التدقيق' }, (ctx) => {
        app.auth.need(ctx, 'audit', 'export');
        const { w, args } = auditQuery(ctx.query);
        const rows = all(db, `SELECT id, at, actor, user_id, action, entity, entity_id, ip, before, after, hash FROM audit_log ${w} ORDER BY id DESC LIMIT 100000`, ...args);
        app.audit.record(app.auth.actorOf(ctx), 'audit.export', 'audit', null, null, { rows: rows.length });
        return { __file: app.exporter.file(ctx.query.format === 'xlsx' ? 'xlsx' : 'csv', 'audit', ['id', 'at', 'actor', 'user_id', 'action', 'entity', 'entity_id', 'ip', 'before', 'after', 'hash'].map((k) => ({ key: k, label: k })), rows, { rtl: false }) };
    });

    /* ───────── البحث الشامل ───────── */
    r.get('/api/v1/search', { tag: 'search', summary: 'بحث شامل في الفعاليات والزيارات والزوار' }, (ctx) => {
        const q = String(ctx.query.q || '').trim();
        if (q.length < 2) return { events: [], visits: [], visitors: [] };
        const like = `%${q.replace(/[%_]/g, '')}%`;
        const out = { events: [], visits: [], visitors: [], groups: [] };
        const { can } = app.perm;
        if (can(ctx.actor.grants, 'events', 'view')) {
            const sc = app.resources.scopeWhere(ctx, app.resources.def('events'), 'events');
            out.events = all(db, `SELECT id, title_ar, title_en, status, starts_at FROM events WHERE (title_ar LIKE ? OR title_en LIKE ? OR location LIKE ?) ${sc.sql ? 'AND ' + sc.sql : ''} ORDER BY starts_at DESC LIMIT 6`, like, like, like, ...sc.args);
        }
        if (can(ctx.actor.grants, 'visits', 'view')) {
            const sc = app.resources.scopeWhere(ctx, app.resources.def('visits'), 'visits');
            out.visits = all(db, `SELECT id, title, status, starts_at FROM visits WHERE (title LIKE ? OR host_name LIKE ?) ${sc.sql ? 'AND ' + sc.sql : ''} ORDER BY starts_at DESC LIMIT 6`, like, like, ...sc.args);
        }
        if (can(ctx.actor.grants, 'visitors', 'view')) {
            out.visitors = all(db, 'SELECT id, name_ar, name_en, org_name, category FROM visitors WHERE name_ar LIKE ? OR name_en LIKE ? OR email LIKE ? OR phone LIKE ? OR national_id_hash = ? LIMIT 8', like, like, like, `%${q.replace(/\D/g, '') || '¤'}%`, app.lookup(q));
        }
        if (can(ctx.actor.grants, 'groups', 'view')) out.groups = all(db, 'SELECT id, name, kind FROM groups WHERE name LIKE ? LIMIT 4', like);
        return out;
    });

    /* ───────── النماذج: تحقق من بنية الحقول ───────── */
    const FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'radio', 'multi', 'checkbox', 'photo', 'national_id'];
    app.resources.hooks.forms = {
        beforeSave(ctx, data) {
            if (!('fields' in data)) return;
            let fields;
            try { fields = JSON.parse(data.fields); } catch { fail(422, 'invalid', { errors: [{ field: 'fields', code: 'json' }] }); }
            if (!Array.isArray(fields) || fields.length > 60) fail(422, 'invalid', { errors: [{ field: 'fields', code: 'json' }] });
            const keys = new Set();
            const clean = fields.map((f) => {
                const key = String(f.key || '').replace(/[^a-z0-9_]/gi, '').slice(0, 40);
                if (!key || keys.has(key) || !FIELD_TYPES.includes(f.type)) fail(422, 'invalid', { errors: [{ field: 'fields', code: 'field', key }] });
                keys.add(key);
                if (f.pattern) { try { new RegExp(f.pattern); } catch { fail(422, 'invalid', { errors: [{ field: 'fields', code: 'pattern', key }] }); } }
                return { key, type: f.type, label_ar: String(f.label_ar || '').slice(0, 120), label_en: String(f.label_en || '').slice(0, 120), required: !!f.required,
                    placeholder_ar: f.placeholder_ar ? String(f.placeholder_ar).slice(0, 120) : undefined, placeholder_en: f.placeholder_en ? String(f.placeholder_en).slice(0, 120) : undefined,
                    options: Array.isArray(f.options) ? f.options.slice(0, 50).map((o) => ({ value: String(o.value).slice(0, 60), label_ar: String(o.label_ar || o.value).slice(0, 120), label_en: String(o.label_en || o.value).slice(0, 120) })) : undefined,
                    min: f.min != null && f.min !== '' ? Number(f.min) : undefined, max: f.max != null && f.max !== '' ? Number(f.max) : undefined, pattern: f.pattern ? String(f.pattern).slice(0, 200) : undefined,
                    show_if: f.show_if?.field ? { field: String(f.show_if.field), equals: String(f.show_if.equals ?? '') } : undefined };
            });
            data.fields = JSON.stringify(clean);
        },
        decorate(rows) { return rows.map((r) => ({ ...r, field_count: r.fields && r.fields !== '__omitted__' ? JSON.parse(r.fields).length : null })); },
    };
    app.resources.hooks.badge_templates = {
        afterSave(ctx, row) { if (row.is_default) run(db, 'UPDATE badge_templates SET is_default = 0 WHERE id != ?', row.id); },
    };
}
