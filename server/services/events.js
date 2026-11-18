// تنظيم — الفعاليات: دورة الحياة، الدعوات (بريد/SMS)، التسجيل المسبق والتأكيد، الجدول، الخريطة، وصفحات المشارك العامة.
import QRCode from 'qrcode';
import { one, all, run, tx } from '../db.js';
import { fail, readJson } from '../http.js';
import { randomToken } from '../security.js';
import { coerce, RESOURCES, normPhone } from '../../shared/resources.js';
import { DEFAULT_TEMPLATES, fill, fmtDate, fmtTime } from '../../shared/messages.js';

const STATUS_FLOW = { draft: ['published', 'cancelled'], published: ['running', 'draft', 'cancelled', 'ended'], running: ['ended', 'cancelled'], ended: ['running'], cancelled: ['draft'] };

export function makeEvents(app) {
    const { db } = app;

    app.resources.hooks.events = {
        beforeSave(ctx, data, before) {
            if (!before) { data.created_by = ctx.actor?.userId ?? null; data.status ||= 'draft'; }
            const s = data.starts_at ?? before?.starts_at, e = data.ends_at ?? before?.ends_at;
            if (s && e && e <= s) fail(422, 'invalid', { errors: [{ field: 'ends_at', code: 'after_start' }] });
            if (data.status && before && data.status !== before.status && !STATUS_FLOW[before.status]?.includes(data.status)) fail(422, 'invalid', { errors: [{ field: 'status', code: 'transition' }] });
        },
        afterSave(ctx, row, before) {
            if (before && before.status !== row.status) onStatus(row, before.status);
            if (before && (before.starts_at !== row.starts_at || before.ends_at !== row.ends_at)) {
                for (const c of all(db, "SELECT visitor_id FROM credentials WHERE subject_type = 'event' AND subject_id = ? AND revoked = 0", row.id)) app.attendance.issue('event', row.id, c.visitor_id);
            }
        },
        decorate(rows) {
            if (!rows.length) return rows;
            const ids = rows.map((r) => r.id);
            const q = (sql) => new Map(all(db, sql.replace('IDS', ids.map(() => '?').join(',')), ...ids).map((r) => [r.id, r.n]));
            const inv = q("SELECT event_id id, COUNT(*) n FROM invitations WHERE event_id IN (IDS) AND status NOT IN ('cancelled') GROUP BY event_id");
            const conf = q("SELECT event_id id, COUNT(*) n FROM registrations WHERE event_id IN (IDS) AND status = 'confirmed' GROUP BY event_id");
            const att = q("SELECT subject_id id, COUNT(DISTINCT visitor_id) n FROM attendance_logs WHERE subject_type = 'event' AND direction = 'in' AND subject_id IN (IDS) GROUP BY subject_id");
            const ins = q("SELECT subject_id id, COUNT(*) n FROM presence WHERE subject_type = 'event' AND inside = 1 AND subject_id IN (IDS) GROUP BY subject_id");
            return rows.map((r) => {
                const expected = Math.max(conf.get(r.id) || 0, r.capacity || 0) || inv.get(r.id) || 0;
                const attended = att.get(r.id) || 0;
                return { ...r, invited: inv.get(r.id) || 0, registered: conf.get(r.id) || 0, attended, inside: ins.get(r.id) || 0, attendance_rate: expected ? Math.round((attended / Math.max(conf.get(r.id) || expected, 1)) * 100) : 0 };
            });
        },
    };

    function onStatus(ev, from) {
        app.integrations.emit('event.status', { event_id: ev.id, from, to: ev.status });
        app.hub?.publish('dashboard', 'event_status', { id: ev.id, status: ev.status });
        if (ev.status === 'cancelled') {
            run(db, "UPDATE credentials SET revoked = 1 WHERE subject_type = 'event' AND subject_id = ?", ev.id);
            run(db, "UPDATE invitations SET status = 'cancelled' WHERE event_id = ? AND status IN ('pending','sent','confirmed')", ev.id);
        }
        if (ev.status === 'ended') {
            run(db, "UPDATE invitations SET status = 'expired' WHERE event_id = ? AND status IN ('pending','sent')", ev.id);
        }
    }

    /* ───────── الرسائل ───────── */
    function templates() {
        const custom = app.getSetting('templates', {});
        const out = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
        for (const [k, v] of Object.entries(custom)) for (const lang of ['ar', 'en']) Object.assign(out[k]?.[lang] || {}, v?.[lang] || {});
        return out;
    }
    async function deliver({ kind, lang, channel, visitor, vars, qrToken, link }) {
        const tpl = templates()[kind][lang] || templates()[kind].ar;
        const branding = app.getSetting('branding', {});
        const allVars = { ...vars, name: lang === 'en' ? visitor.name_en || visitor.name_ar : visitor.name_ar, link, org: lang === 'en' ? branding.name_en || branding.name_ar : branding.name_ar };
        const used = [];
        if ((channel === 'email' || channel === 'both') && visitor.email) {
            const text = fill(tpl.body, allVars);
            const qrPng = qrToken ? await QRCode.toBuffer(qrToken, { width: 320, margin: 1, errorCorrectionLevel: 'M' }) : null;
            const dir = lang === 'ar' ? 'rtl' : 'ltr';
            const color = branding.primary || '#0f6e56';
            const html = `<div dir="${dir}" style="font-family:Tahoma,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
<div style="background:${color};color:#fff;padding:16px 20px;font-size:18px">${esc(allVars.org || '')}</div>
<div style="padding:20px;line-height:1.8;color:#111">${esc(text).replace(/\n/g, '<br>').replace(esc(link), `<a href="${esc(link)}">${esc(link)}</a>`)}</div>
${qrPng ? `<div style="text-align:center;padding:0 20px 20px"><img src="cid:qr" width="220" height="220" alt="QR"></div>` : ''}</div>`;
            const r = await app.integrations.sendMail({ to: visitor.email, subject: fill(tpl.subject, allVars), text, html, attachments: qrPng ? [{ filename: 'qr.png', content: qrPng, cid: 'qr' }] : [] });
            used.push(r.channel);
        }
        if ((channel === 'sms' || channel === 'both') && visitor.phone) {
            const r = await app.integrations.sendSms({ to: visitor.phone, message: fill(tpl.sms, allVars) });
            used.push(r.channel);
        }
        if (!used.length) throw Object.assign(new Error('no_contact'), { code: 'no_contact' });
        return used;
    }

    const inviteLink = (token) => `${app.cfg.publicUrl}/m/i/${token}`;

    async function sendInvitation(inv, kind = 'invitation') {
        const ev = one(db, 'SELECT * FROM events WHERE id = ?', inv.event_id);
        const v = one(db, 'SELECT * FROM visitors WHERE id = ?', inv.visitor_id);
        const lang = inv.lang || 'ar';
        const { token } = app.attendance.issue('event', ev.id, v.id);
        const vars = { event: lang === 'en' ? ev.title_en || ev.title_ar : ev.title_ar, date: fmtDate(ev.starts_at, lang), time: fmtTime(ev.starts_at, lang), location: ev.location || '' };
        try {
            await deliver({ kind, lang, channel: inv.channel, visitor: v, vars, qrToken: token, link: inviteLink(inv.token) });
            if (kind === 'reminder') run(db, "UPDATE invitations SET reminded_at = datetime('now') WHERE id = ?", inv.id);
            else run(db, "UPDATE invitations SET status = CASE WHEN status IN ('pending','failed') THEN 'sent' ELSE status END, sent_at = datetime('now'), attempts = attempts + 1, last_error = NULL WHERE id = ?", inv.id);
            return true;
        } catch (e) {
            run(db, "UPDATE invitations SET status = CASE WHEN status IN ('pending','sent') THEN 'failed' ELSE status END, attempts = attempts + 1, last_error = ? WHERE id = ?", String(e.code || e.message).slice(0, 200), inv.id);
            return false;
        }
    }

    /** إنشاء دعوات من: أفراد، مجموعات، صفوف مستوردة (Excel)، أو نتائج AD. */
    function createInvitations(ctx, eventId, { visitor_ids = [], group_ids = [], rows = [], channel = 'email', lang = 'ar', remind_at = null }) {
        const ev = one(db, 'SELECT * FROM events WHERE id = ?', eventId);
        if (!ev) fail(404, 'not_found');
        app.auth.need(ctx, 'events', 'update', { orgId: ev.org_id, eventId });
        if (!['email', 'sms', 'both', 'none'].includes(channel)) fail(422, 'invalid', { errors: [{ field: 'channel', code: 'option' }] });
        const ids = new Set(visitor_ids.map(Number).filter(Boolean));
        for (const g of group_ids) for (const m of all(db, 'SELECT visitor_id FROM group_members WHERE group_id = ?', Number(g))) ids.add(m.visitor_id);
        const errors = [];
        rows.slice(0, 5000).forEach((row, i) => {
            try { ids.add(app.visitors.upsert(ctx, row, 'import').id); } catch (e) { errors.push({ row: i + 1, code: e.code || e.message, field: e.field }); }
        });
        let created = 0;
        tx(db, () => {
            for (const vid of ids) {
                const r = run(db, 'INSERT OR IGNORE INTO invitations (event_id, visitor_id, channel, lang, token, remind_at) VALUES (?,?,?,?,?,?)', eventId, vid, channel, lang === 'en' ? 'en' : 'ar', randomToken(18), remind_at);
                if (r.changes) created++;
                else run(db, "UPDATE invitations SET status = CASE WHEN status IN ('cancelled','expired','declined') THEN 'pending' ELSE status END, channel = ? WHERE event_id = ? AND visitor_id = ?", channel, eventId, vid);
            }
        });
        app.audit.record(app.auth.actorOf(ctx), 'invitations.create', 'events', eventId, null, { created, total: ids.size, channel, errors: errors.length });
        return { created, total: ids.size, errors };
    }

    async function sendMany(ctx, eventId, ids, kind = 'invitation') {
        const ev = one(db, 'SELECT * FROM events WHERE id = ?', eventId);
        app.auth.need(ctx, 'events', 'update', { orgId: ev.org_id, eventId });
        const list = ids?.length
            ? all(db, `SELECT * FROM invitations WHERE event_id = ? AND id IN (${ids.map(() => '?').join(',')})`, eventId, ...ids.map(Number))
            : all(db, kind === 'reminder' ? "SELECT * FROM invitations WHERE event_id = ? AND status IN ('sent','confirmed')" : "SELECT * FROM invitations WHERE event_id = ? AND status IN ('pending','failed')", eventId);
        let ok = 0, failed = 0;
        for (const inv of list) {
            if (['cancelled', 'declined', 'expired'].includes(inv.status)) continue;
            if (inv.channel === 'none') { app.attendance.issue('event', inv.event_id, inv.visitor_id); run(db, "UPDATE invitations SET status = 'sent', sent_at = datetime('now') WHERE id = ? AND status IN ('pending','failed')", inv.id); ok++; continue; }
            (await sendInvitation(inv, kind)) ? ok++ : failed++;
        }
        app.audit.record(app.auth.actorOf(ctx), kind === 'reminder' ? 'invitations.remind' : 'invitations.send', 'events', eventId, null, { ok, failed });
        app.hub?.publish(`event:${eventId}`, 'invitations', { ok, failed });
        return { ok, failed };
    }

    /** ردّ المدعو من صفحة الدعوة: تأكيد (مع إجابات النموذج) أو اعتذار. */
    function respond(inv, response, answers = {}, ctx) {
        const ev = one(db, 'SELECT * FROM events WHERE id = ?', inv.event_id);
        if (['cancelled', 'expired'].includes(inv.status) || ['cancelled', 'ended'].includes(ev.status)) fail(409, 'closed');
        if (response === 'decline') {
            run(db, "UPDATE invitations SET status = 'declined', responded_at = datetime('now') WHERE id = ?", inv.id);
            run(db, "UPDATE registrations SET status = 'cancelled' WHERE event_id = ? AND visitor_id = ?", inv.event_id, inv.visitor_id);
            app.attendance.revoke('event', inv.event_id, inv.visitor_id);
            app.integrations.emit('invitation.declined', { event_id: inv.event_id, visitor_id: inv.visitor_id });
        } else {
            const clean = validateAnswers(ev.form_id, answers);
            if (clean.photo) run(db, 'UPDATE visitors SET photo = ? WHERE id = ?', clean.photo, inv.visitor_id), delete clean.photo;
            run(db, "INSERT INTO registrations (event_id, visitor_id, source, answers, status) VALUES (?, ?, 'invite', ?, 'confirmed') ON CONFLICT(event_id, visitor_id) DO UPDATE SET status = 'confirmed', answers = excluded.answers", inv.event_id, inv.visitor_id, JSON.stringify(clean));
            run(db, "UPDATE invitations SET status = 'confirmed', responded_at = datetime('now') WHERE id = ?", inv.id);
            app.attendance.issue('event', inv.event_id, inv.visitor_id);
            app.integrations.emit('invitation.confirmed', { event_id: inv.event_id, visitor_id: inv.visitor_id });
        }
        app.audit.record({ name: `invitee:${inv.visitor_id}`, ip: ctx?.ip }, `invitations.${response === 'decline' ? 'decline' : 'confirm'}`, 'invitations', inv.id);
        app.hub?.publish(`event:${inv.event_id}`, 'invitation', { id: inv.id, status: response === 'decline' ? 'declined' : 'confirmed' });
        app.hub?.publish('dashboard', 'invitation', { event_id: inv.event_id });
    }

    /** التحقق من إجابات نموذج التسجيل الديناميكي (مع المنطق الشرطي). */
    function validateAnswers(formId, answers) {
        if (!formId) return {};
        const form = one(db, 'SELECT fields FROM forms WHERE id = ?', formId);
        const fields = JSON.parse(form?.fields || '[]');
        const out = {};
        const errors = [];
        for (const f of fields) {
            if (f.show_if && f.show_if.field) {
                const dep = answers[f.show_if.field];
                if (String(dep ?? '') !== String(f.show_if.equals ?? '')) continue;
            }
            const v = answers[f.key];
            const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
            if (empty) { if (f.required) errors.push({ field: f.key, code: 'required' }); continue; }
            try {
                if (f.type === 'photo') out.photo = coerce({ key: f.key, type: 'image', maxKb: 400 }, v);
                else if (f.type === 'email') out[f.key] = coerce({ key: f.key, type: 'email' }, v);
                else if (f.type === 'phone') out[f.key] = coerce({ key: f.key, type: 'phone' }, v);
                else if (f.type === 'number') out[f.key] = coerce({ key: f.key, type: 'number', min: f.min, max: f.max }, v);
                else if (f.type === 'select' || f.type === 'radio') { if (!(f.options || []).some((o) => o.value === v)) throw Object.assign(new Error('option'), { field: f.key, code: 'option' }); out[f.key] = v; }
                else if (f.type === 'checkbox') out[f.key] = v === true || v === 'true' || v === 1;
                else if (f.type === 'multi') out[f.key] = [].concat(v).filter((x) => (f.options || []).some((o) => o.value === x));
                else {
                    const s = String(v).slice(0, 2000);
                    if (f.pattern && !new RegExp(`^(?:${f.pattern})$`).test(s)) throw Object.assign(new Error('pattern'), { field: f.key, code: 'pattern' });
                    out[f.key] = s;
                }
            } catch (e) { errors.push({ field: e.field || f.key, code: e.code || 'invalid' }); }
        }
        if (errors.length) fail(422, 'invalid', { errors });
        return out;
    }

    /** تسجيل فوري (من الكشك أو صفحة التسجيل المفتوح). */
    function registerWalkIn(ctx, eventId, body, source) {
        const ev = one(db, 'SELECT * FROM events WHERE id = ?', eventId);
        if (!ev || ['cancelled', 'ended', 'draft'].includes(ev.status)) fail(409, 'closed');
        if (!ev.open_registration) fail(403, 'registration_closed');
        const answers = validateAnswers(ev.form_id, body.answers || {});
        const visitor = app.visitors.upsert(ctx, { name_ar: body.name_ar || body.name, name_en: body.name_en, phone: body.phone, email: body.email, org_name: body.org_name, national_id: body.national_id, category: ev.type === 'students' ? 'student' : 'guest', photo: answers.photo || body.photo }, source);
        if (visitor.blocked) {
            app.notify('blocked_visitor', 'critical', { name: visitor.name_ar, subject: ev.title_ar, gate: source }, 'visitors', visitor.id);
            fail(403, 'blocked');
        }
        delete answers.photo;
        run(db, "INSERT INTO registrations (event_id, visitor_id, source, answers) VALUES (?,?,?,?) ON CONFLICT(event_id, visitor_id) DO UPDATE SET status = 'confirmed'", eventId, visitor.id, source, JSON.stringify(answers));
        const { token } = app.attendance.issue('event', eventId, visitor.id);
        app.audit.record(app.auth.actorOf(ctx), 'registrations.create', 'events', eventId, null, { visitor_id: visitor.id, source });
        app.hub?.publish(`event:${eventId}`, 'registration', { visitor_id: visitor.id });
        return { visitor: app.attendance.publicVisitor(visitor), token };
    }

    function publicEvent(ev, lang) {
        const venue = ev.venue_id ? one(db, 'SELECT id, name_ar, name_en, map_bg, map_w, map_h FROM venues WHERE id = ?', ev.venue_id) : null;
        return { id: ev.id, title_ar: ev.title_ar, title_en: ev.title_en, type: ev.type, status: ev.status, starts_at: ev.starts_at, ends_at: ev.ends_at, location: ev.location, description: ev.description, venue: venue ? { id: venue.id, name_ar: venue.name_ar, name_en: venue.name_en, has_map: !!venue.map_bg, map_w: venue.map_w, map_h: venue.map_h } : null };
    }

    function summary(ctx, id) {
        const ev = one(db, 'SELECT * FROM events WHERE id = ?', id);
        if (!ev) fail(404, 'not_found');
        app.auth.need(ctx, 'events', 'view', { orgId: ev.org_id, eventId: id });
        const inv = Object.fromEntries(all(db, 'SELECT status, COUNT(*) n FROM invitations WHERE event_id = ? GROUP BY status', id).map((r) => [r.status, r.n]));
        const reg = one(db, "SELECT COUNT(*) n FROM registrations WHERE event_id = ? AND status = 'confirmed'", id).n;
        const st = app.attendance.stats('event', id);
        const zones = ev.venue_id ? all(db, 'SELECT * FROM zones WHERE venue_id = ? ORDER BY id', ev.venue_id) : [];
        const zocc = new Map(app.attendance.zoneOccupancy('event', id).map((z) => [z.zone_id, z.n]));
        return {
            event: app.resources.hooks.events.decorate([{ ...ev }])[0], invitations: inv, registered: reg, ...st,
            rate: reg ? Math.round((st.unique / reg) * 100) : 0,
            zones: zones.map((z) => ({ ...z, inside: zocc.get(z.id) || 0 })),
            devices: all(db, 'SELECT id, name, kind, status, last_seen FROM devices WHERE event_id = ?', id),
        };
    }

    return { createInvitations, sendMany, sendInvitation, respond, validateAnswers, registerWalkIn, publicEvent, summary, inviteLink, deliver, templates, STATUS_FLOW };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function registerEvents(r, app) {
    const { db } = app;
    const E = app.events;
    const evOr404 = (id) => one(db, 'SELECT * FROM events WHERE id = ?', Number(id)) || fail(404, 'not_found');

    r.get('/api/v1/events/:id/summary', { tag: 'events', summary: 'ملخص الفعالية والإشغال' }, (ctx) => E.summary(ctx, Number(ctx.params.id)));
    r.post('/api/v1/events/:id/status', { tag: 'events', summary: 'تغيير حالة الفعالية (نشر، بدء، إنهاء، إلغاء)' }, async (ctx) => {
        const { status } = await readJson(ctx.req);
        return app.resources.update(ctx, 'events', Number(ctx.params.id), { status });
    });
    r.post('/api/v1/events/:id/archive', { tag: 'events', summary: 'أرشفة' }, (ctx) => {
        const ev = evOr404(ctx.params.id);
        app.auth.need(ctx, 'events', 'update', { orgId: ev.org_id, eventId: ev.id });
        run(db, 'UPDATE events SET archived = 1 - archived WHERE id = ?', ev.id);
        app.audit.record(app.auth.actorOf(ctx), 'events.archive', 'events', ev.id, { archived: ev.archived }, { archived: 1 - ev.archived });
        return { ok: true };
    });

    r.get('/api/v1/events/:id/heatmap', { tag: 'events', summary: 'الخريطة الحرارية: كثافة الدخول لكل منطقة بالساعة والإشغال الحالي' }, (ctx) => {
        const ev = evOr404(ctx.params.id);
        app.auth.need(ctx, 'events', 'view', { orgId: ev.org_id, eventId: ev.id });
        const zones = ev.venue_id ? all(db, 'SELECT id, name_ar, name_en, kind, capacity, x, y, w, h, color FROM zones WHERE venue_id = ? ORDER BY id', ev.venue_id) : [];
        const occ = new Map(app.attendance.zoneOccupancy('event', ev.id).map((z) => [z.zone_id, z.n]));
        const hours = new Map();
        const hourly = Array.from({ length: 24 }, (_, i) => ({ hour: i, in: 0, out: 0 }));
        for (const l of all(db, "SELECT zone_id, direction, at FROM attendance_logs WHERE subject_type = 'event' AND subject_id = ?", ev.id)) {
            const hr = new Date(new Date(l.at).getTime() + 3 * 3600_000).getUTCHours();
            hourly[hr][l.direction]++;
            if (l.direction !== 'in' || !l.zone_id) continue;
            const k = `${l.zone_id}:${hr}`;
            hours.set(k, (hours.get(k) || 0) + 1);
        }
        return { zones: zones.map((z) => ({ ...z, inside: occ.get(z.id) || 0 })), matrix: Object.fromEntries(hours), hourly, stats: app.attendance.stats('event', ev.id), capacity: ev.capacity, forecast: app.ai.forecast(ev.id) };
    });

    /* الدعوات */
    r.get('/api/v1/events/:id/invitations', { tag: 'invitations', summary: 'دعوات الفعالية' }, (ctx) => {
        const ev = evOr404(ctx.params.id);
        app.auth.need(ctx, 'events', 'view', { orgId: ev.org_id, eventId: ev.id });
        const q = ctx.query;
        const where = ['i.event_id = ?'];
        const args = [ev.id];
        if (q.status) { where.push('i.status = ?'); args.push(q.status); }
        if (q.channel) { where.push('i.channel = ?'); args.push(q.channel); }
        if (q.q) { where.push('(v.name_ar LIKE ? OR v.name_en LIKE ? OR v.email LIKE ? OR v.phone LIKE ?)'); const l = `%${q.q}%`; args.push(l, l, l, l); }
        const size = Math.min(Number(q.size) || 25, 500), page = Math.max(Number(q.page) || 1, 1);
        const total = one(db, `SELECT COUNT(*) n FROM invitations i JOIN visitors v ON v.id = i.visitor_id WHERE ${where.join(' AND ')}`, ...args).n;
        const sortCol = { name: 'v.name_ar', status: 'i.status', sent_at: 'i.sent_at', responded_at: 'i.responded_at' }[q.sort] || 'i.id';
        const rows = all(db, `SELECT i.id, i.visitor_id, i.channel, i.status, i.lang, i.sent_at, i.responded_at, i.remind_at, i.reminded_at, i.attempts, i.last_error, i.token, v.name_ar, v.name_en, v.email, v.phone, v.org_name, v.category
            FROM invitations i JOIN visitors v ON v.id = i.visitor_id WHERE ${where.join(' AND ')} ORDER BY ${sortCol} ${q.dir === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`, ...args, size, (page - 1) * size);
        const counts = Object.fromEntries(all(db, 'SELECT status, COUNT(*) n FROM invitations WHERE event_id = ? GROUP BY status', ev.id).map((x) => [x.status, x.n]));
        const canSeeLink = app.auth.scope(ctx, 'events', 'update');
        return { rows: rows.map((x) => ({ ...x, link: canSeeLink.all || canSeeLink.orgs.includes(ev.org_id) || canSeeLink.events.includes(ev.id) ? E.inviteLink(x.token) : null, token: undefined })), total, page, size, counts };
    });
    r.post('/api/v1/events/:id/invitations', { tag: 'invitations', summary: 'إنشاء دعوات (أفراد، مجموعات، استيراد، AD) وإرسالها اختيارياً' }, async (ctx) => {
        const b = await readJson(ctx.req, 5_000_000);
        const res = E.createInvitations(ctx, Number(ctx.params.id), b);
        if (b.send) res.sent = await E.sendMany(ctx, Number(ctx.params.id), null);
        return res;
    });
    r.post('/api/v1/events/:id/invitations/send', { tag: 'invitations', summary: 'إرسال/إعادة إرسال دعوات' }, async (ctx) => {
        const b = await readJson(ctx.req);
        return E.sendMany(ctx, Number(ctx.params.id), b.ids, b.kind === 'reminder' ? 'reminder' : 'invitation');
    });
    r.post('/api/v1/events/:id/invitations/schedule-reminder', { tag: 'invitations', summary: 'جدولة تذكير' }, async (ctx) => {
        const ev = evOr404(ctx.params.id);
        app.auth.need(ctx, 'events', 'update', { orgId: ev.org_id, eventId: ev.id });
        const { at, ids } = await readJson(ctx.req);
        const when = coerce({ key: 'at', type: 'datetime', req: 1 }, at);
        const n = ids?.length
            ? run(db, `UPDATE invitations SET remind_at = ?, reminded_at = NULL WHERE event_id = ? AND id IN (${ids.map(() => '?').join(',')})`, when, ev.id, ...ids.map(Number)).changes
            : run(db, "UPDATE invitations SET remind_at = ?, reminded_at = NULL WHERE event_id = ? AND status IN ('sent','confirmed')", when, ev.id).changes;
        app.audit.record(app.auth.actorOf(ctx), 'invitations.schedule_reminder', 'events', ev.id, null, { at: when, count: n });
        return { scheduled: n };
    });
    r.post('/api/v1/invitations/:id/cancel', { tag: 'invitations', summary: 'إلغاء دعوة (يُبطل رمز الدخول)' }, (ctx) => {
        const inv = one(db, 'SELECT * FROM invitations WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        const ev = evOr404(inv.event_id);
        app.auth.need(ctx, 'events', 'update', { orgId: ev.org_id, eventId: ev.id });
        run(db, "UPDATE invitations SET status = 'cancelled' WHERE id = ?", inv.id);
        app.attendance.revoke('event', inv.event_id, inv.visitor_id);
        app.audit.record(app.auth.actorOf(ctx), 'invitations.cancel', 'invitations', inv.id, { status: inv.status }, { status: 'cancelled' });
        return { ok: true };
    });
    r.post('/api/v1/invitations/:id/confirm', { tag: 'invitations', summary: 'تأكيد نيابة عن المدعو' }, (ctx) => {
        const inv = one(db, 'SELECT * FROM invitations WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        const ev = evOr404(inv.event_id);
        app.auth.need(ctx, 'events', 'update', { orgId: ev.org_id, eventId: ev.id });
        E.respond(inv, 'confirm', {}, ctx);
        return { ok: true };
    });

    /* التسجيلات */
    r.get('/api/v1/events/:id/registrations', { tag: 'events', summary: 'المسجلون' }, (ctx) => {
        const ev = evOr404(ctx.params.id);
        app.auth.need(ctx, 'events', 'view', { orgId: ev.org_id, eventId: ev.id });
        return { rows: all(db, `SELECT r.id, r.visitor_id, r.source, r.status, r.answers, r.created_at, v.name_ar, v.name_en, v.org_name, v.category, p.inside
            FROM registrations r JOIN visitors v ON v.id = r.visitor_id LEFT JOIN presence p ON p.subject_type = 'event' AND p.subject_id = r.event_id AND p.visitor_id = r.visitor_id
            WHERE r.event_id = ? ORDER BY r.id DESC LIMIT 2000`, ev.id) };
    });
    r.post('/api/v1/events/:id/register', { tag: 'events', summary: 'تسجيل فوري (الكشك أو الاستقبال)' }, async (ctx) => {
        app.auth.need(ctx, 'checkin', 'create', { eventId: Number(ctx.params.id), orgId: evOr404(ctx.params.id).org_id });
        const b = await readJson(ctx.req, 1_000_000);
        return E.registerWalkIn(ctx, Number(ctx.params.id), b, ctx.actor.kind === 'device' ? 'kiosk' : 'manual');
    });

    /* الجدول والخريطة (للوحة) */
    r.get('/api/v1/events/:id/schedule', { tag: 'events', summary: 'جدول الجلسات' }, (ctx) => {
        const ev = evOr404(ctx.params.id);
        app.auth.need(ctx, 'events', 'view', { orgId: ev.org_id, eventId: ev.id });
        return scheduleOf(ev.id);
    });
    const scheduleOf = (id) => {
        const sessions = all(db, 'SELECT * FROM event_sessions WHERE event_id = ? ORDER BY day, starts_at', id);
        const spIds = [...new Set(sessions.flatMap((s) => JSON.parse(s.speaker_ids || '[]')))];
        const speakers = spIds.length ? all(db, `SELECT id, name_ar, name_en, title, org_name FROM speakers WHERE id IN (${spIds.map(() => '?').join(',')})`, ...spIds) : [];
        return { sessions: sessions.map((s) => ({ ...s, speaker_ids: JSON.parse(s.speaker_ids || '[]') })), speakers };
    };
    r.get('/api/v1/venues/:id/map', { tag: 'events', summary: 'خريطة القاعة (الخلفية والمناطق)' }, (ctx) => {
        app.auth.need(ctx, 'events', 'view');
        const v = one(db, 'SELECT * FROM venues WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        return { venue: v, zones: all(db, 'SELECT * FROM zones WHERE venue_id = ? ORDER BY id', v.id) };
    });
    r.put('/api/v1/venues/:id/map', { tag: 'events', summary: 'حفظ تخطيط الخريطة (الخلفية SVG/صورة ومواقع المناطق)' }, async (ctx) => {
        app.auth.need(ctx, 'events', 'update');
        const v = one(db, 'SELECT * FROM venues WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        const b = await readJson(ctx.req, 3_000_000);
        const f = RESOURCES.venues.fields.find((x) => x.key === 'map_bg');
        if ('map_bg' in b) {
            const bg = b.map_bg ? coerce(f, b.map_bg) : null;
            if (bg && bg.startsWith('data:image/svg+xml')) {
                const svg = Buffer.from(bg.split(',')[1], 'base64').toString('utf8');
                if (/<script|on\w+\s*=|javascript:|<foreignObject/i.test(svg)) fail(422, 'invalid', { errors: [{ field: 'map_bg', code: 'unsafe_svg' }] });
            }
            run(db, 'UPDATE venues SET map_bg = ? WHERE id = ?', bg, v.id);
        }
        if (b.map_w) run(db, 'UPDATE venues SET map_w = ?, map_h = ? WHERE id = ?', coerce({ key: 'w', type: 'int', min: 200, max: 5000 }, b.map_w), coerce({ key: 'h', type: 'int', min: 200, max: 5000 }, b.map_h), v.id);
        for (const z of (b.zones || []).slice(0, 200)) {
            const num = (k) => coerce({ key: k, type: 'number', min: 0, max: 5000 }, z[k]);
            run(db, 'UPDATE zones SET x = ?, y = ?, w = ?, h = ? WHERE id = ? AND venue_id = ?', num('x'), num('y'), num('w'), num('h'), Number(z.id), v.id);
        }
        app.audit.record(app.auth.actorOf(ctx), 'venues.map_update', 'venues', v.id, null, { zones: (b.zones || []).length, bg: 'map_bg' in b });
        return { ok: true };
    });

    /* ───────── صفحات المشارك العامة (برمز الدعوة) ───────── */
    const invOr404 = (token) => one(db, 'SELECT * FROM invitations WHERE token = ?', String(token)) || fail(404, 'not_found');
    r.get('/api/public/inv/:token', { public: true, tag: 'public', summary: 'بيانات الدعوة للمشارك' }, (ctx) => {
        const inv = invOr404(ctx.params.token);
        const ev = one(db, 'SELECT * FROM events WHERE id = ?', inv.event_id);
        const v = one(db, 'SELECT id, name_ar, name_en, org_name, category, photo FROM visitors WHERE id = ?', inv.visitor_id);
        const form = ev.form_id ? one(db, 'SELECT id, name, fields FROM forms WHERE id = ?', ev.form_id) : null;
        const cred = ['confirmed', 'sent'].includes(inv.status) ? one(db, "SELECT * FROM credentials WHERE subject_type = 'event' AND subject_id = ? AND visitor_id = ? AND revoked = 0", ev.id, v.id) : null;
        const pres = one(db, "SELECT inside FROM presence WHERE subject_type = 'event' AND subject_id = ? AND visitor_id = ?", ev.id, v.id);
        return {
            status: inv.status, lang: inv.lang, event: E.publicEvent(ev), visitor: { name_ar: v.name_ar, name_en: v.name_en, org_name: v.org_name, category: v.category, has_photo: !!v.photo },
            form: form ? { id: form.id, fields: JSON.parse(form.fields || '[]') } : null,
            qr: inv.status === 'confirmed' && cred ? app.attendance.tokenFor(cred) : null, inside: !!pres?.inside,
            branding: app.publicBranding(),
        };
    });
    r.post('/api/public/inv/:token/respond', { public: true, tag: 'public', summary: 'تأكيد الحضور أو الاعتذار' }, async (ctx) => {
        if (app.limited('rsvp:' + ctx.ip, 60, 60_000)) fail(429, 'slow_down');
        const inv = invOr404(ctx.params.token);
        const b = await readJson(ctx.req, 1_000_000);
        E.respond(inv, b.response === 'decline' ? 'decline' : 'confirm', b.answers || {}, ctx);
        return { ok: true };
    });
    r.get('/api/public/inv/:token/schedule', { public: true, tag: 'public' }, (ctx) => scheduleOf(invOr404(ctx.params.token).event_id));
    r.get('/api/public/inv/:token/map', { public: true, tag: 'public' }, (ctx) => {
        const ev = one(db, 'SELECT venue_id FROM events WHERE id = ?', invOr404(ctx.params.token).event_id);
        if (!ev.venue_id) return { venue: null, zones: [] };
        return { venue: one(db, 'SELECT id, name_ar, name_en, map_bg, map_w, map_h FROM venues WHERE id = ?', ev.venue_id), zones: all(db, 'SELECT id, name_ar, name_en, kind, x, y, w, h, color FROM zones WHERE venue_id = ?', ev.venue_id) };
    });
    r.get('/api/public/inv/:token/announcements', { public: true, tag: 'public' }, (ctx) => {
        const inv = invOr404(ctx.params.token);
        return { rows: all(db, "SELECT id, params, priority, created_at FROM notifications WHERE type = 'announcement' AND entity = 'events' AND entity_id = ? ORDER BY id DESC LIMIT 50", inv.event_id).map((n) => ({ ...n, params: JSON.parse(n.params) })) };
    });
    r.get('/api/public/inv/:token/calendar.ics', { public: true, tag: 'public' }, (ctx) => {
        const ev = one(db, 'SELECT * FROM events WHERE id = ?', invOr404(ctx.params.token).event_id);
        const body = app.integrations.ics([{ uid: `event-${ev.id}`, start: ev.starts_at, end: ev.ends_at, title: ev.title_ar, location: ev.location, description: ev.title_en }]);
        ctx.res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="event-${ev.id}.ics"` });
        ctx.res.end(body);
    });
    /* التسجيل المفتوح عبر رابط عام */
    r.get('/api/public/events/:id/register', { public: true, tag: 'public', summary: 'نموذج التسجيل المفتوح' }, (ctx) => {
        const ev = evOr404(ctx.params.id);
        if (!ev.open_registration || ['draft', 'cancelled', 'ended'].includes(ev.status)) fail(404, 'not_found');
        const form = ev.form_id ? one(db, 'SELECT fields FROM forms WHERE id = ?', ev.form_id) : null;
        return { event: E.publicEvent(ev), form: { fields: JSON.parse(form?.fields || '[]') }, branding: app.publicBranding() };
    });
    r.post('/api/public/events/:id/register', { public: true, tag: 'public', summary: 'تسجيل مفتوح' }, async (ctx) => {
        if (app.limited('reg:' + ctx.ip, 20, 60_000)) fail(429, 'slow_down');
        const b = await readJson(ctx.req, 1_000_000);
        const ev = evOr404(ctx.params.id);
        const res = E.registerWalkIn({ ...ctx, actor: { kind: 'public', name: 'public', ip: ctx.ip, grants: [] } }, ev.id, b, 'web');
        // صفحة مشارك لهذا التسجيل
        let inv = one(db, 'SELECT token FROM invitations WHERE event_id = ? AND visitor_id = ?', ev.id, res.visitor.id);
        if (!inv) { const token = randomToken(18); run(db, "INSERT INTO invitations (event_id, visitor_id, channel, status, token, responded_at) VALUES (?,?,'none','confirmed',?,datetime('now'))", ev.id, res.visitor.id, token); inv = { token }; }
        else run(db, "UPDATE invitations SET status = 'confirmed', responded_at = datetime('now') WHERE event_id = ? AND visitor_id = ?", ev.id, res.visitor.id);
        return { ok: true, link: `/m/i/${inv.token}` };
    });
}
