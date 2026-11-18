// تنظيم — الاعتمادات (رموز QR) والتحقق وتسجيل الدخول والخروج والإشغال اللحظي.
// القواعد: الرمز لا يحمل بيانات شخصية؛ التحقق من الخادم؛ لا دخول مزدوج قبل خروج؛ الزائر المحظور يُرفض وينبَّه الأمن.
import crypto from 'node:crypto';
import { one, all, run, tx } from '../db.js';
import { fail, readJson } from '../http.js';
import { signCredential, parseCredential, verifyCredentialSig, offlineFingerprint } from '../security.js';

export function makeAttendance(app) {
    const { db } = app;

    /* ───────── الاعتمادات ───────── */
    function issue(subjectType, subjectId, visitorId) {
        let c = one(db, 'SELECT * FROM credentials WHERE subject_type = ? AND subject_id = ? AND visitor_id = ?', subjectType, subjectId, visitorId);
        const subj = subjectRow(subjectType, subjectId);
        if (!subj) fail(404, 'no_subject');
        // صالح من قبل البداية بثلاث ساعات حتى نهاية اليوم التالي للنهاية
        const from = new Date(new Date(subj.starts_at).getTime() - 3 * 3600_000).toISOString();
        const to = new Date(new Date(subj.ends_at).getTime() + 12 * 3600_000).toISOString();
        if (!c) {
            const id = Number(run(db, 'INSERT INTO credentials (subject_type, subject_id, visitor_id, nonce, valid_from, valid_to) VALUES (?,?,?,?,?,?)', subjectType, subjectId, visitorId, crypto.randomBytes(9).toString('base64url'), from, to).lastInsertRowid);
            c = one(db, 'SELECT * FROM credentials WHERE id = ?', id);
        } else if (c.revoked || c.valid_from !== from || c.valid_to !== to) {
            run(db, 'UPDATE credentials SET revoked = 0, valid_from = ?, valid_to = ? WHERE id = ?', from, to, c.id);
            c = one(db, 'SELECT * FROM credentials WHERE id = ?', c.id);
        }
        return { id: c.id, token: signCredential(app.keys.qr, c.id, c.nonce) };
    }
    function revoke(subjectType, subjectId, visitorId) {
        run(db, 'UPDATE credentials SET revoked = 1 WHERE subject_type = ? AND subject_id = ? AND visitor_id = ?', subjectType, subjectId, visitorId);
    }
    /** إعادة إصدار الرمز (يُبطل القديم) — عند فقدان البطاقة مثلاً. */
    function rotate(credId) {
        run(db, 'UPDATE credentials SET nonce = ?, revoked = 0 WHERE id = ?', crypto.randomBytes(9).toString('base64url'), credId);
        const c = one(db, 'SELECT * FROM credentials WHERE id = ?', credId);
        return signCredential(app.keys.qr, c.id, c.nonce);
    }
    const tokenFor = (c) => signCredential(app.keys.qr, c.id, c.nonce);

    const subjectRow = (type, id) => type === 'event'
        ? one(db, 'SELECT id, org_id, title_ar, title_en, status, starts_at, ends_at, capacity FROM events WHERE id = ?', id)
        : one(db, 'SELECT id, org_id, title title_ar, title title_en, status, starts_at, ends_at, 0 capacity FROM visits WHERE id = ?', id);

    /** التحقق من الرمز وحده (دون تسجيل). */
    function verify(token) {
        const p = parseCredential(token);
        if (!p) return { ok: false, code: 'invalid_qr' };
        const c = one(db, 'SELECT * FROM credentials WHERE id = ?', p.id);
        if (!c || !verifyCredentialSig(app.keys.qr, c.id, c.nonce, token)) return { ok: false, code: 'invalid_qr' };
        if (c.revoked) return { ok: false, code: 'revoked', credential: c };
        const now = new Date().toISOString();
        if ((c.valid_from && now < c.valid_from) || (c.valid_to && now > c.valid_to)) return { ok: false, code: 'outside_window', credential: c };
        return { ok: true, credential: c };
    }

    /* ───────── الإشغال ───────── */
    const occupancy = (type, id) => one(db, 'SELECT COUNT(*) n FROM presence WHERE subject_type = ? AND subject_id = ? AND inside = 1', type, id).n;
    function zoneOccupancy(type, id) {
        return all(db, 'SELECT zone_id, COUNT(*) n FROM presence WHERE subject_type = ? AND subject_id = ? AND inside = 1 AND zone_id IS NOT NULL GROUP BY zone_id', type, id);
    }
    function stats(type, id) {
        const t = one(db, `SELECT SUM(direction='in') ins, SUM(direction='out') outs, COUNT(DISTINCT CASE WHEN direction='in' THEN visitor_id END) uniq FROM attendance_logs WHERE subject_type = ? AND subject_id = ?`, type, id);
        return { inside: occupancy(type, id), entries: t.ins || 0, exits: t.outs || 0, unique: t.uniq || 0 };
    }

    /* ───────── تسجيل الحضور ───────── */
    /**
     * scan({ token | visitorId+subject, direction: 'in'|'out'|'auto', method, gate, zoneId, deviceId, offlineAt })
     * → { ok, code, direction, visitor, subject, stats }
     */
    function scan(ctx, input) {
        const t0 = process.hrtime.bigint();
        let cred = null;
        let visitorId = input.visitorId ? Number(input.visitorId) : null;
        let subjectType = input.subjectType || 'event';
        let subjectId = input.subjectId ? Number(input.subjectId) : null;
        if (input.token) {
            const v = verify(input.token);
            if (!v.ok) return result(ctx, { ok: false, code: v.code, input }, t0);
            cred = v.credential;
            if (subjectId && (cred.subject_type !== subjectType || cred.subject_id !== subjectId)) return result(ctx, { ok: false, code: 'wrong_subject', input }, t0);
            visitorId = cred.visitor_id; subjectType = cred.subject_type; subjectId = cred.subject_id;
        }
        if (!visitorId || !subjectId) return result(ctx, { ok: false, code: 'missing', input }, t0);
        const subject = subjectRow(subjectType, subjectId);
        if (!subject) return result(ctx, { ok: false, code: 'no_subject', input }, t0);
        // صلاحية المنفّذ على هذا النطاق
        app.auth.need(ctx, 'checkin', 'create', { orgId: subject.org_id, eventId: subjectType === 'event' ? subjectId : null });
        const visitor = one(db, 'SELECT id, name_ar, name_en, org_name, category, photo, blocked FROM visitors WHERE id = ?', visitorId);
        if (!visitor) return result(ctx, { ok: false, code: 'no_visitor', input }, t0);
        const base = { visitor: publicVisitor(visitor), subject: { type: subjectType, id: subjectId, title_ar: subject.title_ar, title_en: subject.title_en } };
        if (visitor.blocked) {
            app.notify('blocked_visitor', 'critical', { name: visitor.name_ar, subject: subject.title_ar, gate: input.gate || '' }, 'visitors', visitor.id);
            app.integrations.emit('visitor.blocked_attempt', { visitor_id: visitor.id, subject_type: subjectType, subject_id: subjectId, gate: input.gate || null });
            return result(ctx, { ok: false, code: 'blocked', ...base, input }, t0);
        }
        if (subjectType === 'event' && ['cancelled', 'draft'].includes(subject.status)) return result(ctx, { ok: false, code: `event_${subject.status}`, ...base, input }, t0);
        if (subjectType === 'event' && subject.status === 'ended' && input.direction !== 'out') return result(ctx, { ok: false, code: 'event_ended', ...base, input }, t0);
        if (subjectType === 'visit' && !['approved', 'permit_issued', 'checked_in', 'checked_out'].includes(subject.status)) return result(ctx, { ok: false, code: 'visit_not_approved', ...base, input }, t0);
        if (!cred) {
            // تسجيل يدوي: يجب أن يكون الزائر مدعواً/مسجلاً أو مضافاً للزيارة (أو التسجيل المفتوح مسموح)
            const allowed = subjectType === 'event'
                ? one(db, "SELECT 1 FROM registrations WHERE event_id = ? AND visitor_id = ? AND status = 'confirmed'", subjectId, visitorId) || one(db, "SELECT 1 FROM invitations WHERE event_id = ? AND visitor_id = ? AND status IN ('sent','confirmed','pending')", subjectId, visitorId)
                : one(db, 'SELECT 1 FROM visit_visitors WHERE visit_id = ? AND visitor_id = ?', subjectId, visitorId);
            if (!allowed) return result(ctx, { ok: false, code: 'not_registered', ...base, input }, t0);
            cred = one(db, 'SELECT * FROM credentials WHERE subject_type = ? AND subject_id = ? AND visitor_id = ?', subjectType, subjectId, visitorId);
        }
        const pres = one(db, 'SELECT * FROM presence WHERE subject_type = ? AND subject_id = ? AND visitor_id = ?', subjectType, subjectId, visitorId);
        let direction = input.direction || 'in';
        if (direction === 'auto') direction = pres?.inside ? 'out' : 'in';
        if (direction === 'in' && pres?.inside) return result(ctx, { ok: false, code: 'already_inside', ...base, since: pres.last_at, input }, t0);
        if (direction === 'out' && !pres?.inside) return result(ctx, { ok: false, code: 'not_inside', ...base, input }, t0);
        if (direction === 'in' && subjectType === 'event' && subject.capacity > 0 && occupancy(subjectType, subjectId) >= subject.capacity) {
            app.notify('capacity_full', 'critical', { subject: subject.title_ar, capacity: subject.capacity }, 'events', subjectId, { dedupe: `cap:${subjectId}`, minutes: 15 });
            if (!input.force) return result(ctx, { ok: false, code: 'capacity_full', ...base, input }, t0);
        }
        const at = input.offlineAt ? new Date(input.offlineAt).toISOString() : new Date().toISOString();
        const zoneId = input.zoneId ? Number(input.zoneId) : null;
        tx(db, () => {
            run(db, 'INSERT INTO attendance_logs (subject_type, subject_id, visitor_id, credential_id, direction, method, gate, zone_id, device_id, user_id, offline, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                subjectType, subjectId, visitorId, cred?.id ?? null, direction, input.method || 'qr', input.gate || null, zoneId, input.deviceId || ctx.actor?.device?.id || null, ctx.actor?.userId || null, input.offlineAt ? 1 : 0, at);
            run(db, `INSERT INTO presence (subject_type, subject_id, visitor_id, inside, zone_id, first_in, last_at) VALUES (?,?,?,?,?,?,?)
                ON CONFLICT(subject_type, subject_id, visitor_id) DO UPDATE SET inside = excluded.inside, zone_id = CASE WHEN excluded.inside = 1 THEN COALESCE(excluded.zone_id, presence.zone_id) ELSE NULL END, last_at = excluded.last_at, first_in = COALESCE(presence.first_in, excluded.first_in)`,
            subjectType, subjectId, visitorId, direction === 'in' ? 1 : 0, direction === 'in' ? zoneId : null, direction === 'in' ? at : null, at);
            if (subjectType === 'event' && subject.status === 'published' && direction === 'in') run(db, "UPDATE events SET status = 'running' WHERE id = ?", subjectId);
            if (subjectType === 'visit') {
                const st = direction === 'in' ? 'checked_in' : (occupancy('visit', subjectId) === 0 ? 'checked_out' : 'checked_in');
                if (st !== subject.status) run(db, 'UPDATE visits SET status = ? WHERE id = ?', st, subjectId);
            }
        });
        const s = stats(subjectType, subjectId);
        const payload = { direction, method: input.method || 'qr', gate: input.gate || null, zone_id: zoneId, at, visitor: publicVisitor(visitor), subject: base.subject, stats: s };
        app.hub?.publish(`${subjectType}:${subjectId}`, 'attendance', payload);
        app.hub?.publish('dashboard', 'attendance', payload);
        app.integrations.emit(`attendance.${direction}`, { subject_type: subjectType, subject_id: subjectId, visitor_id: visitorId, method: payload.method, gate: payload.gate, at });
        if (zoneId) checkZone(subjectType, subjectId, zoneId);
        if (subjectType === 'event' && subject.capacity > 0 && s.inside >= subject.capacity * 0.9) {
            app.notify('event_crowded', s.inside >= subject.capacity ? 'critical' : 'high', { subject: subject.title_ar, inside: s.inside, capacity: subject.capacity }, 'events', subjectId, { dedupe: `crowd:${subjectId}`, minutes: 20 });
        }
        return result(ctx, { ok: true, code: direction === 'in' ? 'checked_in' : 'checked_out', direction, at, ...base, stats: s, credential_id: cred?.id ?? null, input }, t0);
    }

    function checkZone(type, id, zoneId) {
        const z = one(db, 'SELECT id, name_ar, capacity FROM zones WHERE id = ?', zoneId);
        if (!z || !z.capacity) return;
        const n = one(db, 'SELECT COUNT(*) n FROM presence WHERE subject_type = ? AND subject_id = ? AND inside = 1 AND zone_id = ?', type, id, zoneId).n;
        if (n >= z.capacity * 0.9) app.notify('zone_crowded', n >= z.capacity ? 'critical' : 'high', { zone: z.name_ar, inside: n, capacity: z.capacity }, 'zones', z.id, { dedupe: `zone:${id}:${z.id}`, minutes: 15 });
    }

    const verifyTimes = [];
    function result(ctx, r, t0) {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        verifyTimes.push(ms);
        if (verifyTimes.length > 2000) verifyTimes.splice(0, 1000);
        app.metrics.scan(r.ok, ms);
        const { input, ...out } = r;
        app.audit.record(app.auth.actorOf(ctx), r.ok ? `attendance.${r.direction}` : 'attendance.rejected', r.subject ? `${r.subject.type}s` : null, r.subject?.id ?? null, null,
            { code: r.code, visitor_id: r.visitor?.id ?? null, method: input?.method || 'qr', gate: input?.gate || null, device_id: ctx.actor?.device?.id ?? null });
        return { ...out, ms: Math.round(ms * 10) / 10 };
    }

    const publicVisitor = (v) => ({ id: v.id, name_ar: v.name_ar, name_en: v.name_en, org_name: v.org_name, category: v.category, has_photo: !!v.photo });

    /** حزمة دون اتصال: بصمات الرموز الصالحة للفعالية مع أسماء أصحابها فقط (لا هوية ولا جوال). */
    function offlinePack(type, id) {
        const rows = all(db, `SELECT c.id, c.nonce, c.visitor_id, v.name_ar, v.name_en, v.org_name, v.category, v.blocked FROM credentials c JOIN visitors v ON v.id = c.visitor_id WHERE c.subject_type = ? AND c.subject_id = ? AND c.revoked = 0`, type, id);
        const inside = new Set(all(db, 'SELECT visitor_id FROM presence WHERE subject_type = ? AND subject_id = ? AND inside = 1', type, id).map((r) => r.visitor_id));
        return {
            subject: { type, id }, generated_at: new Date().toISOString(),
            entries: rows.map((r) => ({ f: offlineFingerprint(tokenFor(r)), v: r.visitor_id, n: r.name_ar, ne: r.name_en, o: r.org_name, c: r.category, b: r.blocked ? 1 : 0, i: inside.has(r.visitor_id) ? 1 : 0 })),
        };
    }

    /** مزامنة عمليات سُجّلت دون اتصال. التعارض (دخول مزدوج) يُسجَّل ويُنبَّه عليه ولا يُكرّر. */
    function syncOffline(ctx, items) {
        const out = [];
        for (const it of (items || []).slice(0, 1000)) {
            try {
                const r = scan(ctx, { ...it, offlineAt: it.at || new Date().toISOString(), method: it.method || 'qr' });
                out.push({ id: it.id, ok: r.ok, code: r.code });
                if (!r.ok && r.code === 'already_inside') app.notify('offline_conflict', 'medium', { name: r.visitor?.name_ar || '' }, 'visitors', r.visitor?.id);
            } catch (e) { out.push({ id: it.id, ok: false, code: e.code || 'error' }); }
        }
        return out;
    }

    /** الحضور الجماعي: مجموعة كاملة بعملية واحدة مع استثناء أفراد. */
    function bulk(ctx, { subjectType = 'event', subjectId, groupId, visitorIds, exclude = [], direction = 'in', gate }) {
        let ids = visitorIds ? visitorIds.map(Number) : all(db, 'SELECT visitor_id FROM group_members WHERE group_id = ?', Number(groupId)).map((r) => r.visitor_id);
        const ex = new Set(exclude.map(Number));
        ids = ids.filter((id) => !ex.has(id));
        const subject = subjectRow(subjectType, Number(subjectId));
        if (!subject) fail(404, 'no_subject');
        app.auth.need(ctx, 'bulk', 'create', { orgId: subject.org_id, eventId: subjectType === 'event' ? subject.id : null });
        const results = [];
        for (const vid of ids) {
            // المجموعة المسجلة جماعياً تُعتبر مسجلة في الفعالية
            if (subjectType === 'event' && direction === 'in') {
                run(db, "INSERT OR IGNORE INTO registrations (event_id, visitor_id, source) VALUES (?, ?, 'bulk')", subject.id, vid);
                issue('event', subject.id, vid);
            }
            const r = scan(ctx, { visitorId: vid, subjectType, subjectId: subject.id, direction, method: 'bulk', gate });
            results.push({ visitor_id: vid, ok: r.ok, code: r.code, name: r.visitor?.name_ar });
        }
        app.audit.record(app.auth.actorOf(ctx), 'attendance.bulk', `${subjectType}s`, subject.id, null, { group_id: groupId || null, direction, count: ids.length, ok: results.filter((r) => r.ok).length, excluded: [...ex] });
        return { total: ids.length, ok: results.filter((r) => r.ok).length, results };
    }

    function p95() {
        if (!verifyTimes.length) return 0;
        const s = [...verifyTimes].sort((a, b) => a - b);
        return s[Math.floor(s.length * 0.95)];
    }

    return { issue, revoke, rotate, tokenFor, verify, scan, bulk, stats, occupancy, zoneOccupancy, offlinePack, syncOffline, subjectRow, p95, publicVisitor };
}

export function registerAttendance(r, app) {
    const { db } = app;
    const A = app.attendance;

    r.post('/api/v1/attendance/scan', { tag: 'attendance', summary: 'تحقق وتسجيل دخول أو خروج (QR أو يدوي)' }, async (ctx) => {
        const b = await readJson(ctx.req, 20_000);
        const dev = ctx.actor?.device;
        return A.scan(ctx, {
            token: b.token, visitorId: b.visitor_id, subjectType: b.subject_type || 'event', subjectId: b.subject_id || dev?.event_id || null,
            direction: b.direction || (dev?.kind === 'kiosk' ? 'in' : 'in'), method: b.method || (dev?.kind === 'kiosk' ? 'kiosk' : b.token ? 'qr' : 'manual'),
            gate: b.gate || dev?.gate || null, zoneId: b.zone_id || dev?.zone_id || null, deviceId: dev?.id || null, force: !!b.force && !dev,
        });
    });
    r.post('/api/v1/attendance/verify', { tag: 'attendance', summary: 'تحقق من رمز QR دون تسجيل' }, async (ctx) => {
        app.auth.need(ctx, 'checkin', 'view');
        const { token } = await readJson(ctx.req, 5000);
        const v = A.verify(token);
        if (!v.ok) return { ok: false, code: v.code };
        const c = v.credential;
        const visitor = one(db, 'SELECT id, name_ar, name_en, org_name, category, photo, blocked FROM visitors WHERE id = ?', c.visitor_id);
        const pres = one(db, 'SELECT inside, last_at FROM presence WHERE subject_type = ? AND subject_id = ? AND visitor_id = ?', c.subject_type, c.subject_id, c.visitor_id);
        return { ok: true, subject: { type: c.subject_type, id: c.subject_id }, visitor: A.publicVisitor(visitor), blocked: !!visitor.blocked, inside: !!pres?.inside };
    });
    r.post('/api/v1/attendance/bulk', { tag: 'attendance', summary: 'حضور جماعي لمجموعة مع استثناءات' }, async (ctx) => A.bulk(ctx, mapBulk(await readJson(ctx.req))));
    r.post('/api/v1/attendance/sync', { tag: 'attendance', summary: 'مزامنة عمليات دون اتصال' }, async (ctx) => {
        app.auth.need(ctx, 'checkin', 'create');
        const b = await readJson(ctx.req, 2_000_000);
        return { results: A.syncOffline(ctx, (b.items || []).map((i) => ({ token: i.token, visitorId: i.visitor_id, subjectType: i.subject_type, subjectId: i.subject_id, direction: i.direction, method: i.method, gate: i.gate, at: i.at, id: i.id }))) };
    });
    r.get('/api/v1/attendance/offline-pack', { tag: 'attendance', summary: 'حزمة التحقق دون اتصال' }, (ctx) => {
        const type = ctx.query.subject_type || 'event';
        const id = Number(ctx.query.subject_id || ctx.actor?.device?.event_id);
        const s = A.subjectRow(type, id);
        if (!s) fail(404, 'no_subject');
        app.auth.need(ctx, 'checkin', 'create', { orgId: s.org_id, eventId: type === 'event' ? id : null });
        return A.offlinePack(type, id);
    });
    r.get('/api/v1/attendance/logs', { tag: 'attendance', summary: 'سجل الدخول والخروج' }, (ctx) => {
        app.auth.need(ctx, 'checkin', 'view');
        const q = ctx.query;
        const where = [];
        const args = [];
        if (q.subject_id) { where.push('l.subject_type = ? AND l.subject_id = ?'); args.push(q.subject_type || 'event', Number(q.subject_id)); }
        if (q.visitor_id) { where.push('l.visitor_id = ?'); args.push(Number(q.visitor_id)); }
        const sc = app.auth.scope(ctx, 'checkin', 'view');
        if (!sc.all) {
            const evs = [...sc.events, ...(sc.orgs.length ? all(db, `SELECT id FROM events WHERE org_id IN (${sc.orgs.map(() => '?').join(',')})`, ...sc.orgs).map((e) => e.id) : [])];
            where.push(`(l.subject_type = 'event' AND l.subject_id IN (${evs.map(() => '?').join(',') || 'NULL'}))`);
            args.push(...evs);
        }
        const size = Math.min(Number(q.size) || 30, 200);
        const rows = all(db, `SELECT l.*, v.name_ar, v.name_en, v.org_name, v.category FROM attendance_logs l JOIN visitors v ON v.id = l.visitor_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id DESC LIMIT ?`, ...args, size);
        return { rows };
    });
    r.get('/api/v1/attendance/search', { tag: 'attendance', summary: 'بحث يدوي بالاسم أو الجوال أو الهوية ضمن فعالية/زيارة' }, (ctx) => {
        app.auth.need(ctx, 'checkin', 'view');
        const q = String(ctx.query.q || '').trim();
        if (q.length < 2) return { rows: [] };
        const type = ctx.query.subject_type || 'event';
        const id = Number(ctx.query.subject_id);
        const like = `%${q.replace(/[%_]/g, '')}%`;
        const phone = q.replace(/\D/g, '');
        const join = type === 'event'
            ? `JOIN (SELECT visitor_id FROM registrations WHERE event_id = ${id} AND status = 'confirmed' UNION SELECT visitor_id FROM invitations WHERE event_id = ${id} AND status IN ('sent','confirmed','pending')) x ON x.visitor_id = v.id`
            : `JOIN visit_visitors x ON x.visitor_id = v.id AND x.visit_id = ${id}`;
        const rows = all(db, `SELECT v.id, v.name_ar, v.name_en, v.org_name, v.category, v.phone, v.national_id_last4, v.blocked, p.inside FROM visitors v ${join}
            LEFT JOIN presence p ON p.visitor_id = v.id AND p.subject_type = ? AND p.subject_id = ?
            WHERE v.name_ar LIKE ? OR v.name_en LIKE ? OR (? != '' AND v.phone LIKE ?) OR v.national_id_hash = ? LIMIT 20`, type, id, like, like, phone, `%${phone.slice(-9)}%`, app.lookup(q));
        return { rows: rows.map((r) => ({ ...r, phone: r.phone ? r.phone.replace(/\d(?=\d{3})/g, '•') : null })) };
    });
    r.get('/api/v1/attendance/stats', { tag: 'attendance', summary: 'إحصاءات لحظية لفعالية/زيارة' }, (ctx) => {
        const type = ctx.query.subject_type || 'event';
        const id = Number(ctx.query.subject_id);
        const s = A.subjectRow(type, id);
        if (!s) fail(404, 'no_subject');
        app.auth.need(ctx, type === 'event' ? 'events' : 'visits', 'view', { orgId: s.org_id, eventId: type === 'event' ? id : null });
        return { ...A.stats(type, id), capacity: s.capacity };
    });
}

const mapBulk = (b) => ({ subjectType: b.subject_type || 'event', subjectId: b.subject_id, groupId: b.group_id, visitorIds: b.visitor_ids, exclude: b.exclude || [], direction: b.direction || 'in', gate: b.gate });
