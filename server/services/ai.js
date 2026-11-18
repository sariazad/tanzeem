// تنظيم — وحدة الذكاء (قابلة للتعطيل): توقّع الازدحام، توصيات التواصل بين المشاركين (الشبكات الذكية)، ومؤشرات التفاعل.
// المزوّد الافتراضي «مدمج» (خوارزميات محلية بلا اتصال خارجي) لأن البيئة On-Prem؛ ويمكن ربط نموذج لغوي داخل الشبكة.
import { one, all, run } from '../db.js';
import { fail, readJson } from '../http.js';

const tagsOf = (s) => new Set(String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));

export function makeAi(app) {
    const { db } = app;
    const enabled = () => app.getSetting('ai', { enabled: true }).enabled !== false;

    /** توقّع الإشغال بعد 30 دقيقة من معدل الدخول والخروج في آخر 30 دقيقة. */
    function forecast(eventId) {
        if (!enabled()) return null;
        const ev = one(db, 'SELECT capacity FROM events WHERE id = ?', eventId);
        const since = new Date(Date.now() - 30 * 60_000).toISOString();
        const r = one(db, "SELECT SUM(direction='in') i, SUM(direction='out') o FROM attendance_logs WHERE subject_type = 'event' AND subject_id = ? AND at >= ?", eventId, since);
        const inside = app.attendance.occupancy('event', eventId);
        const net = (r.i || 0) - (r.o || 0);
        const projected = Math.max(0, Math.round(inside + net));
        const cap = ev?.capacity || 0;
        const level = !cap ? 'unknown' : projected >= cap ? 'critical' : projected >= cap * 0.8 ? 'busy' : 'normal';
        const perMin = net / 30;
        const eta = cap && perMin > 0 && inside < cap ? Math.round((cap - inside) / perMin) : null;
        const etaMin = eta != null && eta <= 180 ? eta : null; // توقّع أبعد من 3 ساعات غير مفيد تشغيلياً
        return { inside, projected_30m: projected, rate_in_per_min: Math.round(((r.i || 0) / 30) * 10) / 10, level, minutes_to_capacity: etaMin };
    }

    /** توصيات: تشابه الاهتمامات (Jaccard) مع تفضيل التنوع بين الجهات، بين الحاضرين أو المسجلين. */
    function recommendations(eventId, forVisitorId = null, limit = 20) {
        if (!enabled()) return [];
        const people = all(db, `SELECT v.id, v.name_ar, v.name_en, v.org_name, v.category, v.interests, COALESCE(p.inside, 0) inside FROM registrations r JOIN visitors v ON v.id = r.visitor_id
            LEFT JOIN presence p ON p.subject_type = 'event' AND p.subject_id = r.event_id AND p.visitor_id = v.id
            WHERE r.event_id = ? AND r.status = 'confirmed' AND v.blocked = 0 AND v.interests IS NOT NULL AND v.interests != ''`, eventId);
        const done = new Set(all(db, 'SELECT a_id, b_id FROM connections WHERE event_id = ?', eventId).map((c) => `${Math.min(c.a_id, c.b_id)}:${Math.max(c.a_id, c.b_id)}`));
        const T = people.map((p) => ({ ...p, t: tagsOf(p.interests) }));
        const pairs = [];
        const src = forVisitorId ? T.filter((p) => p.id === Number(forVisitorId)) : T;
        for (const a of src) {
            for (const b of T) {
                if (a.id === b.id || (!forVisitorId && a.id > b.id)) continue;
                if (done.has(`${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`)) continue;
                const shared = [...a.t].filter((x) => b.t.has(x));
                if (!shared.length) continue;
                const union = new Set([...a.t, ...b.t]).size;
                let score = shared.length / union;
                if (a.org_name && b.org_name && a.org_name !== b.org_name) score *= 1.15;
                if (a.inside && b.inside) score *= 1.25;
                pairs.push({ a: pick(a), b: pick(b), shared, score: Math.round(Math.min(score, 1) * 100) });
            }
        }
        return pairs.sort((x, y) => y.score - x.score).slice(0, limit);
    }
    const pick = (p) => ({ id: p.id, name_ar: p.name_ar, name_en: p.name_en, org_name: p.org_name, category: p.category, inside: !!p.inside });

    function engagement(eventId) {
        const reg = one(db, "SELECT COUNT(*) n FROM registrations WHERE event_id = ? AND status = 'confirmed'", eventId).n;
        const attended = one(db, "SELECT COUNT(DISTINCT visitor_id) n FROM attendance_logs WHERE subject_type = 'event' AND subject_id = ? AND direction = 'in'", eventId).n;
        const conns = all(db, 'SELECT a_id, b_id, source, created_at FROM connections WHERE event_id = ?', eventId);
        const active = new Set(conns.flatMap((c) => [c.a_id, c.b_id])).size;
        const interests = {};
        for (const r of all(db, "SELECT v.interests FROM registrations r JOIN visitors v ON v.id = r.visitor_id WHERE r.event_id = ? AND r.status = 'confirmed'", eventId)) {
            for (const t of tagsOf(r.interests)) interests[t] = (interests[t] || 0) + 1;
        }
        const zones = all(db, "SELECT z.name_ar, z.name_en, COUNT(DISTINCT l.visitor_id) n FROM attendance_logs l JOIN zones z ON z.id = l.zone_id WHERE l.subject_type = 'event' AND l.subject_id = ? GROUP BY z.id ORDER BY n DESC", eventId);
        const orgs = all(db, "SELECT COALESCE(v.org_name, '—') org, COUNT(*) n FROM attendance_logs l JOIN visitors v ON v.id = l.visitor_id WHERE l.subject_type = 'event' AND l.subject_id = ? AND l.direction = 'in' GROUP BY v.org_name ORDER BY n DESC LIMIT 8", eventId);
        return {
            registered: reg, attended, connections: conns.length, active_networkers: active,
            engagement_rate: attended ? Math.round((active / attended) * 100) : 0, avg_connections: active ? Math.round((conns.length * 2 / active) * 10) / 10 : 0,
            top_interests: Object.entries(interests).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, n]) => ({ tag, n })), zones, orgs,
            recent: conns.slice(-10).reverse(),
        };
    }

    function connect(eventId, a, b, source = 'recommendation') {
        const [x, y] = [Math.min(a, b), Math.max(a, b)];
        if (x === y) fail(422, 'invalid');
        run(db, 'INSERT OR IGNORE INTO connections (event_id, a_id, b_id, source) VALUES (?,?,?,?)', eventId, x, y, source);
        app.hub?.publish(`event:${eventId}`, 'connection', { a: x, b: y });
    }

    return { forecast, recommendations, engagement, connect, enabled };
}

export function registerAi(r, app) {
    const { db } = app;
    const evGuard = (ctx, id, action = 'view') => {
        const ev = one(db, 'SELECT id, org_id FROM events WHERE id = ?', Number(id)) || fail(404, 'not_found');
        app.auth.need(ctx, 'events', action, { orgId: ev.org_id, eventId: ev.id });
        return ev;
    };
    r.get('/api/v1/events/:id/networking', { tag: 'networking', summary: 'مؤشرات التفاعل والتوصيات الذكية' }, (ctx) => {
        const ev = evGuard(ctx, ctx.params.id);
        return { ...app.ai.engagement(ev.id), recommendations: app.ai.recommendations(ev.id), enabled: app.ai.enabled(), forecast: app.ai.forecast(ev.id) };
    });
    r.post('/api/v1/events/:id/networking/connect', { tag: 'networking', summary: 'ربط مشاركَين (تعارف)' }, async (ctx) => {
        const ev = evGuard(ctx, ctx.params.id, 'update');
        const { a, b } = await readJson(ctx.req);
        app.ai.connect(ev.id, Number(a), Number(b), 'organizer');
        app.audit.record(app.auth.actorOf(ctx), 'networking.connect', 'events', ev.id, null, { a, b });
        return { ok: true };
    });
    r.get('/api/v1/events/:id/forecast', { tag: 'networking', summary: 'توقّع الازدحام' }, (ctx) => app.ai.forecast(evGuard(ctx, ctx.params.id).id));
    /* للمشارك من تطبيقه */
    const invOf = (token) => one(db, "SELECT * FROM invitations WHERE token = ? AND status = 'confirmed'", String(token)) || fail(404, 'not_found');
    r.get('/api/public/inv/:token/recommendations', { public: true, tag: 'public' }, (ctx) => {
        const inv = invOf(ctx.params.token);
        return { rows: app.ai.recommendations(inv.event_id, inv.visitor_id, 10).map((p) => ({ person: p.b, shared: p.shared, score: p.score })) };
    });
    r.post('/api/public/inv/:token/connect', { public: true, tag: 'public' }, async (ctx) => {
        const inv = invOf(ctx.params.token);
        const { visitor_id } = await readJson(ctx.req);
        const ok = one(db, "SELECT 1 FROM registrations WHERE event_id = ? AND visitor_id = ? AND status = 'confirmed'", inv.event_id, Number(visitor_id));
        if (!ok) fail(404, 'not_found');
        app.ai.connect(inv.event_id, inv.visitor_id, Number(visitor_id), 'participant');
        return { ok: true };
    });
    r.put('/api/public/inv/:token/interests', { public: true, tag: 'public' }, async (ctx) => {
        const inv = invOf(ctx.params.token);
        const { interests } = await readJson(ctx.req);
        const v = (Array.isArray(interests) ? interests : String(interests || '').split(/[,،]/)).map((s) => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, 15).join(',');
        run(db, 'UPDATE visitors SET interests = ? WHERE id = ?', v, inv.visitor_id);
        return { ok: true };
    });
}
