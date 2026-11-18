// تنظيم — الخادم: HTTP + WebSocket في عملية واحدة، SQLite تحفظ كل شيء. يُنشأ من createApp() (والاختبارات تستعمله مباشرة).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config as defaultConfig } from './config.js';
import { openDb, getSetting, setSetting, one, all, run } from './db.js';
import { Router, HttpError, send, rateLimiter, SECURITY_HEADERS } from './http.js';
import { keys as deriveKeys, encrypt, decrypt, lookupHash } from './security.js';
import { makeAudit } from './audit.js';
import { makeAuth } from './auth.js';
import { makeResources } from './resources.js';
import { makeExporter } from './exporter.js';
import { createHub } from './realtime.js';
import { can, scopeOf, DEFAULT_ROLES } from '../shared/permissions.js';
import { RESOURCES } from '../shared/resources.js';
import { defaultDesign } from '../shared/badge.js';
import { makeIntegrations, registerIntegrations } from './services/integrations.js';
import { makeAttendance, registerAttendance } from './services/attendance.js';
import { makeEvents, registerEvents } from './services/events.js';
import { makeVisitors, registerPeople } from './services/people.js';
import { makeDevices, registerDevices } from './services/devices.js';
import { makeNotify, registerNotifications } from './services/notifications.js';
import { makeReports, registerReports } from './services/reports.js';
import { makeAi, registerAi } from './services/ai.js';
import { registerAdmin, BRANDING_DEFAULTS } from './services/admin.js';
import { buildOpenApi } from './openapi.js';
import { seedDemo } from './seed.js';

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};
const PAGES = [
    [/^\/$/, 'index.html'], [/^\/login\/?$/, 'login.html'], [/^\/app(\/.*)?$/, 'app.html'], [/^\/kiosk\/?$/, 'kiosk.html'],
    [/^\/m(\/.*)?$/, 'm.html'], [/^\/docs\/?$/, 'docs.html'], [/^\/print\/?$/, 'print.html'],
];

export function createApp(opts = {}) {
    const cfg = { ...defaultConfig, ...opts };
    const db = openDb(cfg.dbFile);
    const k = deriveKeys(cfg.secret);
    const limited = rateLimiter();
    const log = opts.log || ((o) => process.stdout.write(JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n'));

    const app = {
        cfg, db, keys: k, limited, log,
        encrypt: (v) => encrypt(k.enc, v), decrypt: (v) => decrypt(k.enc, v), lookup: (v) => lookupHash(k.lookup, String(v || '').replace(/\s/g, '')),
        getSetting: (key, fb) => getSetting(db, key, fb), setSetting: (key, v) => setSetting(db, key, v),
        perm: { can, scopeOf },
        exporter: makeExporter(),
        publicBranding: () => ({ ...BRANDING_DEFAULTS, ...getSetting(db, 'branding', {}) }),
        metrics: makeMetrics(),
    };
    app.audit = makeAudit(db);
    app.notify = makeNotify(app);
    app.auth = makeAuth(app);
    app.resources = makeResources(app);
    app.integrations = makeIntegrations(app);
    app.attendance = makeAttendance(app);
    app.visitors = makeVisitors(app);
    app.events = makeEvents(app);
    app.devices = makeDevices(app);
    app.ai = makeAi(app);
    app.reports = makeReports(app);

    bootstrap(app);

    /* ───────── المسارات ───────── */
    const r = new Router();
    registerAdmin(r, app);
    registerIntegrations(r, app);
    registerAttendance(r, app);
    registerEvents(r, app);
    registerPeople(r, app);
    registerDevices(r, app);
    registerNotifications(r, app);
    registerReports(r, app);
    registerAi(r, app);
    registerResourceRoutes(r, app);
    r.get('/api/openapi.json', { public: true, tag: 'docs' }, () => buildOpenApi(r, cfg));
    r.get('/healthz', { public: true, raw: true }, (ctx) => {
        one(db, 'SELECT 1 x');
        send(ctx.res, 200, { ok: true, uptime: Math.round(process.uptime()), version: VERSION });
    });
    r.get('/metrics', { public: true, raw: true }, (ctx) => {
        // Prometheus: يُتاح من الشبكة الداخلية فقط (أو بمفتاح METRICS_TOKEN)
        const tok = process.env.METRICS_TOKEN;
        const local = /^(127\.|::1|::ffff:127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ctx.ip);
        if (tok ? ctx.req.headers.authorization !== `Bearer ${tok}` : !local) return send(ctx.res, 403, 'forbidden');
        send(ctx.res, 200, app.metrics.render({ ws: app.hub?.stats() || {}, inside: one(db, 'SELECT COUNT(*) n FROM presence WHERE inside = 1').n, devices_online: one(db, "SELECT COUNT(*) n FROM devices WHERE status IN ('online','paper_low')").n }), { 'Content-Type': 'text/plain; version=0.0.4' });
    });

    /* ───────── معالجة الطلبات ───────── */
    async function handle(req, res) {
        const t0 = Date.now();
        const url = new URL(req.url, 'http://localhost');
        const ip = (cfg.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';
        const ctx = { req, res, url, query: Object.fromEntries(url.searchParams), params: {}, ip, actor: null, setCookie: null };
        let status = 200;
        try {
            if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname === '/healthz' || url.pathname === '/metrics') {
                const m = r.match(req.method, url.pathname);
                if (!m) throw new HttpError(404, 'not_found');
                if (m.notAllowed) throw new HttpError(405, 'method_not_allowed');
                ctx.params = m.params;
                if (url.pathname.startsWith('/api/') && limited('api:' + ip, 3000, 60_000)) throw new HttpError(429, 'slow_down');
                ctx.actor = app.auth.resolve(ctx);
                const o = m.route.opts;
                if (!o.public) {
                    if (!ctx.actor) throw new HttpError(401, 'unauthenticated');
                    if (ctx.actor.kind === 'user' && ctx.actor.mfaPending && !o.mfa) throw new HttpError(403, ctx.actor.mfaPending === 1 ? 'mfa_required' : 'mfa_enroll_required');
                    if (ctx.actor.kind === 'user' && !['GET', 'HEAD'].includes(req.method) && req.headers['x-requested-with'] !== 'tanzeem') throw new HttpError(403, 'csrf');
                }
                const out = await m.route.handler(ctx);
                if (o.raw || res.headersSent) { status = res.statusCode; return; }
                const headers = ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {};
                if (out && out.__file) {
                    const f = out.__file;
                    res.writeHead(200, { 'Content-Type': f.mime, 'Content-Disposition': `attachment; filename="${f.filename}"`, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
                    return res.end(f.body);
                }
                send(res, 200, out ?? { ok: true }, headers);
                return;
            }
            if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');
            serveStatic(req, res, url.pathname);
        } catch (e) {
            status = e instanceof HttpError ? e.status : /constraint/i.test(e.message || '') ? 409 : e.status || 500;
            const body = e instanceof HttpError || e.status ? { error: e.code || e.message, ...(e.errors ? { errors: e.errors } : {}), ...(e.until ? { until: e.until } : {}), ...(e.problems ? { problems: e.problems } : {}), ...(e.from ? { from: e.from } : {}) }
                : status === 409 ? { error: 'conflict' } : { error: 'server_error' };
            if (status >= 500 && status !== 503) log({ level: 'error', msg: e.message, stack: String(e.stack || '').split('\n').slice(0, 4).join(' | '), path: url.pathname });
            send(res, status, body, ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {});
        } finally {
            const ms = Date.now() - t0;
            app.metrics.http(status, ms);
            if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/device/heartbeat')) {
                // سجل منظم بلا بيانات شخصية: المسار بأرقام المعرفات فقط، دون الاستعلام
                log({ m: req.method, p: url.pathname.replace(/\/api\/public\/(inv|permit)\/[^/]+/, '/api/public/$1/:token'), s: res.statusCode || status, ms, u: ctx.actor?.userId ?? (ctx.actor?.device ? `d${ctx.actor.device.id}` : null) });
            }
        }
    }

    function serveStatic(req, res, pathname) {
        const dist = cfg.distDir;
        let file = null;
        for (const [rx, f] of PAGES) if (rx.test(pathname)) { file = path.join(dist, f); break; }
        if (!file) {
            const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
            file = path.join(dist, safe);
            if (!file.startsWith(dist)) return send(res, 403, 'forbidden');
        }
        fs.stat(file, (err, st) => {
            if (err || !st.isFile()) {
                const nf = path.join(dist, '404.html');
                if (fs.existsSync(nf)) { res.writeHead(404, { 'Content-Type': MIME['.html'], ...SECURITY_HEADERS }); return fs.createReadStream(nf).pipe(res); }
                return send(res, 404, 'not found');
            }
            const ext = path.extname(file);
            const immutable = file.includes(`${path.sep}assets${path.sep}`);
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', 'Content-Length': st.size, ...SECURITY_HEADERS });
            if (req.method === 'HEAD') return res.end();
            fs.createReadStream(file).pipe(res);
        });
    }

    const server = http.createServer((req, res) => { handle(req, res); });
    server.headersTimeout = 30_000;
    server.requestTimeout = 60_000;

    /* ───────── WebSocket ───────── */
    app.hub = createHub({
        server, log: (...a) => log({ level: 'warn', msg: a.join(' ') }),
        authorize(req, url) {
            const ctx = { req, ip: req.socket.remoteAddress };
            if (url.searchParams.get('device')) req.headers['x-device-token'] = url.searchParams.get('device');
            const inv = url.searchParams.get('inv');
            if (inv) {
                const row = one(db, "SELECT event_id FROM invitations WHERE token = ? AND status IN ('sent','confirmed')", inv);
                if (!row) return null;
                return { kind: 'guest', canSub: (ch) => ch === `announce:${row.event_id}` || ch === `event-public:${row.event_id}` };
            }
            const actor = app.auth.resolve(ctx);
            if (!actor) return null;
            if (actor.kind === 'device') return { kind: 'device', device: actor.device, canSub: (ch) => ch === `event:${actor.device.event_id}` || ch === `device:${actor.device.id}` };
            if (actor.kind !== 'user' || actor.mfaPending) return null;
            const g = actor.grants;
            return {
                kind: 'user', user: actor.user, grants: g,
                canSub(ch) {
                    if (ch === 'dashboard') return can(g, 'dashboard', 'view');
                    if (ch === 'notifications') return can(g, 'notifications', 'view');
                    if (ch === 'devices') return can(g, 'devices', 'view') || can(g, 'kiosk', 'view');
                    let m;
                    if ((m = ch.match(/^event:(\d+)$/))) {
                        const ev = one(db, 'SELECT org_id FROM events WHERE id = ?', Number(m[1]));
                        return !!ev && (can(g, 'events', 'view', { orgId: ev.org_id, eventId: Number(m[1]) }) || can(g, 'checkin', 'view', { orgId: ev.org_id, eventId: Number(m[1]) }));
                    }
                    if ((m = ch.match(/^visit:(\d+)$/))) return can(g, 'visits', 'view') || can(g, 'checkin', 'view');
                    return false;
                },
            };
        },
        onDeviceOpen: (d) => app.devices.heartbeat(d, {}),
        onDeviceMessage: (d, msg) => app.devices.onMessage(d, msg),
        onDeviceClose: (d) => setTimeout(() => { if (!app.hub.deviceOnline(d.id)) app.devices.markOffline(d, 'socket closed'); }, 15_000),
    });

    /* ───────── المهام الدورية ───────── */
    const timers = [];
    if (!opts.noScheduler) {
        timers.push(setInterval(() => safe(() => tick(app)), 30_000));
        timers.push(setInterval(() => safe(() => app.reports.runSchedules()), 60_000));
        timers.push(setInterval(() => safe(() => retention(app)), 6 * 3600_000));
    }
    const safe = async (fn) => { try { await fn(); } catch (e) { log({ level: 'error', msg: `scheduler: ${e.message}` }); } };

    return {
        app, server, db, router: r,
        close() { timers.forEach(clearInterval); app.hub.close(); server.close(); try { db.close(); } catch { /* ignore */ } },
    };
}

export const VERSION = '1.0.0';

/** القيم الأساسية عند أول تشغيل: الأدوار، القالب الافتراضي للبطاقة، والهوية. */
function bootstrap(app) {
    const { db } = app;
    const names = {
        super_admin: ['مدير النظام', 'Super Admin'], org_admin: ['إداري الجهة / العمادة', 'Organization Admin'], organizer: ['منظم فعالية', 'Event Organizer'],
        reception: ['موظف استقبال / أمن', 'Reception / Security'], it: ['فريق تقنية المعلومات', 'IT Team'], participant: ['مشارك / زائر', 'Participant'],
    };
    for (const role of DEFAULT_ROLES) {
        if (!one(db, 'SELECT id FROM roles WHERE key = ?', role.key)) run(db, 'INSERT INTO roles (key, name_ar, name_en, system, permissions) VALUES (?,?,?,?,?)', role.key, names[role.key][0], names[role.key][1], 1, JSON.stringify(role.permissions));
    }
    if (!one(db, 'SELECT id FROM badge_templates LIMIT 1')) {
        run(db, 'INSERT INTO badge_templates (name, width_mm, height_mm, design, is_default) VALUES (?,?,?,?,1)', 'CR80 عمودي', 54, 85.6, JSON.stringify(defaultDesign(54, 85.6)));
    }
    if (app.cfg.seedDemo && !one(db, 'SELECT id FROM events LIMIT 1')) {
        const n = seedDemo(app);
        app.log({ msg: 'demo data seeded', ...n });
    }
}

/** كل 30 ثانية: الأجهزة المنقطعة، Webhooks، التذكيرات المجدولة، وإنهاء الفعاليات المنقضية. */
async function tick(app) {
    const { db } = app;
    app.devices.sweep();
    await app.integrations.deliverWebhooks();
    const now = new Date().toISOString();
    for (const inv of all(db, "SELECT * FROM invitations WHERE remind_at IS NOT NULL AND remind_at <= ? AND reminded_at IS NULL AND status IN ('sent','confirmed') LIMIT 50", now)) {
        if (inv.channel === 'none') { run(db, "UPDATE invitations SET reminded_at = datetime('now') WHERE id = ?", inv.id); continue; }
        await app.events.sendInvitation(inv, 'reminder');
    }
    for (const ev of all(db, "SELECT id, status FROM events WHERE status IN ('published','running') AND ends_at < ?", new Date(Date.now() - 6 * 3600_000).toISOString())) {
        run(db, "UPDATE events SET status = 'ended' WHERE id = ?", ev.id);
        run(db, "UPDATE invitations SET status = 'expired' WHERE event_id = ? AND status IN ('pending','sent')", ev.id);
        app.audit.record({ name: 'scheduler' }, 'events.auto_end', 'events', ev.id, { status: ev.status }, { status: 'ended' });
    }
}

/** سياسة الاحتفاظ (نظام حماية البيانات الشخصية): إخفاء هوية الزوار غير النشطين بعد المدة، وحذف الجلسات القديمة. */
export function retention(app) {
    const { db } = app;
    const r = { visitor_days: 730, ...app.getSetting('retention', {}) };
    const cutoff = new Date(Date.now() - r.visitor_days * 86400_000).toISOString();
    const stale = all(db, `SELECT v.id FROM visitors v WHERE v.created_at < ? AND v.name_ar != '—' AND v.blocked = 0
        AND NOT EXISTS (SELECT 1 FROM attendance_logs l WHERE l.visitor_id = v.id AND l.at >= ?)
        AND NOT EXISTS (SELECT 1 FROM invitations i JOIN events e ON e.id = i.event_id WHERE i.visitor_id = v.id AND e.ends_at >= ?)`, cutoff, cutoff, cutoff);
    for (const v of stale) run(db, "UPDATE visitors SET name_ar = '—', name_en = NULL, phone = NULL, email = NULL, national_id_enc = NULL, national_id_hash = NULL, national_id_last4 = NULL, photo = NULL, interests = NULL, job_title = NULL WHERE id = ?", v.id);
    run(db, 'DELETE FROM sessions WHERE revoked = 1 OR last_seen < ?', Date.now() - 30 * 86400_000);
    run(db, "DELETE FROM webhook_deliveries WHERE status != 'pending' AND created_at < datetime('now', '-30 days')");
    if (stale.length) app.audit.record({ name: 'retention' }, 'visitors.anonymize', 'visitors', null, null, { count: stale.length, older_than_days: r.visitor_days });
    return { anonymized: stale.length };
}

/** مسارات الـ CRUD العامة لكل الموارد المعرّفة (تُسجّل أخيراً لتسبقها المسارات المخصصة). */
function registerResourceRoutes(r, app) {
    const R = app.resources;
    const names = Object.keys(RESOURCES);
    const res = (ctx) => { if (!names.includes(ctx.params.resource)) throw new HttpError(404, 'not_found'); return ctx.params.resource; };
    const body = async (ctx) => (await import('./http.js')).readJson(ctx.req, 3_000_000);
    r.get('/api/v1/:resource', { tag: 'resources', summary: 'قائمة مع بحث (q) وفلاتر (f_<حقل>) وترتيب (sort, dir) وترقيم (page, size)' }, (ctx) => R.list(ctx, res(ctx)));
    r.get('/api/v1/:resource/export', { tag: 'resources', summary: 'تصدير (format=xlsx|csv)' }, (ctx) => ({ __file: R.exportRows(ctx, res(ctx), ctx.query.format === 'csv' ? 'csv' : 'xlsx', ctx.query.labels ? JSON.parse(ctx.query.labels) : null) }));
    r.post('/api/v1/:resource', { tag: 'resources', summary: 'إنشاء' }, async (ctx) => R.create(ctx, res(ctx), await body(ctx)));
    r.get('/api/v1/:resource/:id', { tag: 'resources', summary: 'عرض' }, (ctx) => R.get(ctx, res(ctx), ctx.params.id));
    r.put('/api/v1/:resource/:id', { tag: 'resources', summary: 'تعديل' }, async (ctx) => R.update(ctx, res(ctx), ctx.params.id, await body(ctx)));
    r.del('/api/v1/:resource/:id', { tag: 'resources', summary: 'حذف' }, (ctx) => R.remove(ctx, res(ctx), ctx.params.id));
}

function makeMetrics() {
    const httpCount = new Map();
    const buckets = [5, 25, 100, 250, 500, 1000, 5000];
    const scanBuckets = new Array(buckets.length + 1).fill(0);
    let scanSum = 0, scanN = 0, scanOk = 0, scanRejected = 0;
    return {
        http(status, ms) { const k = `${Math.floor(status / 100)}xx`; httpCount.set(k, (httpCount.get(k) || 0) + 1); },
        scan(ok, ms) {
            ok ? scanOk++ : scanRejected++;
            scanSum += ms / 1000; scanN++;
            const i = buckets.findIndex((b) => ms <= b);
            scanBuckets[i < 0 ? buckets.length : i]++;
        },
        render(extra) {
            const lines = ['# TYPE tanzeem_http_requests_total counter'];
            for (const [k, v] of httpCount) lines.push(`tanzeem_http_requests_total{class="${k}"} ${v}`);
            lines.push('# TYPE tanzeem_scan_total counter', `tanzeem_scan_total{result="ok"} ${scanOk}`, `tanzeem_scan_total{result="rejected"} ${scanRejected}`);
            lines.push('# TYPE tanzeem_scan_seconds histogram');
            let acc = 0;
            buckets.forEach((b, i) => { acc += scanBuckets[i]; lines.push(`tanzeem_scan_seconds_bucket{le="${b / 1000}"} ${acc}`); });
            lines.push(`tanzeem_scan_seconds_bucket{le="+Inf"} ${scanN}`, `tanzeem_scan_seconds_sum ${scanSum.toFixed(4)}`, `tanzeem_scan_seconds_count ${scanN}`);
            lines.push('# TYPE tanzeem_ws_clients gauge', `tanzeem_ws_clients ${extra.ws.clients || 0}`, `tanzeem_ws_devices ${extra.ws.devices || 0}`);
            lines.push('# TYPE tanzeem_inside gauge', `tanzeem_inside ${extra.inside}`, `tanzeem_devices_online ${extra.devices_online}`);
            lines.push(`tanzeem_process_resident_bytes ${process.memoryUsage().rss}`, `tanzeem_uptime_seconds ${Math.round(process.uptime())}`);
            return lines.join('\n') + '\n';
        },
    };
}
