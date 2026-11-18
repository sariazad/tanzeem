// تنظيم — لوحة التحكم (مؤشرات لحظية) والتقارير (حضور، أوقات، مشاركة، أداء، زيارات، زوار، أجهزة) والتصدير والجدولة.
import { one, all, run } from '../db.js';
import { fail, readJson } from '../http.js';
import { REPORTS } from '../../shared/resources.js';

// الرياض UTC+3 بلا توقيت صيفي
const TZ_MS = 3 * 3600_000;
const dayStart = (d = new Date()) => new Date(Math.floor((d.getTime() + TZ_MS) / 86400_000) * 86400_000 - TZ_MS);
const riyadhHour = (iso) => new Date(new Date(iso).getTime() + TZ_MS).getUTCHours();

export function makeReports(app) {
    const { db } = app;

    /** الفعاليات المسموح بها للمستخدم (لتقييد اللوحة والتقارير). */
    function eventIds(ctx, module = 'reports') {
        const s = app.auth.scope(ctx, module, 'view');
        if (s.all) return null;
        const ids = new Set(s.events);
        if (s.orgs.length) for (const e of all(db, `SELECT id FROM events WHERE org_id IN (${s.orgs.map(() => '?').join(',')})`, ...s.orgs)) ids.add(e.id);
        return [...ids];
    }
    const inList = (ids, col) => (ids == null ? { sql: '1', args: [] } : { sql: ids.length ? `${col} IN (${ids.map(() => '?').join(',')})` : '0', args: ids });

    function dashboard(ctx) {
        app.auth.need(ctx, 'dashboard', 'view');
        const ids = eventIds(ctx, 'dashboard');
        const ev = inList(ids, 'id');
        const att = inList(ids, 'subject_id');
        const start = dayStart().toISOString();
        const now = new Date().toISOString();
        const active = one(db, `SELECT COUNT(*) n FROM events WHERE ${ev.sql} AND archived = 0 AND (status = 'running' OR (status = 'published' AND starts_at <= ? AND ends_at >= ?))`, ...ev.args, new Date(Date.now() + 12 * 3600_000).toISOString(), now).n;
        const insideEvents = one(db, `SELECT COUNT(*) n FROM presence WHERE subject_type = 'event' AND inside = 1 AND ${att.sql}`, ...att.args).n;
        const insideVisits = ids == null ? one(db, "SELECT COUNT(*) n FROM presence WHERE subject_type = 'visit' AND inside = 1").n : 0;
        const today = one(db, `SELECT COUNT(DISTINCT visitor_id) n FROM attendance_logs WHERE direction = 'in' AND at >= ? AND (subject_type = 'visit' OR ${att.sql})`, start, ...att.args).n;
        const todays = all(db, `SELECT id FROM events WHERE ${ev.sql} AND starts_at < ? AND ends_at >= ? AND status != 'cancelled'`, ...ev.args, new Date(dayStart().getTime() + 86400_000).toISOString(), start).map((e) => e.id);
        let rate = 0;
        if (todays.length) {
            const reg = one(db, `SELECT COUNT(*) n FROM registrations WHERE status = 'confirmed' AND event_id IN (${todays.map(() => '?').join(',')})`, ...todays).n;
            const came = one(db, `SELECT COUNT(DISTINCT subject_id || ':' || visitor_id) n FROM attendance_logs WHERE subject_type = 'event' AND direction = 'in' AND subject_id IN (${todays.map(() => '?').join(',')})`, ...todays).n;
            rate = reg ? Math.round((came / reg) * 100) : 0;
        }
        const evi = inList(ids, 'event_id');
        const invTotal = one(db, `SELECT COUNT(*) n FROM invitations i JOIN events e ON e.id = i.event_id WHERE e.ends_at >= ? AND i.status != 'cancelled' AND ${evi.sql.replace('event_id', 'i.event_id')}`, now, ...evi.args).n;
        const invConf = one(db, `SELECT COUNT(*) n FROM invitations i JOIN events e ON e.id = i.event_id WHERE e.ends_at >= ? AND i.status = 'confirmed' AND ${evi.sql.replace('event_id', 'i.event_id')}`, now, ...evi.args).n;
        const devices = one(db, "SELECT SUM(status IN ('online','paper_low')) online, COUNT(*) total FROM devices WHERE status != 'pending'");
        // الدخول والخروج بالساعة لليوم
        const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, in: 0, out: 0 }));
        for (const l of all(db, `SELECT direction, at FROM attendance_logs WHERE at >= ? AND (subject_type = 'visit' OR ${att.sql})`, start, ...att.args)) hourly[riyadhHour(l.at)][l.direction]++;
        const recent = all(db, `SELECT l.id, l.direction, l.method, l.gate, l.at, l.subject_type, l.subject_id, v.name_ar, v.name_en, v.category,
            CASE l.subject_type WHEN 'event' THEN (SELECT title_ar FROM events WHERE id = l.subject_id) ELSE (SELECT title FROM visits WHERE id = l.subject_id) END subject_title
            FROM attendance_logs l JOIN visitors v ON v.id = l.visitor_id WHERE (l.subject_type = 'visit' OR ${att.sql.replace('subject_id', 'l.subject_id')}) ORDER BY l.id DESC LIMIT 12`, ...att.args);
        const alerts = all(db, "SELECT * FROM notifications WHERE status = 'new' ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id DESC LIMIT 6").map((n) => ({ ...n, params: JSON.parse(n.params) }));
        const upcoming = app.resources.hooks.events.decorate(all(db, `SELECT * FROM events WHERE ${ev.sql} AND archived = 0 AND status IN ('published','running','draft') AND ends_at >= ? ORDER BY starts_at LIMIT 6`, ...ev.args, now));
        const running = all(db, `SELECT id, title_ar, title_en, capacity FROM events WHERE ${ev.sql} AND status = 'running'`, ...ev.args).map((e) => ({ ...e, ...app.attendance.stats('event', e.id), forecast: app.ai.forecast(e.id) }));
        const pendingVisits = ids == null || app.auth.scope(ctx, 'visits').all ? one(db, "SELECT COUNT(*) n FROM visits WHERE status = 'requested'").n : 0;
        return { kpi: { active_events: active, inside_now: insideEvents + insideVisits, visitors_today: today, attendance_rate: rate, invitations_confirmed: invConf, invitations_total: invTotal, devices_online: devices.online || 0, devices_total: devices.total || 0, pending_visits: pendingVisits }, hourly, recent, alerts, upcoming, running };
    }

    function filters(ctx, q) {
        const ids = eventIds(ctx);
        const where = [];
        const args = [];
        const ev = inList(ids, 'e.id');
        where.push(ev.sql); args.push(...ev.args);
        if (q.event_id) { where.push('e.id = ?'); args.push(Number(q.event_id)); }
        if (q.org_id) { where.push('e.org_id = ?'); args.push(Number(q.org_id)); }
        if (q.from) { where.push('e.ends_at >= ?'); args.push(new Date(q.from).toISOString()); }
        if (q.to) { where.push('e.starts_at <= ?'); args.push(new Date(new Date(q.to).getTime() + 86400_000 - 1).toISOString()); }
        if (q.type) { where.push('e.type = ?'); args.push(q.type); }
        return { sql: where.join(' AND '), args };
    }

    const C = (key, type = 'text') => ({ key, type });

    function build(ctx, report, q = {}) {
        app.auth.need(ctx, 'reports', 'view');
        if (!REPORTS.includes(report)) fail(404, 'no_report');
        const f = filters(ctx, q);
        if (report === 'attendance') {
            const rows = all(db, `SELECT e.title_ar event, v.name_ar name, v.name_en, v.org_name, v.category,
                MIN(CASE WHEN l.direction='in' THEN l.at END) first_in, MAX(CASE WHEN l.direction='out' THEN l.at END) last_out,
                SUM(l.direction='in') entries, (SELECT method FROM attendance_logs x WHERE x.subject_type='event' AND x.subject_id=e.id AND x.visitor_id=v.id AND x.direction='in' ORDER BY x.id LIMIT 1) method,
                COALESCE(p.inside, 0) inside
                FROM attendance_logs l JOIN events e ON e.id = l.subject_id AND l.subject_type = 'event' JOIN visitors v ON v.id = l.visitor_id
                LEFT JOIN presence p ON p.subject_type = 'event' AND p.subject_id = e.id AND p.visitor_id = v.id
                WHERE ${f.sql} GROUP BY e.id, v.id ORDER BY first_in LIMIT 50000`, ...f.args)
                .map((r) => ({ ...r, duration_min: r.first_in && r.last_out ? Math.max(0, Math.round((new Date(r.last_out) - new Date(r.first_in)) / 60000)) : null }));
            const byCat = {};
            const byMethod = {};
            for (const r of rows) { byCat[r.category] = (byCat[r.category] || 0) + 1; byMethod[r.method] = (byMethod[r.method] || 0) + 1; }
            return { columns: [C('event'), C('name'), C('name_en'), C('org_name'), C('category', 'category'), C('first_in', 'datetime'), C('last_out', 'datetime'), C('duration_min', 'number'), C('entries', 'number'), C('method', 'method'), C('inside', 'bool')], rows, charts: { by_category: byCat, by_method: byMethod }, summary: { total: rows.length, inside: rows.filter((r) => r.inside).length } };
        }
        if (report === 'timings') {
            const hours = Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, '0')}:00`, in: 0, out: 0 }));
            for (const l of all(db, `SELECT l.direction, l.at FROM attendance_logs l JOIN events e ON e.id = l.subject_id AND l.subject_type = 'event' WHERE ${f.sql}`, ...f.args)) hours[riyadhHour(l.at)][l.direction]++;
            const peak = hours.reduce((a, b) => (b.in > a.in ? b : a), hours[0]);
            return { columns: [C('hour'), C('in', 'number'), C('out', 'number')], rows: hours, charts: { hourly: hours }, summary: { peak_hour: peak.hour, peak_in: peak.in } };
        }
        if (report === 'participation') {
            const rows = all(db, `SELECT e.id, e.title_ar event, e.type, e.starts_at, e.capacity,
                (SELECT COUNT(*) FROM invitations WHERE event_id = e.id AND status != 'cancelled') invited,
                (SELECT COUNT(*) FROM invitations WHERE event_id = e.id AND status = 'confirmed') confirmed,
                (SELECT COUNT(*) FROM invitations WHERE event_id = e.id AND status = 'declined') declined,
                (SELECT COUNT(*) FROM registrations WHERE event_id = e.id AND status = 'confirmed') registered,
                (SELECT COUNT(DISTINCT visitor_id) FROM attendance_logs WHERE subject_type = 'event' AND subject_id = e.id AND direction = 'in') attended
                FROM events e WHERE ${f.sql} ORDER BY e.starts_at DESC`, ...f.args)
                .map((r) => ({ ...r, confirm_rate: r.invited ? Math.round((r.confirmed / r.invited) * 100) : null, attendance_rate: r.registered ? Math.round((r.attended / r.registered) * 100) : null, occupancy_rate: r.capacity ? Math.round((r.attended / r.capacity) * 100) : null }));
            const t = rows.reduce((a, r) => ({ invited: a.invited + r.invited, confirmed: a.confirmed + r.confirmed, registered: a.registered + r.registered, attended: a.attended + r.attended }), { invited: 0, confirmed: 0, registered: 0, attended: 0 });
            return { columns: [C('event'), C('type', 'event_type'), C('starts_at', 'datetime'), C('invited', 'number'), C('confirmed', 'number'), C('declined', 'number'), C('registered', 'number'), C('attended', 'number'), C('confirm_rate', 'percent'), C('attendance_rate', 'percent'), C('occupancy_rate', 'percent')], rows, charts: { funnel: t }, summary: { ...t, rate: t.registered ? Math.round((t.attended / t.registered) * 100) : 0 } };
        }
        if (report === 'performance') {
            const rows = all(db, `SELECT e.id, e.title_ar event, e.starts_at FROM events e WHERE ${f.sql} ORDER BY e.starts_at DESC`, ...f.args).map((e) => {
                const logs = all(db, "SELECT visitor_id, direction, method, at, device_id FROM attendance_logs WHERE subject_type = 'event' AND subject_id = ? ORDER BY at", e.id);
                const hours = new Array(24).fill(0);
                const methods = {};
                const firstIn = new Map();
                let dwell = 0, dwellN = 0;
                for (const l of logs) {
                    if (l.direction === 'in') { hours[riyadhHour(l.at)]++; methods[l.method] = (methods[l.method] || 0) + 1; if (!firstIn.has(l.visitor_id)) firstIn.set(l.visitor_id, l.at); }
                    else if (firstIn.has(l.visitor_id)) { dwell += (new Date(l.at) - new Date(firstIn.get(l.visitor_id))) / 60000; dwellN++; }
                }
                const peakH = hours.indexOf(Math.max(...hours));
                const rejected = one(db, "SELECT COUNT(*) n FROM audit_log WHERE action = 'attendance.rejected' AND entity = 'events' AND entity_id = ?", String(e.id)).n;
                const printed = one(db, "SELECT COUNT(*) n FROM print_jobs WHERE subject_type = 'event' AND subject_id = ?", e.id).n;
                const devices = new Set(logs.map((l) => l.device_id).filter(Boolean)).size;
                return { event: e.event, starts_at: e.starts_at, entries: logs.filter((l) => l.direction === 'in').length, peak_hour: logs.length ? `${String(peakH).padStart(2, '0')}:00` : '', peak_in: hours[peakH] || 0, avg_dwell_min: dwellN ? Math.round(dwell / dwellN) : null, qr: methods.qr || 0, kiosk: methods.kiosk || 0, manual: methods.manual || 0, bulk: methods.bulk || 0, mobile: methods.mobile || 0, rejected, printed, devices };
            });
            return { columns: [C('event'), C('starts_at', 'datetime'), C('entries', 'number'), C('peak_hour'), C('peak_in', 'number'), C('avg_dwell_min', 'number'), C('qr', 'number'), C('kiosk', 'number'), C('manual', 'number'), C('bulk', 'number'), C('rejected', 'number'), C('printed', 'number'), C('devices', 'number')], rows, charts: {}, summary: { events: rows.length, scan_p95_ms: Math.round(app.attendance.p95() * 10) / 10 } };
        }
        if (report === 'visits') {
            app.auth.need(ctx, 'visits', 'view');
            const w = ['1'], a = [];
            if (q.from) { w.push('s.ends_at >= ?'); a.push(new Date(q.from).toISOString()); }
            if (q.to) { w.push('s.starts_at <= ?'); a.push(new Date(new Date(q.to).getTime() + 86400_000 - 1).toISOString()); }
            if (q.org_id) { w.push('s.org_id = ?'); a.push(Number(q.org_id)); }
            const sc = app.auth.scope(ctx, 'visits');
            if (!sc.all) { w.push(sc.orgs.length ? `s.org_id IN (${sc.orgs.map(() => '?').join(',')})` : '0'); a.push(...sc.orgs); }
            const rows = all(db, `SELECT s.title, s.host_name, s.location, s.starts_at, s.ends_at, s.status, (SELECT name_ar FROM orgs WHERE id = s.org_id) org,
                (SELECT COUNT(*) FROM visit_visitors WHERE visit_id = s.id) participants,
                (SELECT COUNT(DISTINCT visitor_id) FROM attendance_logs WHERE subject_type = 'visit' AND subject_id = s.id AND direction = 'in') arrived
                FROM visits s WHERE ${w.join(' AND ')} ORDER BY s.starts_at DESC`, ...a);
            const byStatus = {};
            for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
            return { columns: [C('title'), C('org'), C('host_name'), C('location'), C('starts_at', 'datetime'), C('status', 'visit_status'), C('participants', 'number'), C('arrived', 'number')], rows, charts: { by_status: byStatus }, summary: { total: rows.length } };
        }
        if (report === 'visitors') {
            app.auth.need(ctx, 'visitors', 'view');
            const rows = all(db, `SELECT v.name_ar name, v.org_name, v.category, v.source, v.created_at, v.blocked,
                (SELECT COUNT(DISTINCT subject_type || subject_id) FROM attendance_logs WHERE visitor_id = v.id AND direction = 'in') visits_count,
                (SELECT MAX(at) FROM attendance_logs WHERE visitor_id = v.id) last_seen FROM visitors v ORDER BY v.id DESC LIMIT 50000`);
            const byCat = {};
            for (const r of rows) byCat[r.category] = (byCat[r.category] || 0) + 1;
            return { columns: [C('name'), C('org_name'), C('category', 'category'), C('source'), C('visits_count', 'number'), C('last_seen', 'datetime'), C('blocked', 'bool'), C('created_at', 'datetime')], rows, charts: { by_category: byCat }, summary: { total: rows.length, blocked: rows.filter((r) => r.blocked).length } };
        }
        if (report === 'devices') {
            app.auth.need(ctx, 'devices', 'view');
            const rows = all(db, `SELECT d.name, d.kind, d.location, d.status, d.version, d.last_seen,
                (SELECT COUNT(*) FROM device_faults WHERE device_id = d.id) faults,
                (SELECT COUNT(*) FROM print_jobs WHERE device_id = d.id AND status IN ('printed','preview')) printed,
                (SELECT COUNT(*) FROM attendance_logs WHERE device_id = d.id) scans FROM devices d ORDER BY d.kind, d.name`).map((r) => ({ ...r, last_seen: r.last_seen ? new Date(r.last_seen).toISOString() : null }));
            return { columns: [C('name'), C('kind', 'device_kind'), C('location'), C('status', 'device_status'), C('version'), C('last_seen', 'datetime'), C('faults', 'number'), C('printed', 'number'), C('scans', 'number')], rows, charts: {}, summary: { total: rows.length } };
        }
    }

    async function summarize(ctx, report, q) {
        const r = build(ctx, report, q);
        const facts = JSON.stringify({ report, summary: r.summary, charts: r.charts, sample: r.rows.slice(0, 15) });
        const ai = app.getSetting('ai', { enabled: true }).enabled ? await app.integrations.aiComplete(`لخّص هذا التقرير لإدارة جهة حكومية في 4 نقاط قصيرة بالعربية، أرقام دقيقة فقط من البيانات:\n${facts}`) : null;
        return { text: ai, builtin: r.summary };
    }

    /** إرسال التقارير المجدولة بالبريد (يُستدعى كل دقيقة). */
    async function runSchedules(now = new Date()) {
        const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', hour12: false }).format(now)) % 24;
        const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(now);
        const dow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })).getDay();
        const dom = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })).getDate();
        for (const s of all(db, 'SELECT * FROM report_schedules WHERE enabled = 1 AND hour = ?', h)) {
            if (s.last_run && s.last_run.startsWith(todayKey)) continue;
            if (s.frequency === 'weekly' && dow !== 0) continue;
            if (s.frequency === 'monthly' && dom !== 1) continue;
            run(db, 'UPDATE report_schedules SET last_run = ? WHERE id = ?', `${todayKey}T${String(h).padStart(2, '0')}`, s.id);
            const sys = { actor: { kind: 'system', name: 'scheduler', grants: [{ permissions: { '*': ['*'] }, scope_type: 'all' }] }, ip: null };
            try {
                const params = JSON.parse(s.params || '{}');
                const days = s.frequency === 'monthly' ? 31 : s.frequency === 'weekly' ? 7 : 1;
                const q = { from: new Date(now.getTime() - days * 86400_000).toISOString().slice(0, 10), to: todayKey, ...params };
                const r = build(sys, s.report, q);
                const file = app.exporter.file(s.format, `report-${s.report}`, r.columns.map((c) => ({ key: c.key, label: c.key })), r.rows);
                await app.integrations.sendMail({ to: s.recipients, subject: `${s.name} — ${todayKey}`, text: `${s.name}\n${JSON.stringify(r.summary)}`, attachments: [{ filename: file.filename, content: file.body }] });
                app.audit.record({ name: 'scheduler' }, 'reports.scheduled_sent', 'report_schedules', s.id, null, { rows: r.rows.length });
            } catch (e) {
                app.notify('report_failed', 'medium', { name: s.name, message: e.message.slice(0, 100) }, 'report_schedules', s.id);
            }
        }
    }

    return { dashboard, build, summarize, runSchedules, eventIds };
}

export function registerReports(r, app) {
    r.get('/api/v1/dashboard', { tag: 'dashboard', summary: 'مؤشرات لوحة التحكم اللحظية' }, (ctx) => app.reports.dashboard(ctx));
    r.get('/api/v1/reports/:report', { tag: 'reports', summary: 'تقرير: attendance | timings | participation | performance | visits | visitors | devices' }, (ctx) => app.reports.build(ctx, ctx.params.report, ctx.query));
    r.get('/api/v1/reports/:report/export', { tag: 'reports', summary: 'تصدير التقرير (xlsx | csv)' }, (ctx) => {
        app.auth.need(ctx, 'reports', 'export');
        const rep = app.reports.build(ctx, ctx.params.report, ctx.query);
        const labels = ctx.query.labels ? JSON.parse(ctx.query.labels) : {};
        const file = app.exporter.file(ctx.query.format === 'csv' ? 'csv' : 'xlsx', `report-${ctx.params.report}`, rep.columns.map((c) => ({ key: c.key, label: labels[c.key] || c.key })), rep.rows, { rtl: ctx.query.lang !== 'en' });
        app.audit.record(app.auth.actorOf(ctx), 'reports.export', 'reports', ctx.params.report, null, { format: ctx.query.format || 'xlsx', rows: rep.rows.length, filters: ctx.query });
        return { __file: file };
    });
    r.get('/api/v1/reports/:report/summary', { tag: 'reports', summary: 'ملخص ذكي للتقرير (اختياري)' }, (ctx) => app.reports.summarize(ctx, ctx.params.report, ctx.query));
}
