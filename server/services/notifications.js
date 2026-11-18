// تنظيم — التنبيهات: ازدحام منطقة، جهاز منقطع، ورق منخفض، دخول زائر محظور، فشل تكامل، وإعلانات المنظمين.
import { one, all, run } from '../db.js';
import { fail, readJson } from '../http.js';
import { NOTIF_PRIORITIES } from '../../shared/resources.js';

export function makeNotify(app) {
    const { db } = app;
    /** notify(type, priority, params, entity, entityId, { dedupe, minutes }) — يتجاهل التكرار خلال النافذة. */
    return function notify(type, priority = 'medium', params = {}, entity = null, entityId = null, opts = {}) {
        if (opts.dedupe) {
            const since = new Date(Date.now() - (opts.minutes || 15) * 60_000).toISOString();
            const dup = one(db, "SELECT id FROM notifications WHERE dedupe = ? AND status != 'resolved' AND created_at > ?", opts.dedupe, since);
            if (dup) return dup.id;
        }
        const orgId = entity === 'events' && entityId ? one(db, 'SELECT org_id FROM events WHERE id = ?', entityId)?.org_id ?? null : null;
        const id = Number(run(db, 'INSERT INTO notifications (type, priority, params, entity, entity_id, org_id, dedupe) VALUES (?,?,?,?,?,?,?)', type, priority, JSON.stringify(params), entity, entityId, orgId, opts.dedupe || null).lastInsertRowid);
        const n = one(db, 'SELECT * FROM notifications WHERE id = ?', id);
        app.hub?.publish('notifications', 'notification', { ...n, params });
        if (type === 'announcement' && entity === 'events') app.hub?.publish(`announce:${entityId}`, 'announcement', { ...n, params });
        return id;
    };
}

export function registerNotifications(r, app) {
    const { db } = app;
    r.get('/api/v1/notifications', { tag: 'notifications', summary: 'التنبيهات مع الفلترة بالحالة والأولوية والنوع' }, (ctx) => {
        app.auth.need(ctx, 'notifications', 'view');
        const q = ctx.query;
        const where = [];
        const args = [];
        for (const k of ['status', 'priority', 'type']) if (q[k]) { where.push(`${k} = ?`); args.push(q[k]); }
        const sc = app.auth.scope(ctx, 'notifications', 'view');
        if (!sc.all) { where.push(`(org_id IS NULL OR org_id IN (${sc.orgs.map(() => '?').join(',') || 'NULL'}))`); args.push(...sc.orgs); }
        const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const size = Math.min(Number(q.size) || 30, 200), page = Math.max(Number(q.page) || 1, 1);
        const total = one(db, `SELECT COUNT(*) n FROM notifications ${w}`, ...args).n;
        const rows = all(db, `SELECT * FROM notifications ${w} ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'ack' THEN 1 ELSE 2 END, CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id DESC LIMIT ? OFFSET ?`, ...args, size, (page - 1) * size)
            .map((n) => ({ ...n, params: JSON.parse(n.params) }));
        const counts = Object.fromEntries(all(db, "SELECT priority, COUNT(*) n FROM notifications WHERE status = 'new' GROUP BY priority").map((x) => [x.priority, x.n]));
        return { rows, total, page, size, counts, unread: one(db, "SELECT COUNT(*) n FROM notifications WHERE status = 'new'").n };
    });
    r.post('/api/v1/notifications/:id/:action', { tag: 'notifications', summary: 'إجراء سريع: ack | resolve | reopen' }, (ctx) => {
        app.auth.need(ctx, 'notifications', 'update');
        const st = { ack: 'ack', resolve: 'resolved', reopen: 'new' }[ctx.params.action] || fail(404, 'not_found');
        const ids = ctx.params.id === 'all' ? all(db, "SELECT id FROM notifications WHERE status = 'new'").map((x) => x.id) : [Number(ctx.params.id)];
        for (const id of ids) run(db, `UPDATE notifications SET status = ?, resolved_by = ?, resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE resolved_at END WHERE id = ?`, st, ctx.actor.userId, st, id);
        app.audit.record(app.auth.actorOf(ctx), `notifications.${ctx.params.action}`, 'notifications', ctx.params.id, null, { count: ids.length });
        app.hub?.publish('notifications', 'notification_update', { ids, status: st });
        return { ok: true, count: ids.length };
    });
    r.post('/api/v1/notifications/announce', { tag: 'notifications', summary: 'إرسال تنبيه/إعلان لمشاركي فعالية (من تطبيق المنظم)' }, async (ctx) => {
        const b = await readJson(ctx.req);
        const ev = one(db, 'SELECT id, org_id, title_ar FROM events WHERE id = ?', Number(b.event_id)) || fail(404, 'not_found');
        app.auth.need(ctx, 'notifications', 'create', { orgId: ev.org_id, eventId: ev.id });
        const text = String(b.message || '').trim().slice(0, 500);
        if (!text) fail(422, 'invalid', { errors: [{ field: 'message', code: 'required' }] });
        const priority = NOTIF_PRIORITIES.includes(b.priority) ? b.priority : 'medium';
        const id = app.notify('announcement', priority, { message: text, event: ev.title_ar, by: ctx.actor.name }, 'events', ev.id);
        app.audit.record(app.auth.actorOf(ctx), 'notifications.announce', 'events', ev.id, null, { message: text, priority });
        return { id };
    });
}
