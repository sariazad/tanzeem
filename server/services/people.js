// تنظيم — الزوار (سجل موحد، تشفير الهوية، قائمة الحظر، الملف الكامل، التواصل) والمجموعات والزيارات (دورة الاعتماد).
import { one, all, run, tx } from '../db.js';
import { fail, readJson } from '../http.js';
import { coerce, RESOURCES, normPhone } from '../../shared/resources.js';
import { fmtDate, fmtTime } from '../../shared/messages.js';

export function makeVisitors(app) {
    const { db } = app;

    app.resources.hooks.visitors = {
        beforeSave(ctx, data, before) {
            if ('national_id' in data) {
                const nid = data.national_id ? String(data.national_id).replace(/\s/g, '') : '';
                if (nid && !/^[0-9A-Za-z]{5,20}$/.test(nid)) fail(422, 'invalid', { errors: [{ field: 'national_id', code: 'national_id' }] });
                data.national_id_enc = nid ? app.encrypt(nid) : null;
                data.national_id_hash = nid ? app.lookup(nid) : null;
                data.national_id_last4 = nid ? nid.slice(-4) : null;
                delete data.national_id;
            }
            if (before) data.updated_at = new Date().toISOString();
            if (data.blocked === 0) data.block_reason = null;
        },
        afterSave(ctx, row, before) {
            if (before && !before.blocked && row.blocked) {
                app.audit.record(app.auth.actorOf(ctx), 'visitors.block', 'visitors', row.id, null, { reason: row.block_reason });
                for (const c of all(db, 'SELECT id FROM credentials WHERE visitor_id = ? AND revoked = 0', row.id)) run(db, 'UPDATE credentials SET revoked = 1 WHERE id = ?', c.id);
            }
        },
        decorate(rows) {
            if (!rows.length) return rows;
            const ids = rows.map((r) => r.id);
            const pres = new Map(all(db, `SELECT visitor_id id, MAX(inside) inside, MAX(last_at) last_at FROM presence WHERE visitor_id IN (${ids.map(() => '?').join(',')}) GROUP BY visitor_id`, ...ids).map((r) => [r.id, r]));
            const conf = new Set(all(db, `SELECT DISTINCT visitor_id FROM registrations WHERE status = 'confirmed' AND visitor_id IN (${ids.map(() => '?').join(',')})`, ...ids).map((r) => r.visitor_id));
            return rows.map((r) => {
                const p = pres.get(r.id);
                return { ...r, presence: p ? (p.inside ? 'inside' : 'left') : conf.has(r.id) ? 'confirmed' : 'none', last_seen: p?.last_at || null };
            });
        },
    };

    /** إضافة زائر أو مطابقته بالهوية ثم الجوال ثم البريد (دون تكرار في السجل الموحد). */
    function upsert(ctx, input, source = 'manual') {
        const def = RESOURCES.visitors;
        const data = {};
        for (const f of def.fields) {
            if (!(f.key in input) || input[f.key] === undefined || input[f.key] === '') continue;
            if (f.ro && !f.virtual) continue;
            data[f.key] = coerce(f, input[f.key]);
        }
        if (!data.name_ar && input.name) data.name_ar = String(input.name).trim();
        if (!data.name_ar) throw Object.assign(new Error('required'), { field: 'name_ar', code: 'required', status: 422 });
        const nid = data.national_id ? String(data.national_id).replace(/\s/g, '') : null;
        let existing = null;
        if (nid) existing = one(db, 'SELECT * FROM visitors WHERE national_id_hash = ?', app.lookup(nid));
        if (!existing && data.phone) existing = one(db, 'SELECT * FROM visitors WHERE phone = ?', data.phone);
        if (!existing && data.email) existing = one(db, 'SELECT * FROM visitors WHERE email = ?', data.email);
        app.resources.hooks.visitors.beforeSave(ctx, data, existing);
        const tc = ['name_ar', 'name_en', 'org_name', 'job_title', 'category', 'phone', 'email', 'national_id_enc', 'national_id_hash', 'national_id_last4', 'photo', 'interests'];
        if (existing) {
            const cols = tc.filter((c) => data[c] != null && data[c] !== existing[c]);
            if (cols.length) run(db, `UPDATE visitors SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...cols.map((c) => data[c]), existing.id);
            return one(db, 'SELECT * FROM visitors WHERE id = ?', existing.id);
        }
        const cols = tc.filter((c) => data[c] != null);
        const id = Number(run(db, `INSERT INTO visitors (${cols.join(',')}, source) VALUES (${cols.map(() => '?').join(',')}, ?)`, ...cols.map((c) => data[c]), source).lastInsertRowid);
        app.audit.record(app.auth.actorOf(ctx), 'visitors.create', 'visitors', id, null, { source, name_ar: data.name_ar });
        return one(db, 'SELECT * FROM visitors WHERE id = ?', id);
    }

    function profile(ctx, id) {
        app.auth.need(ctx, 'visitors', 'view');
        const v = one(db, 'SELECT * FROM visitors WHERE id = ?', id) || fail(404, 'not_found');
        const out = { ...v, national_id_enc: undefined, national_id_hash: undefined };
        out.events = all(db, `SELECT e.id, e.title_ar, e.title_en, e.starts_at, e.status, r.source, r.status reg_status, i.status inv_status,
            (SELECT MIN(at) FROM attendance_logs WHERE subject_type='event' AND subject_id=e.id AND visitor_id=? AND direction='in') first_in,
            (SELECT MAX(at) FROM attendance_logs WHERE subject_type='event' AND subject_id=e.id AND visitor_id=? AND direction='out') last_out
            FROM events e LEFT JOIN registrations r ON r.event_id = e.id AND r.visitor_id = ? LEFT JOIN invitations i ON i.event_id = e.id AND i.visitor_id = ?
            WHERE r.id IS NOT NULL OR i.id IS NOT NULL ORDER BY e.starts_at DESC`, id, id, id, id);
        out.visits = all(db, 'SELECT s.id, s.title, s.starts_at, s.status FROM visits s JOIN visit_visitors x ON x.visit_id = s.id WHERE x.visitor_id = ? ORDER BY s.starts_at DESC', id);
        out.logs = all(db, 'SELECT id, subject_type, subject_id, direction, method, gate, at FROM attendance_logs WHERE visitor_id = ? ORDER BY id DESC LIMIT 100', id);
        out.groups = all(db, 'SELECT g.id, g.name FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.visitor_id = ?', id);
        app.audit.record(app.auth.actorOf(ctx), 'visitors.view_profile', 'visitors', id);
        return out;
    }

    return { upsert, profile };
}

export function registerPeople(r, app) {
    const { db } = app;

    /* ───────── الزوار ───────── */
    r.get('/api/v1/visitors/:id/profile', { tag: 'visitors', summary: 'ملف الزائر وسجله الكامل' }, (ctx) => app.visitors.profile(ctx, Number(ctx.params.id)));
    r.get('/api/v1/visitors/:id/national-id', { tag: 'visitors', summary: 'كشف رقم الهوية (يُسجَّل في التدقيق)' }, (ctx) => {
        app.auth.need(ctx, 'visitors', 'update');
        const v = one(db, 'SELECT national_id_enc FROM visitors WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        app.audit.record(app.auth.actorOf(ctx), 'visitors.reveal_national_id', 'visitors', ctx.params.id);
        return { national_id: v.national_id_enc ? app.decrypt(v.national_id_enc) : null };
    });
    r.post('/api/v1/visitors/:id/block', { tag: 'visitors', summary: 'حظر أو رفع الحظر' }, async (ctx) => {
        const b = await readJson(ctx.req);
        return app.resources.update(ctx, 'visitors', Number(ctx.params.id), { blocked: b.blocked ? 1 : 0, block_reason: b.reason || null });
    });
    r.post('/api/v1/visitors/import', { tag: 'visitors', summary: 'استيراد زوار (صفوف من Excel/CSV)' }, async (ctx) => {
        app.auth.need(ctx, 'visitors', 'create');
        const { rows = [], group_id } = await readJson(ctx.req, 8_000_000);
        const errors = [];
        let ok = 0;
        tx(db, () => rows.slice(0, 10000).forEach((row, i) => {
            try {
                const v = app.visitors.upsert(ctx, row, 'import');
                if (group_id) run(db, 'INSERT OR IGNORE INTO group_members (group_id, visitor_id) VALUES (?, ?)', Number(group_id), v.id);
                ok++;
            } catch (e) { errors.push({ row: i + 1, field: e.field, code: e.code || e.message }); }
        }));
        app.audit.record(app.auth.actorOf(ctx), 'visitors.import', 'visitors', null, null, { ok, errors: errors.length, group_id: group_id || null });
        return { ok, errors };
    });
    r.post('/api/v1/visitors/message', { tag: 'visitors', summary: 'تواصل مباشر (بريد/SMS) مع زائر أو أكثر' }, async (ctx) => {
        app.auth.need(ctx, 'visitors', 'update');
        const b = await readJson(ctx.req);
        const ids = (b.ids || []).map(Number).slice(0, 2000);
        if (!ids.length || !b.body) fail(422, 'invalid', { errors: [{ field: !ids.length ? 'ids' : 'body', code: 'required' }] });
        let ok = 0, failed = 0;
        for (const v of all(db, `SELECT * FROM visitors WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)) {
            try {
                await app.events.deliver({ kind: 'message', lang: b.lang || 'ar', channel: b.channel || 'email', visitor: v, vars: { event: String(b.subject || '').slice(0, 150), body: String(b.body).slice(0, 2000) }, link: '' });
                ok++;
            } catch { failed++; }
        }
        app.audit.record(app.auth.actorOf(ctx), 'visitors.message', 'visitors', null, null, { count: ids.length, ok, failed, channel: b.channel });
        return { ok, failed };
    });
    r.get('/api/v1/visitors/:id/photo', { tag: 'visitors', summary: 'صورة الزائر' }, (ctx) => {
        app.auth.need(ctx, 'checkin', 'view');
        const v = one(db, 'SELECT photo FROM visitors WHERE id = ?', Number(ctx.params.id));
        if (!v?.photo) fail(404, 'not_found');
        const [meta, b64] = v.photo.split(',');
        ctx.res.writeHead(200, { 'Content-Type': meta.slice(5, meta.indexOf(';')), 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
        ctx.res.end(Buffer.from(b64, 'base64'));
    });

    r.post('/api/v1/attendance/photo', { tag: 'attendance', summary: 'التقاط صورة الزائر من الكشك أو الاستقبال (للحاضر حالياً فقط)' }, async (ctx) => {
        const b = await readJson(ctx.req, 1_000_000);
        const type = b.subject_type || 'event';
        const sid = Number(b.subject_id || ctx.actor?.device?.event_id);
        const s = app.attendance.subjectRow(type, sid) || fail(404, 'no_subject');
        app.auth.need(ctx, 'checkin', 'create', { orgId: s.org_id, eventId: type === 'event' ? sid : null });
        const pres = one(db, 'SELECT inside FROM presence WHERE subject_type = ? AND subject_id = ? AND visitor_id = ?', type, sid, Number(b.visitor_id));
        if (!pres?.inside) fail(409, 'not_inside');
        const photo = coerce({ key: 'photo', type: 'image', maxKb: 400 }, b.photo);
        run(db, "UPDATE visitors SET photo = ?, updated_at = datetime('now') WHERE id = ?", photo, Number(b.visitor_id));
        app.audit.record(app.auth.actorOf(ctx), 'visitors.photo', 'visitors', b.visitor_id);
        return { ok: true };
    });

    /* ───────── المجموعات ───────── */
    app.resources.hooks.groups = {
        decorate(rows) {
            if (!rows.length) return rows;
            const ids = rows.map((r) => r.id);
            const n = new Map(all(db, `SELECT group_id id, COUNT(*) n FROM group_members WHERE group_id IN (${ids.map(() => '?').join(',')}) GROUP BY group_id`, ...ids).map((x) => [x.id, x.n]));
            return rows.map((r) => ({ ...r, members: n.get(r.id) || 0 }));
        },
    };
    r.get('/api/v1/groups/:id/members', { tag: 'groups', summary: 'أعضاء المجموعة' }, (ctx) => {
        app.auth.need(ctx, 'groups', 'view');
        const st = ctx.query.subject_id ? [ctx.query.subject_type || 'event', Number(ctx.query.subject_id)] : null;
        return { rows: all(db, `SELECT v.id, v.name_ar, v.name_en, v.org_name, v.category, v.phone, v.email, v.blocked${st ? ', p.inside' : ''}
            FROM group_members m JOIN visitors v ON v.id = m.visitor_id ${st ? 'LEFT JOIN presence p ON p.visitor_id = v.id AND p.subject_type = ? AND p.subject_id = ?' : ''}
            WHERE m.group_id = ? ORDER BY v.name_ar`, ...(st ? st : []), Number(ctx.params.id)) };
    });
    r.post('/api/v1/groups/:id/members', { tag: 'groups', summary: 'إضافة/إزالة أعضاء' }, async (ctx) => {
        app.auth.need(ctx, 'groups', 'update');
        const g = one(db, 'SELECT id FROM groups WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        const { add = [], remove = [] } = await readJson(ctx.req);
        tx(db, () => {
            for (const v of add) run(db, 'INSERT OR IGNORE INTO group_members (group_id, visitor_id) VALUES (?, ?)', g.id, Number(v));
            for (const v of remove) run(db, 'DELETE FROM group_members WHERE group_id = ? AND visitor_id = ?', g.id, Number(v));
        });
        app.audit.record(app.auth.actorOf(ctx), 'groups.members', 'groups', g.id, null, { add: add.length, remove: remove.length });
        return { ok: true };
    });

    /* ───────── الزيارات: طلب ← اعتماد ← إصدار تصريح ← دخول ← خروج ───────── */
    app.resources.hooks.visits = {
        beforeSave(ctx, data, before) {
            if (!before) { data.created_by = ctx.actor?.userId ?? null; data.status = 'requested'; }
            const s = data.starts_at ?? before?.starts_at, e = data.ends_at ?? before?.ends_at;
            if (s && e && e <= s) fail(422, 'invalid', { errors: [{ field: 'ends_at', code: 'after_start' }] });
        },
        decorate(rows) {
            if (!rows.length) return rows;
            const ids = rows.map((r) => r.id);
            const n = new Map(all(db, `SELECT visit_id id, COUNT(*) n FROM visit_visitors WHERE visit_id IN (${ids.map(() => '?').join(',')}) GROUP BY visit_id`, ...ids).map((x) => [x.id, x.n]));
            return rows.map((r) => ({ ...r, participants: n.get(r.id) || 0 }));
        },
    };
    const VISIT_FLOW = { approve: [['requested'], 'approved', 'approve'], reject: [['requested', 'approved'], 'rejected', 'approve'], issue_permit: [['approved', 'permit_issued'], 'permit_issued', 'update'], cancel: [['requested', 'approved', 'permit_issued'], 'cancelled', 'update'], reopen: [['rejected', 'cancelled'], 'requested', 'update'] };
    r.post('/api/v1/visits/:id/workflow/:action', { tag: 'visits', summary: 'إجراء في دورة الزيارة: approve | reject | issue_permit | cancel | reopen' }, async (ctx) => {
        const flow = VISIT_FLOW[ctx.params.action];
        if (!flow) fail(404, 'not_found');
        const v = one(db, 'SELECT * FROM visits WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        app.auth.need(ctx, 'visits', flow[2], { orgId: v.org_id });
        if (!flow[0].includes(v.status)) fail(409, 'transition', { from: v.status });
        const b = await readJson(ctx.req);
        let sent = null;
        tx(db, () => {
            run(db, 'UPDATE visits SET status = ? WHERE id = ?', flow[1], v.id);
            if (ctx.params.action === 'approve') run(db, "UPDATE visits SET approved_by = ?, approved_at = datetime('now') WHERE id = ?", ctx.actor.userId, v.id);
            if (['reject', 'cancel'].includes(ctx.params.action)) run(db, "UPDATE credentials SET revoked = 1 WHERE subject_type = 'visit' AND subject_id = ?", v.id);
            if (b.notes) run(db, "UPDATE visits SET notes = COALESCE(notes || char(10), '') || ? WHERE id = ?", String(b.notes).slice(0, 1000), v.id);
        });
        if (ctx.params.action === 'issue_permit') {
            sent = { ok: 0, failed: 0 };
            for (const vis of all(db, 'SELECT v.* FROM visitors v JOIN visit_visitors x ON x.visitor_id = v.id WHERE x.visit_id = ?', v.id)) {
                const { token } = app.attendance.issue('visit', v.id, vis.id);
                if (b.channel && b.channel !== 'none') {
                    try {
                        const lang = b.lang || 'ar';
                        await app.events.deliver({ kind: 'permit', lang, channel: b.channel, visitor: vis, vars: { event: v.title, date: fmtDate(v.starts_at, lang), time: fmtTime(v.starts_at, lang), location: v.location || '' }, qrToken: token, link: `${app.cfg.publicUrl}/m/p/${token}` });
                        sent.ok++;
                    } catch { sent.failed++; }
                }
            }
        }
        app.audit.record(app.auth.actorOf(ctx), `visits.${ctx.params.action}`, 'visits', v.id, { status: v.status }, { status: flow[1], notes: b.notes || undefined });
        app.integrations.emit(ctx.params.action === 'approve' ? 'visit.approved' : 'visit.status', { visit_id: v.id, from: v.status, to: flow[1] });
        app.hub?.publish('dashboard', 'visit', { id: v.id, status: flow[1] });
        return { ok: true, status: flow[1], sent };
    });
    r.get('/api/v1/visits/:id/visitors', { tag: 'visits', summary: 'المشاركون في الزيارة' }, (ctx) => {
        const v = one(db, 'SELECT * FROM visits WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        app.auth.need(ctx, 'visits', 'view', { orgId: v.org_id });
        const rows = all(db, `SELECT vi.id, vi.name_ar, vi.name_en, vi.org_name, vi.category, vi.phone, vi.blocked, p.inside, c.id cred_id, c.nonce, c.revoked
            FROM visit_visitors x JOIN visitors vi ON vi.id = x.visitor_id
            LEFT JOIN presence p ON p.subject_type = 'visit' AND p.subject_id = x.visit_id AND p.visitor_id = vi.id
            LEFT JOIN credentials c ON c.subject_type = 'visit' AND c.subject_id = x.visit_id AND c.visitor_id = vi.id
            WHERE x.visit_id = ? ORDER BY vi.name_ar`, v.id);
        return { rows: rows.map(({ nonce, cred_id, revoked, ...x }) => ({ ...x, permit: cred_id && !revoked ? `/m/p/${app.attendance.tokenFor({ id: cred_id, nonce })}` : null })) };
    });
    r.post('/api/v1/visits/:id/visitors', { tag: 'visits', summary: 'إضافة/إزالة مشاركين (أفراد أو مجموعة أو جدد)' }, async (ctx) => {
        const v = one(db, 'SELECT * FROM visits WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        app.auth.need(ctx, 'visits', 'update', { orgId: v.org_id });
        const { add = [], remove = [], group_id, create = [] } = await readJson(ctx.req, 2_000_000);
        const ids = new Set(add.map(Number));
        if (group_id) for (const m of all(db, 'SELECT visitor_id FROM group_members WHERE group_id = ?', Number(group_id))) ids.add(m.visitor_id);
        for (const c of create.slice(0, 200)) ids.add(app.visitors.upsert(ctx, c, 'manual').id);
        tx(db, () => {
            for (const id of ids) run(db, 'INSERT OR IGNORE INTO visit_visitors (visit_id, visitor_id) VALUES (?, ?)', v.id, id);
            for (const id of remove) { run(db, 'DELETE FROM visit_visitors WHERE visit_id = ? AND visitor_id = ?', v.id, Number(id)); app.attendance.revoke('visit', v.id, Number(id)); }
        });
        if (v.status === 'permit_issued') for (const id of ids) app.attendance.issue('visit', v.id, id);
        app.audit.record(app.auth.actorOf(ctx), 'visits.participants', 'visits', v.id, null, { add: ids.size, remove: remove.length });
        return { ok: true };
    });
    /* صفحة التصريح العامة (رمز QR للزيارة) */
    r.get('/api/public/permit/:token', { public: true, tag: 'public', summary: 'تصريح الزيارة' }, (ctx) => {
        const v = app.attendance.verify(ctx.params.token);
        if (!v.ok && v.code === 'invalid_qr') fail(404, 'not_found');
        const c = v.credential;
        const visit = c.subject_type === 'visit' ? one(db, 'SELECT id, title, starts_at, ends_at, location, status, host_name FROM visits WHERE id = ?', c.subject_id) : null;
        const event = c.subject_type === 'event' ? app.events.publicEvent(one(db, 'SELECT * FROM events WHERE id = ?', c.subject_id)) : null;
        const person = one(db, 'SELECT name_ar, name_en, org_name, category FROM visitors WHERE id = ?', c.visitor_id);
        return { ok: v.ok, code: v.code || null, qr: ctx.params.token, visit, event, visitor: person, branding: app.publicBranding() };
    });
}
