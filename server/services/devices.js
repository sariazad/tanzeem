// تنظيم — الأجهزة (أكشاك، طابعات، ماسحات، أجهزة استقبال): الربط برمز، النبضات والحالة اللحظية، الأوامر عن بعد،
// سجل الأعطال، وأوامر الطباعة (ZPL عبر Print Agent أو طباعة المتصفح).
import crypto from 'node:crypto';
import { one, all, run } from '../db.js';
import { fail, readJson } from '../http.js';
import { randomToken, sha256 } from '../security.js';
import { renderSvg, renderZpl, defaultDesign, CATEGORY_LABELS } from '../../shared/badge.js';
import { fmtDate } from '../../shared/messages.js';

export const DEVICE_COMMANDS = ['reload', 'restart', 'update', 'identify', 'sync'];
export const KIOSK_DEFAULTS = { idle_seconds: 45, allow_walkin: true, capture_photo: true, languages: ['ar', 'en'], print_mode: 'auto', welcome_ar: '', welcome_en: '', exit_mode: false };

export function makeDevices(app) {
    const { db } = app;
    const newCode = () => String(crypto.randomInt(100000, 999999));

    app.resources.hooks.devices = {
        beforeSave(ctx, data, before) {
            if (!before) { data.pair_code = newCode(); data.pair_expires = Date.now() + 24 * 3600_000; data.status = 'pending'; data.config = JSON.stringify(data.kind === 'kiosk' ? KIOSK_DEFAULTS : {}); }
        },
        afterSave(ctx, row, before) { if (before) app.hub?.publish(`device:${row.id}`, 'config', deviceInfo(row)); },
        decorate(rows) {
            return rows.map((r) => ({ ...r, online: app.hub?.deviceOnline(r.id) || false, pair_code: r.status === 'pending' ? one(db, 'SELECT pair_code FROM devices WHERE id = ?', r.id)?.pair_code : undefined }));
        },
    };

    function deviceInfo(d) {
        const cfg = { ...(d.kind === 'kiosk' ? KIOSK_DEFAULTS : {}), ...JSON.parse(d.config || '{}') };
        const ev = d.event_id ? one(db, 'SELECT id, title_ar, title_en, status, starts_at, ends_at, form_id, open_registration FROM events WHERE id = ?', d.event_id) : null;
        const form = ev?.form_id ? one(db, 'SELECT fields FROM forms WHERE id = ?', ev.form_id) : null;
        const printer = d.printer_id ? one(db, 'SELECT id, name, kind, status FROM devices WHERE id = ?', d.printer_id) : null;
        return { id: d.id, name: d.name, kind: d.kind, location: d.location, gate: d.gate, zone_id: d.zone_id, config: cfg, event: ev ? { ...ev, form: form ? JSON.parse(form.fields) : [] } : null, printer, branding: app.publicBranding() };
    }

    function heartbeat(d, msg = {}) {
        const status = msg.error ? 'error' : msg.paper_low ? 'paper_low' : 'online';
        const prev = one(db, 'SELECT status FROM devices WHERE id = ?', d.id)?.status;
        run(db, 'UPDATE devices SET last_seen = ?, status = ?, version = COALESCE(?, version) WHERE id = ?', Date.now(), status, msg.version ? String(msg.version).slice(0, 30) : null, d.id);
        if (prev !== status) {
            app.hub?.publish('devices', 'device', { id: d.id, status });
            if (status === 'paper_low') app.notify('printer_paper_low', 'medium', { device: d.name }, 'devices', d.id, { dedupe: `paper:${d.id}`, minutes: 60 });
            if (status === 'error') {
                run(db, 'INSERT INTO device_faults (device_id, code, message) VALUES (?,?,?)', d.id, 'error', String(msg.error).slice(0, 300));
                app.notify('device_error', 'high', { device: d.name, message: String(msg.error).slice(0, 100) }, 'devices', d.id, { dedupe: `deverr:${d.id}`, minutes: 30 });
            }
        }
    }

    function markOffline(d, reason = 'disconnected') {
        const row = one(db, 'SELECT * FROM devices WHERE id = ?', d.id);
        if (!row || row.status === 'offline' || row.status === 'pending') return;
        run(db, "UPDATE devices SET status = 'offline' WHERE id = ?", d.id);
        run(db, 'INSERT INTO device_faults (device_id, code, message) VALUES (?,?,?)', d.id, 'offline', reason);
        app.hub?.publish('devices', 'device', { id: d.id, status: 'offline' });
        app.notify('device_offline', 'high', { device: row.name, location: row.location || '' }, 'devices', d.id, { dedupe: `off:${d.id}`, minutes: 30 });
    }

    /** يُستدعى دورياً: الأجهزة التي توقفت نبضاتها أكثر من دقيقتين. */
    function sweep() {
        for (const d of all(db, "SELECT id, name, last_seen FROM devices WHERE status IN ('online','paper_low','error') AND last_seen < ?", Date.now() - 120_000)) {
            if (!app.hub?.deviceOnline(d.id)) markOffline(d, 'no heartbeat');
        }
    }

    /* ───────── الطباعة ───────── */
    function badgeData(visitor, subject, token, lang = 'ar') {
        const b = app.getSetting('branding', {});
        return {
            name_ar: visitor.name_ar, name_en: visitor.name_en || '', org_name: visitor.org_name || '', job_title: visitor.job_title || '', category: visitor.category,
            category_label: `${CATEGORY_LABELS.ar[visitor.category] || ''} · ${CATEGORY_LABELS.en[visitor.category] || ''}`,
            event_title: lang === 'en' ? subject.title_en || subject.title_ar : subject.title_ar, event_date: fmtDate(subject.starts_at, lang).split(' (')[0],
            qr: token, photo: visitor.photo || null, logo: b.logo || null,
        };
    }

    function templateFor(subjectType, subjectId, templateId) {
        let t = templateId ? one(db, 'SELECT * FROM badge_templates WHERE id = ?', templateId) : null;
        if (!t && subjectType === 'event') t = one(db, 'SELECT t.* FROM badge_templates t JOIN events e ON e.badge_template_id = t.id WHERE e.id = ?', subjectId);
        if (!t) t = one(db, 'SELECT * FROM badge_templates WHERE is_default = 1 ORDER BY id LIMIT 1') || one(db, 'SELECT * FROM badge_templates ORDER BY id LIMIT 1');
        if (!t) return { id: null, width_mm: 54, height_mm: 85.6, design: defaultDesign() };
        return { ...t, design: JSON.parse(t.design || '{}') };
    }

    function print(ctx, { visitorId, subjectType = 'event', subjectId, templateId, deviceId, lang = 'ar' }) {
        app.auth.need(ctx, 'checkin', 'create');
        const visitor = one(db, 'SELECT * FROM visitors WHERE id = ?', Number(visitorId)) || fail(404, 'no_visitor');
        const subject = app.attendance.subjectRow(subjectType, Number(subjectId)) || fail(404, 'no_subject');
        if (ctx.actor.kind === 'device' && ctx.actor.device.event_id && subjectType === 'event' && ctx.actor.device.event_id !== subject.id) fail(403, 'forbidden');
        if (visitor.blocked) fail(403, 'blocked');
        const { token } = app.attendance.issue(subjectType, subject.id, visitor.id);
        const tpl = templateFor(subjectType, subject.id, templateId);
        const data = badgeData(visitor, subject, token, lang);
        // الطابعة: المحددة صراحة، أو طابعة الجهاز المرتبطة
        const printerId = deviceId || (ctx.actor.kind === 'device' ? ctx.actor.device.printer_id : null);
        const printer = printerId ? one(db, 'SELECT * FROM devices WHERE id = ?', Number(printerId)) : null;
        const viaAgent = printer && printer.kind === 'printer' && app.hub?.deviceOnline(printer.id);
        const jobId = Number(run(db, 'INSERT INTO print_jobs (device_id, template_id, visitor_id, subject_type, subject_id, format, status, user_id) VALUES (?,?,?,?,?,?,?,?)',
            printer?.id ?? (ctx.actor.device?.id || null), tpl.id, visitor.id, subjectType, subject.id, viaAgent ? 'zpl' : 'browser', viaAgent ? 'sent' : 'preview', ctx.actor.userId || null).lastInsertRowid);
        const svg = renderSvg(tpl.design, tpl.width_mm, tpl.height_mm, data);
        if (viaAgent) {
            const pcfg = JSON.parse(printer.config || '{}');
            app.hub.publish(`device:${printer.id}`, 'print', { job_id: jobId, zpl: renderZpl(tpl.design, tpl.width_mm, tpl.height_mm, data, { dpmm: pcfg.dpmm || 8, font: pcfg.font }), svg, width_mm: tpl.width_mm, height_mm: tpl.height_mm });
        }
        app.audit.record(app.auth.actorOf(ctx), 'badges.print', 'visitors', visitor.id, null, { job_id: jobId, subject_type: subjectType, subject_id: subject.id, via: viaAgent ? 'agent' : 'browser', printer_id: printer?.id ?? null });
        return { job_id: jobId, via: viaAgent ? 'agent' : 'browser', svg, width_mm: tpl.width_mm, height_mm: tpl.height_mm };
    }

    function printResult(deviceId, { job_id, ok, error }) {
        const job = one(db, 'SELECT * FROM print_jobs WHERE id = ?', Number(job_id));
        if (!job) return;
        run(db, "UPDATE print_jobs SET status = ?, error = ?, done_at = datetime('now') WHERE id = ?", ok ? 'printed' : 'failed', ok ? null : String(error || '').slice(0, 300), job.id);
        if (!ok) {
            run(db, 'INSERT INTO device_faults (device_id, code, message) VALUES (?,?,?)', deviceId, 'print_failed', String(error || '').slice(0, 300));
            app.notify('print_failed', 'medium', { job: job.id, message: String(error || '').slice(0, 100) }, 'devices', deviceId);
        }
        app.hub?.publish('devices', 'print_job', { id: job.id, status: ok ? 'printed' : 'failed' });
    }

    function onMessage(device, msg) {
        if (msg.type === 'heartbeat') heartbeat(device, msg);
        else if (msg.type === 'print_result') printResult(device.id, msg);
        else if (msg.type === 'fault') {
            run(db, 'INSERT INTO device_faults (device_id, code, message) VALUES (?,?,?)', device.id, String(msg.code || 'fault').slice(0, 40), String(msg.message || '').slice(0, 300));
        }
    }

    return { deviceInfo, heartbeat, markOffline, sweep, print, printResult, onMessage, templateFor, badgeData, newCode };
}

export function registerDevices(r, app) {
    const { db } = app;
    const D = app.devices;

    /* الربط: الجهاز يُدخل رمز الربط (من صفحة الأجهزة) فيحصل على رمز دائم يُحفظ عنده */
    r.post('/api/device/pair', { public: true, tag: 'devices', summary: 'ربط جهاز برمز الربط' }, async (ctx) => {
        if (app.limited('pair:' + ctx.ip, 10, 60_000)) fail(429, 'slow_down');
        const { code, version } = await readJson(ctx.req, 2000);
        const d = one(db, 'SELECT * FROM devices WHERE pair_code = ? AND pair_expires > ?', String(code || '').trim(), Date.now());
        if (!d) { app.audit.record({ name: 'device', ip: ctx.ip }, 'devices.pair_failed'); fail(404, 'bad_code'); }
        const token = `tzd_${randomToken(32)}`;
        run(db, "UPDATE devices SET token_hash = ?, pair_code = NULL, pair_expires = NULL, status = 'online', last_seen = ?, version = ? WHERE id = ?", sha256(token), Date.now(), String(version || '').slice(0, 30) || null, d.id);
        app.audit.record({ name: `device:${d.name}`, ip: ctx.ip }, 'devices.paired', 'devices', d.id);
        app.hub?.publish('devices', 'device', { id: d.id, status: 'online' });
        return { token, device: D.deviceInfo(one(db, 'SELECT * FROM devices WHERE id = ?', d.id)) };
    });
    r.get('/api/device/me', { tag: 'devices', summary: 'إعدادات الجهاز الحالي' }, (ctx) => {
        if (ctx.actor?.kind !== 'device') fail(401, 'unauthenticated');
        D.heartbeat(ctx.actor.device, { version: ctx.query.v });
        return D.deviceInfo(one(db, 'SELECT * FROM devices WHERE id = ?', ctx.actor.device.id));
    });
    r.post('/api/device/heartbeat', { tag: 'devices', summary: 'نبضة الجهاز (بديل WebSocket)' }, async (ctx) => {
        if (ctx.actor?.kind !== 'device') fail(401, 'unauthenticated');
        D.heartbeat(ctx.actor.device, await readJson(ctx.req, 5000));
        return { ok: true };
    });
    r.post('/api/v1/devices/:id/pair-code', { tag: 'devices', summary: 'رمز ربط جديد (يُلغي ربط الجهاز الحالي)' }, (ctx) => {
        app.auth.need(ctx, 'devices', 'update');
        const d = one(db, 'SELECT * FROM devices WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        const code = D.newCode();
        run(db, "UPDATE devices SET pair_code = ?, pair_expires = ?, token_hash = NULL, status = 'pending' WHERE id = ?", code, Date.now() + 24 * 3600_000, d.id);
        app.hub?.publish(`device:${d.id}`, 'command', { cmd: 'unpair' });
        app.audit.record(app.auth.actorOf(ctx), 'devices.repair', 'devices', d.id);
        return { pair_code: code };
    });
    r.post('/api/v1/devices/:id/command', { tag: 'devices', summary: 'أمر عن بعد: reload | restart | update | identify | sync' }, async (ctx) => {
        app.auth.need(ctx, 'devices', 'update');
        const d = one(db, 'SELECT * FROM devices WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        const { cmd } = await readJson(ctx.req);
        if (!DEVICE_COMMANDS.includes(cmd)) fail(422, 'invalid', { errors: [{ field: 'cmd', code: 'option' }] });
        const delivered = app.hub?.publish(`device:${d.id}`, 'command', { cmd }) || 0;
        app.audit.record(app.auth.actorOf(ctx), `devices.command`, 'devices', d.id, null, { cmd, delivered });
        return { delivered };
    });
    r.put('/api/v1/devices/:id/config', { tag: 'devices', summary: 'إعدادات الكشك' }, async (ctx) => {
        app.auth.need(ctx, ctx.query.from === 'kiosk' ? 'kiosk' : 'devices', 'update');
        const d = one(db, 'SELECT * FROM devices WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        const b = await readJson(ctx.req);
        const cur = JSON.parse(d.config || '{}');
        const next = { ...cur };
        const num = (v, min, max) => Math.max(min, Math.min(max, Number(v) || min));
        if ('idle_seconds' in b) next.idle_seconds = num(b.idle_seconds, 10, 600);
        for (const k of ['allow_walkin', 'capture_photo', 'exit_mode']) if (k in b) next[k] = !!b[k];
        if (Array.isArray(b.languages)) next.languages = b.languages.filter((l) => ['ar', 'en'].includes(l));
        if (['auto', 'browser', 'agent', 'none'].includes(b.print_mode)) next.print_mode = b.print_mode;
        for (const k of ['welcome_ar', 'welcome_en', 'font']) if (k in b) next[k] = String(b[k] || '').slice(0, 200);
        if ('dpmm' in b) next.dpmm = num(b.dpmm, 6, 24);
        run(db, 'UPDATE devices SET config = ? WHERE id = ?', JSON.stringify(next), d.id);
        if ('event_id' in b) run(db, 'UPDATE devices SET event_id = ? WHERE id = ?', b.event_id ? Number(b.event_id) : null, d.id);
        if ('printer_id' in b) run(db, 'UPDATE devices SET printer_id = ? WHERE id = ?', b.printer_id ? Number(b.printer_id) : null, d.id);
        const row = one(db, 'SELECT * FROM devices WHERE id = ?', d.id);
        app.hub?.publish(`device:${d.id}`, 'config', D.deviceInfo(row));
        app.audit.record(app.auth.actorOf(ctx), 'devices.config', 'devices', d.id, cur, next);
        return D.deviceInfo(row);
    });
    r.get('/api/v1/devices/:id/faults', { tag: 'devices', summary: 'سجل الأعطال' }, (ctx) => {
        app.auth.need(ctx, 'devices', 'view');
        return { rows: all(db, 'SELECT * FROM device_faults WHERE device_id = ? ORDER BY id DESC LIMIT 200', Number(ctx.params.id)),
            jobs: all(db, 'SELECT id, visitor_id, format, status, error, created_at FROM print_jobs WHERE device_id = ? ORDER BY id DESC LIMIT 50', Number(ctx.params.id)) };
    });
    r.get('/api/v1/devices/overview', { tag: 'devices', summary: 'ملخص حالة الأجهزة' }, (ctx) => {
        app.auth.need(ctx, 'devices', 'view');
        return { counts: Object.fromEntries(all(db, 'SELECT status, COUNT(*) n FROM devices GROUP BY status').map((x) => [x.status, x.n])) };
    });

    /* الطباعة */
    r.post('/api/v1/print', { tag: 'badges', summary: 'طباعة بطاقة (إلى Print Agent أو معاينة للطباعة من المتصفح)' }, async (ctx) => {
        const b = await readJson(ctx.req);
        return D.print(ctx, { visitorId: b.visitor_id, subjectType: b.subject_type || 'event', subjectId: b.subject_id || ctx.actor?.device?.event_id, templateId: b.template_id, deviceId: b.device_id, lang: b.lang });
    });
    r.post('/api/v1/print/:id/result', { tag: 'badges', summary: 'نتيجة الطباعة (من الجهاز)' }, async (ctx) => {
        const b = await readJson(ctx.req);
        const job = one(db, 'SELECT * FROM print_jobs WHERE id = ?', Number(ctx.params.id)) || fail(404, 'not_found');
        if (ctx.actor?.kind === 'device') D.printResult(ctx.actor.device.id, { job_id: job.id, ok: b.ok, error: b.error });
        else { app.auth.need(ctx, 'checkin', 'create'); D.printResult(job.device_id, { job_id: job.id, ok: b.ok, error: b.error }); }
        return { ok: true };
    });
    r.post('/api/v1/badges/preview', { tag: 'badges', summary: 'معاينة قالب ببيانات تجريبية' }, async (ctx) => {
        app.auth.need(ctx, 'badges', 'view');
        const b = await readJson(ctx.req, 3_000_000);
        const sample = { name_ar: 'عبدالله بن محمد', name_en: 'Abdullah Mohammed', org_name: 'جامعة الملك سعود', job_title: 'مدير إدارة', category: b.category || 'vip', category_label: 'كبار الضيوف · VIP', event_title: 'ملتقى التحول الرقمي', event_date: '١٥ ديسمبر ٢٠٢٦', qr: 'TZ1.preview.AAAAAAAAAAAAAAAAAAAAAA', logo: app.getSetting('branding', {}).logo || null };
        return { svg: renderSvg(b.design, Number(b.width_mm) || 54, Number(b.height_mm) || 85.6, sample), zpl: renderZpl(b.design, Number(b.width_mm) || 54, Number(b.height_mm) || 85.6, sample) };
    });
}
