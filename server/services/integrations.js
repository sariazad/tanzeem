// تنظيم — طبقة التكامل: البريد (SMTP) والرسائل النصية (محوّل قابل للتبديل) وActive Directory وOIDC
// والتقويم (ICS) وWebhooks الصادرة ومزوّد الذكاء الاصطناعي. الإعدادات مشفّرة في قاعدة البيانات.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { one, all, run } from '../db.js';
import { fail, readJson, send } from '../http.js';
import { decrypt, randomToken, sha256 } from '../security.js';

export const INTEGRATION_KINDS = ['smtp', 'sms', 'ldap', 'oidc', 'calendar', 'webhook', 'ai'];
/** الحقول السرية لا تُعاد للواجهة أبداً. */
const SECRET_KEYS = ['password', 'pass', 'client_secret', 'bind_password', 'api_key', 'secret', 'token'];
export const WEBHOOK_EVENTS = ['attendance.in', 'attendance.out', 'invitation.confirmed', 'invitation.declined', 'visit.approved', 'visit.status', 'event.status', 'visitor.blocked_attempt'];

export function makeIntegrations(app) {
    const { db } = app;
    const decode = (row) => { try { return JSON.parse(decrypt(app.keys.enc, row.config_enc) || '{}'); } catch { return {}; } };
    const config = (kind) => {
        const row = one(db, 'SELECT * FROM integrations WHERE kind = ? AND enabled = 1 ORDER BY id LIMIT 1', kind);
        return row ? { ...decode(row), __id: row.id } : null;
    };
    const logIt = (id, ok, action, message) => {
        if (!id) return;
        run(db, 'INSERT INTO integration_logs (integration_id, ok, action, message) VALUES (?,?,?,?)', id, ok ? 1 : 0, action, String(message || '').slice(0, 500));
        run(db, `UPDATE integrations SET status = ?, last_error = ?, last_sync = datetime('now') WHERE id = ?`, ok ? 'ok' : 'error', ok ? null : String(message).slice(0, 300), id);
        if (!ok) app.notify('integration_failed', 'high', { action, message: String(message).slice(0, 120) }, 'integrations', id, { dedupe: `int:${id}:${action}`, minutes: 30 });
    };
    const masked = (cfg) => Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, SECRET_KEYS.includes(k) && v ? '••••••' : v]));

    /* ───────── البريد ───────── */
    let transport = null, transportKey = '';
    async function sendMail({ to, subject, html, text, attachments }) {
        const c = config('smtp');
        if (!c) {
            // بلا SMTP: الرسالة تُسجّل فقط (وضع العرض التجريبي)، والرابط متاح للنسخ من الواجهة.
            app.log({ msg: 'mail.logged', to: maskEmail(to), subject });
            return { channel: 'log' };
        }
        const key = JSON.stringify(c);
        if (!transport || key !== transportKey) {
            transport = nodemailer.createTransport({ host: c.host, port: Number(c.port || 587), secure: Number(c.port) === 465, auth: c.user ? { user: c.user, pass: c.password } : undefined, tls: { rejectUnauthorized: c.insecure_tls ? false : true } });
            transportKey = key;
        }
        try {
            await transport.sendMail({ from: c.from || c.user, to, subject, html, text, attachments });
            logIt(c.__id, true, 'send', `mail → ${maskEmail(to)}`);
            return { channel: 'smtp' };
        } catch (e) {
            logIt(c.__id, false, 'send', e.message);
            throw e;
        }
    }

    /* ───────── الرسائل النصية (محوّل HTTP عام يناسب مزودي SMS المحليين) ───────── */
    async function sendSms({ to, message }) {
        const c = config('sms');
        if (!c || c.provider === 'log') {
            app.log({ msg: 'sms.logged', to: String(to).slice(0, 5) + '•••' });
            return { channel: 'log' };
        }
        const fill = (s) => String(s || '').replaceAll('{to}', encodeURIComponent(to)).replaceAll('{message}', encodeURIComponent(message)).replaceAll('{sender}', encodeURIComponent(c.sender || ''));
        const fillJson = (s) => String(s || '').replaceAll('{to}', JSON.stringify(to).slice(1, -1)).replaceAll('{message}', JSON.stringify(message).slice(1, -1)).replaceAll('{sender}', c.sender || '');
        try {
            const headers = { 'Content-Type': c.content_type || 'application/json' };
            if (c.api_key) headers[c.auth_header || 'Authorization'] = (c.auth_prefix ?? 'Bearer ') + c.api_key;
            const r = await fetch(fill(c.url), { method: c.method || 'POST', headers, body: (c.method || 'POST') === 'GET' ? undefined : fillJson(c.body_template || '{"to":"{to}","message":"{message}","sender":"{sender}"}'), signal: AbortSignal.timeout(15000) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            logIt(c.__id, true, 'send', 'sms sent');
            return { channel: 'sms' };
        } catch (e) {
            logIt(c.__id, false, 'send', e.message);
            throw e;
        }
    }

    /* ───────── Active Directory / LDAP ───────── */
    async function ldapClient(c) {
        const { Client } = await import('ldapts');
        return new Client({ url: c.url, timeout: 8000, connectTimeout: 8000, tlsOptions: c.insecure_tls ? { rejectUnauthorized: false } : undefined });
    }
    const ldapEsc = (s) => String(s).replace(/[\\*()\0]/g, (ch) => '\\' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
    async function ldapAuthenticate(username, password) {
        const c = config('ldap');
        if (!c || !password) return null;
        const client = await ldapClient(c);
        try {
            await client.bind(c.bind_dn, c.bind_password);
            const filter = (c.user_filter || '(|(sAMAccountName={u})(userPrincipalName={u})(mail={u})(uid={u}))').replaceAll('{u}', ldapEsc(username.replace(/@.*$/, (m) => (c.keep_domain ? m : '')) || username));
            const { searchEntries } = await client.search(c.base_dn, { scope: 'sub', filter, attributes: ['dn', 'mail', 'displayName', 'cn', 'sAMAccountName', 'uid', 'telephoneNumber', 'memberOf'], sizeLimit: 2 });
            if (searchEntries.length !== 1) return null;
            const e = searchEntries[0];
            const userClient = await ldapClient(c);
            try { await userClient.bind(e.dn, password); } finally { await userClient.unbind().catch(() => {}); }
            logIt(c.__id, true, 'auth', 'bind ok');
            return { email: String(e.mail || `${e.sAMAccountName || e.uid}@${c.domain || 'local'}`), name: String(e.displayName || e.cn || username), username: String(e.sAMAccountName || e.uid || username), phone: e.telephoneNumber ? String(e.telephoneNumber) : null, defaultRole: c.default_role, groups: [].concat(e.memberOf || []).map(String) };
        } catch (e) {
            if (!/invalid credentials|49/i.test(e.message)) logIt(c.__id, false, 'auth', e.message);
            return null;
        } finally { await client.unbind().catch(() => {}); }
    }
    async function ldapSearch(q, limit = 50) {
        const c = config('ldap');
        if (!c) fail(404, 'ldap_off');
        const client = await ldapClient(c);
        try {
            await client.bind(c.bind_dn, c.bind_password);
            const v = ldapEsc(q);
            const filter = `(&(|(objectClass=user)(objectClass=inetOrgPerson))(|(cn=*${v}*)(mail=*${v}*)(sAMAccountName=*${v}*)(uid=*${v}*)(department=*${v}*)))`;
            const { searchEntries } = await client.search(c.base_dn, { scope: 'sub', filter, attributes: ['mail', 'displayName', 'cn', 'department', 'title', 'telephoneNumber', 'mobile'], sizeLimit: limit });
            logIt(c.__id, true, 'search', `${searchEntries.length} results`);
            return searchEntries.map((e) => ({ name: String(e.displayName || e.cn), email: e.mail ? String(e.mail) : null, org_name: e.department ? String(e.department) : null, job_title: e.title ? String(e.title) : null, phone: e.mobile || e.telephoneNumber ? String(e.mobile || e.telephoneNumber) : null }));
        } catch (e) { logIt(c.__id, false, 'search', e.message); throw e; } finally { await client.unbind().catch(() => {}); }
    }

    /** إنشاء أو تحديث حساب قادم من AD أو SSO. */
    function provisionUser({ email, name, username, phone, source, defaultRole }) {
        if (!email) fail(400, 'no_email');
        let u = one(db, 'SELECT * FROM users WHERE email = ?', email);
        if (!u) {
            const r = run(db, 'INSERT INTO users (name, email, username, phone, source) VALUES (?,?,?,?,?)', name, email, username || null, phone || null, source);
            u = one(db, 'SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid));
            const role = one(db, 'SELECT id FROM roles WHERE key = ?', defaultRole || 'reception');
            if (role) run(db, "INSERT OR IGNORE INTO user_roles (user_id, role_id, scope_type) VALUES (?, ?, 'all')", u.id, role.id);
            app.audit.record({ name: 'system' }, 'users.provision', 'users', u.id, null, { email, source });
        } else if (u.source !== source && u.source !== 'local') {
            run(db, 'UPDATE users SET source = ? WHERE id = ?', source, u.id);
        }
        return one(db, 'SELECT * FROM users WHERE id = ?', u.id);
    }

    /* ───────── OIDC ───────── */
    const discoCache = new Map();
    async function oidcDiscovery(c) {
        const k = c.issuer;
        if (discoCache.has(k) && Date.now() - discoCache.get(k).at < 3600_000) return discoCache.get(k).doc;
        const r = await fetch(`${c.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error(`discovery HTTP ${r.status}`);
        const doc = await r.json();
        discoCache.set(k, { doc, at: Date.now() });
        return doc;
    }
    async function oidcExchange(c, code, verifier, nonce, redirectUri) {
        const disc = await oidcDiscovery(c);
        const r = await fetch(disc.token_endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: c.client_id, client_secret: c.client_secret || '', code_verifier: verifier }),
            signal: AbortSignal.timeout(10000),
        });
        const tok = await r.json();
        if (!r.ok || !tok.id_token) { logIt(c.__id, false, 'token', tok.error || r.status); fail(401, 'sso_failed'); }
        const [h, p, s] = tok.id_token.split('.');
        const header = JSON.parse(Buffer.from(h, 'base64url').toString());
        const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
        const jwks = await (await fetch(disc.jwks_uri, { signal: AbortSignal.timeout(10000) })).json();
        const jwk = jwks.keys.find((k) => k.kid === header.kid) || jwks.keys[0];
        const alg = { RS256: 'sha256', RS384: 'sha384', RS512: 'sha512', ES256: 'sha256' }[header.alg];
        if (!alg) fail(401, 'sso_alg');
        const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
        const ok = crypto.verify(alg, Buffer.from(`${h}.${p}`), header.alg.startsWith('ES') ? { key, dsaEncoding: 'ieee-p1363' } : key, Buffer.from(s, 'base64url'));
        const now = Date.now() / 1000;
        const audOk = Array.isArray(claims.aud) ? claims.aud.includes(c.client_id) : claims.aud === c.client_id;
        if (!ok || !audOk || claims.iss !== disc.issuer || claims.exp < now || claims.nonce !== nonce) { logIt(c.__id, false, 'verify', 'id_token rejected'); fail(401, 'sso_failed'); }
        logIt(c.__id, true, 'login', 'sso ok');
        return claims;
    }

    /* ───────── Webhooks الصادرة (موقّعة HMAC، مع إعادة محاولة) ───────── */
    function emit(event, payload) {
        const hooks = all(db, "SELECT * FROM integrations WHERE kind = 'webhook' AND enabled = 1");
        for (const h of hooks) {
            const c = decode(h);
            if (c.events && c.events.length && !c.events.includes(event)) continue;
            run(db, 'INSERT INTO webhook_deliveries (integration_id, event, payload, next_at) VALUES (?,?,?,?)', h.id, event, JSON.stringify({ event, at: new Date().toISOString(), data: payload }), Date.now());
        }
    }
    let delivering = false;
    async function deliverWebhooks() {
        if (delivering) return;
        delivering = true;
        try {
            const due = all(db, "SELECT d.*, i.config_enc FROM webhook_deliveries d JOIN integrations i ON i.id = d.integration_id WHERE d.status = 'pending' AND d.next_at <= ? ORDER BY d.id LIMIT 20", Date.now());
            for (const d of due) {
                const c = decode(d);
                const sig = crypto.createHmac('sha256', c.secret || '').update(d.payload).digest('hex');
                let status = 0;
                try {
                    const r = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tanzeem-Event': d.event, 'X-Tanzeem-Signature': `sha256=${sig}`, 'X-Tanzeem-Delivery': String(d.id) }, body: d.payload, signal: AbortSignal.timeout(10000) });
                    status = r.status;
                } catch { status = 0; }
                const ok = status >= 200 && status < 300;
                const attempts = d.attempts + 1;
                const backoff = [60, 300, 1800, 7200][attempts - 1];
                run(db, 'UPDATE webhook_deliveries SET status = ?, attempts = ?, next_at = ?, last_status = ? WHERE id = ?', ok ? 'delivered' : backoff ? 'pending' : 'failed', attempts, Date.now() + (backoff || 0) * 1000, status, d.id);
                if (!ok && !backoff) logIt(d.integration_id, false, 'deliver', `${d.event} failed after ${attempts} attempts (HTTP ${status})`);
                else if (ok) run(db, "UPDATE integrations SET status = 'ok', last_sync = datetime('now') WHERE id = ?", d.integration_id);
            }
        } finally { delivering = false; }
    }

    /* ───────── التقويم: موجز ICS يُشترك به من Exchange/Outlook أو Google ───────── */
    function ics(events) {
        const esc = (s) => String(s || '').replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
        const dt = (s) => new Date(s).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const host = new URL(app.cfg.publicUrl).host;
        const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tanzeem//Events//AR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Tanzeem'];
        for (const e of events) {
            lines.push('BEGIN:VEVENT', `UID:${e.uid}@${host}`, `DTSTAMP:${dt(new Date())}`, `DTSTART:${dt(e.start)}`, `DTEND:${dt(e.end)}`, `SUMMARY:${esc(e.title)}`, `LOCATION:${esc(e.location)}`, `DESCRIPTION:${esc(e.description)}`, 'END:VEVENT');
        }
        lines.push('END:VCALENDAR');
        return lines.join('\r\n');
    }

    /* ───────── الذكاء الاصطناعي (اختياري، مزوّد متوافق مع OpenAI داخل الشبكة) ───────── */
    async function aiComplete(prompt, { max = 400 } = {}) {
        const c = config('ai');
        if (!c || c.provider !== 'openai_compatible' || !c.base_url) return null;
        try {
            const r = await fetch(`${c.base_url.replace(/\/$/, '')}/chat/completions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...(c.api_key ? { Authorization: `Bearer ${c.api_key}` } : {}) },
                body: JSON.stringify({ model: c.model, max_tokens: max, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(30000),
            });
            const j = await r.json();
            logIt(c.__id, r.ok, 'complete', r.ok ? 'ok' : j.error?.message || r.status);
            return j.choices?.[0]?.message?.content || null;
        } catch (e) { logIt(c.__id, false, 'complete', e.message); return null; }
    }

    /* ───────── اختبار الاتصال ───────── */
    async function test(id, body = {}) {
        const row = one(db, 'SELECT * FROM integrations WHERE id = ?', id);
        if (!row) fail(404, 'not_found');
        const c = { ...decode(row), __id: row.id };
        try {
            let message = 'ok';
            if (row.kind === 'smtp') {
                const t = nodemailer.createTransport({ host: c.host, port: Number(c.port || 587), secure: Number(c.port) === 465, auth: c.user ? { user: c.user, pass: c.password } : undefined, connectionTimeout: 10000 });
                await t.verify();
                if (body.to) await t.sendMail({ from: c.from || c.user, to: body.to, subject: 'Tanzeem test', text: 'SMTP OK' });
                message = 'SMTP verified';
            } else if (row.kind === 'sms') {
                if (c.provider === 'log') message = 'log mode';
                else if (body.to) { await sendSms({ to: body.to, message: 'Tanzeem test' }); message = 'sent'; } else { const u = new URL(c.url.replaceAll('{to}', '0').replaceAll('{message}', 't').replaceAll('{sender}', '')); message = `endpoint ${u.host}`; }
            } else if (row.kind === 'ldap') {
                const client = await ldapClient(c);
                await client.bind(c.bind_dn, c.bind_password);
                await client.unbind();
                message = 'bind ok';
            } else if (row.kind === 'oidc') {
                discoCache.delete(c.issuer);
                const d = await oidcDiscovery(c);
                message = `issuer ${d.issuer}`;
            } else if (row.kind === 'webhook') {
                const payload = JSON.stringify({ event: 'ping', at: new Date().toISOString() });
                const r = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tanzeem-Event': 'ping', 'X-Tanzeem-Signature': 'sha256=' + crypto.createHmac('sha256', c.secret || '').update(payload).digest('hex') }, body: payload, signal: AbortSignal.timeout(10000) });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                message = `HTTP ${r.status}`;
            } else if (row.kind === 'calendar') {
                message = `${app.cfg.publicUrl}/api/public/calendar/${c.feed_token}.ics`;
            } else if (row.kind === 'ai') {
                if (c.provider !== 'openai_compatible') message = 'builtin';
                else { const r = await aiComplete('Reply with OK', { max: 5 }); if (!r) throw new Error('no response'); message = 'model replied'; }
            }
            logIt(row.id, true, 'test', message);
            return { ok: true, message };
        } catch (e) {
            logIt(row.id, false, 'test', e.message);
            return { ok: false, message: e.message };
        }
    }

    return { config, decode, masked, sendMail, sendSms, ldapAuthenticate, ldapSearch, provisionUser, oidcDiscovery, oidcExchange, emit, deliverWebhooks, ics, aiComplete, test };
}

const maskEmail = (e) => String(e || '').replace(/^(.{2}).*(@.*)$/, '$1•••$2');

/** المسارات: إدارة التكاملات ومفاتيح API وموجز التقويم. */
export function registerIntegrations(r, app) {
    const { db } = app;
    const view = (row) => ({ ...row, config_enc: undefined, config: app.integrations.masked(app.integrations.decode(row)) });

    r.get('/api/v1/integrations', { tag: 'integrations', summary: 'قائمة التكاملات' }, (ctx) => {
        app.auth.need(ctx, 'integrations', 'view');
        return { rows: all(db, 'SELECT * FROM integrations ORDER BY kind, id').map(view), kinds: INTEGRATION_KINDS, webhook_events: WEBHOOK_EVENTS };
    });
    const save = async (ctx, id) => {
        const body = await readJson(ctx.req);
        const before = id ? one(db, 'SELECT * FROM integrations WHERE id = ?', id) : null;
        if (id && !before) fail(404, 'not_found');
        app.auth.need(ctx, 'integrations', id ? 'update' : 'create');
        const kind = before?.kind || body.kind;
        if (!INTEGRATION_KINDS.includes(kind)) fail(422, 'invalid', { errors: [{ field: 'kind', code: 'option' }] });
        const old = before ? app.integrations.decode(before) : {};
        const cfg = { ...old };
        for (const [k, v] of Object.entries(body.config || {})) {
            if (SECRET_KEYS.includes(k) && v === '••••••') continue; // لم يتغير
            cfg[k] = v;
        }
        if (kind === 'calendar' && !cfg.feed_token) cfg.feed_token = randomToken(18);
        if (kind === 'webhook' && !cfg.secret) cfg.secret = randomToken(24);
        if (kind === 'webhook' && cfg.url && !/^https?:\/\//.test(cfg.url)) fail(422, 'invalid', { errors: [{ field: 'url', code: 'url' }] });
        const name = String(body.name || before?.name || kind).slice(0, 100);
        const enabled = body.enabled === undefined ? (before?.enabled ?? 1) : body.enabled ? 1 : 0;
        let newId = id;
        if (id) run(db, "UPDATE integrations SET name = ?, config_enc = ?, enabled = ?, status = CASE WHEN ? = 0 THEN 'disabled' ELSE status END WHERE id = ?", name, app.encrypt(JSON.stringify(cfg)), enabled, enabled, id);
        else newId = Number(run(db, 'INSERT INTO integrations (kind, name, config_enc, enabled) VALUES (?,?,?,?)', kind, name, app.encrypt(JSON.stringify(cfg)), enabled).lastInsertRowid);
        app.audit.record(app.auth.actorOf(ctx), `integrations.${id ? 'update' : 'create'}`, 'integrations', newId, before ? { name: before.name, enabled: before.enabled } : null, { kind, name, enabled, config: app.integrations.masked(cfg) });
        return view(one(db, 'SELECT * FROM integrations WHERE id = ?', newId));
    };
    r.post('/api/v1/integrations', { tag: 'integrations', summary: 'إضافة تكامل' }, (ctx) => save(ctx, null));
    r.put('/api/v1/integrations/:id', { tag: 'integrations', summary: 'تعديل تكامل' }, (ctx) => save(ctx, Number(ctx.params.id)));
    r.del('/api/v1/integrations/:id', { tag: 'integrations' }, (ctx) => {
        app.auth.need(ctx, 'integrations', 'delete');
        const before = one(db, 'SELECT id, kind, name FROM integrations WHERE id = ?', Number(ctx.params.id));
        if (!before) fail(404, 'not_found');
        run(db, 'DELETE FROM integrations WHERE id = ?', before.id);
        app.audit.record(app.auth.actorOf(ctx), 'integrations.delete', 'integrations', before.id, before, null);
        return { ok: true };
    });
    r.post('/api/v1/integrations/:id/test', { tag: 'integrations', summary: 'اختبار الاتصال' }, async (ctx) => {
        app.auth.need(ctx, 'integrations', 'update');
        const body = await readJson(ctx.req);
        const res = await app.integrations.test(Number(ctx.params.id), body);
        app.audit.record(app.auth.actorOf(ctx), 'integrations.test', 'integrations', ctx.params.id, null, res);
        return res;
    });
    r.get('/api/v1/integrations/:id/logs', { tag: 'integrations', summary: 'سجل الأخطاء والعمليات' }, (ctx) => {
        app.auth.need(ctx, 'integrations', 'view');
        return { rows: all(db, 'SELECT * FROM integration_logs WHERE integration_id = ? ORDER BY id DESC LIMIT 100', Number(ctx.params.id)),
            deliveries: all(db, 'SELECT id, event, status, attempts, last_status, created_at FROM webhook_deliveries WHERE integration_id = ? ORDER BY id DESC LIMIT 50', Number(ctx.params.id)) };
    });
    r.get('/api/v1/directory/search', { tag: 'integrations', summary: 'بحث في Active Directory' }, async (ctx) => {
        app.auth.need(ctx, 'visitors', 'create');
        return { rows: await app.integrations.ldapSearch(String(ctx.query.q || '').slice(0, 60)) };
    });

    /* مفاتيح API */
    r.get('/api/v1/api-keys', { tag: 'integrations' }, (ctx) => {
        app.auth.need(ctx, 'integrations', 'view');
        return { rows: all(db, 'SELECT k.id, k.name, k.prefix, k.role_id, r.key role, k.last_used, k.revoked, k.created_at FROM api_keys k LEFT JOIN roles r ON r.id = k.role_id ORDER BY k.id DESC') };
    });
    r.post('/api/v1/api-keys', { tag: 'integrations', summary: 'إنشاء مفتاح API (يظهر مرة واحدة)' }, async (ctx) => {
        app.auth.need(ctx, 'integrations', 'create');
        const body = await readJson(ctx.req);
        const role = one(db, 'SELECT id FROM roles WHERE id = ?', Number(body.role_id));
        if (!role || !body.name) fail(422, 'invalid', { errors: [{ field: !role ? 'role_id' : 'name', code: 'required' }] });
        const key = `tzk_${randomToken(30)}`;
        const id = Number(run(db, 'INSERT INTO api_keys (name, prefix, key_hash, role_id, created_by) VALUES (?,?,?,?,?)', String(body.name).slice(0, 80), key.slice(0, 10), sha256(key), role.id, ctx.actor.userId).lastInsertRowid);
        app.audit.record(app.auth.actorOf(ctx), 'api_keys.create', 'api_keys', id, null, { name: body.name, role_id: role.id });
        return { id, key };
    });
    r.del('/api/v1/api-keys/:id', { tag: 'integrations', summary: 'إلغاء مفتاح API' }, (ctx) => {
        app.auth.need(ctx, 'integrations', 'delete');
        run(db, 'UPDATE api_keys SET revoked = 1 WHERE id = ?', Number(ctx.params.id));
        app.audit.record(app.auth.actorOf(ctx), 'api_keys.revoke', 'api_keys', ctx.params.id);
        return { ok: true };
    });

    /* موجز التقويم العام (برمز سري في الرابط، لا بيانات شخصية) */
    r.get('/api/public/calendar/:file', { public: true }, (ctx) => {
        const token = String(ctx.params.file).replace(/\.ics$/, '');
        const rows = all(db, "SELECT * FROM integrations WHERE kind = 'calendar' AND enabled = 1");
        const ok = rows.some((row) => app.integrations.decode(row).feed_token === token);
        if (!ok) fail(404, 'not_found');
        const evs = all(db, "SELECT id, title_ar, title_en, starts_at, ends_at, location FROM events WHERE status IN ('published','running') AND archived = 0");
        const visits = all(db, "SELECT id, title, starts_at, ends_at, location FROM visits WHERE status IN ('approved','permit_issued')");
        const body = app.integrations.ics([
            ...evs.map((e) => ({ uid: `event-${e.id}`, start: e.starts_at, end: e.ends_at, title: e.title_ar, location: e.location, description: e.title_en })),
            ...visits.map((v) => ({ uid: `visit-${v.id}`, start: v.starts_at, end: v.ends_at, title: v.title, location: v.location, description: '' })),
        ]);
        send(ctx.res, 200, body, { 'Content-Type': 'text/calendar; charset=utf-8' });
    });
}
