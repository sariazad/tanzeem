// تنظيم — الهوية: جلسات على الخادم (قابلة للإلغاء فوراً)، قفل بعد المحاولات الفاشلة، تحقق ثنائي TOTP،
// Active Directory عبر LDAP، والدخول الموحّد عبر OIDC (وSAML من خلال وسيط مثل Keycloak).
import crypto from 'node:crypto';
import { one, all, run } from './db.js';
import { fail, cookies, readJson } from './http.js';
import { sha256, randomToken, checkPassword, hashPassword, passwordProblems, checkTotp, newTotpSecret, decrypt } from './security.js';
import { can, scopeOf, flatten } from '../shared/permissions.js';

const COOKIE = 'tz_sid';
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

export function grantsOf(db, userId) {
    return all(db, `SELECT r.key role, r.permissions, ur.scope_type, ur.scope_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`, userId)
        .map((g) => ({ ...g, permissions: JSON.parse(g.permissions || '{}') }));
}

export function makeAuth(app) {
    const { db, cfg } = app;

    const cookieFor = (req, token, maxAge) => `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
    const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || cfg.publicUrl.startsWith('https');

    function createSession(ctx, user, mfaPending = 0) {
        const token = randomToken(32);
        const now = Date.now();
        run(db, 'INSERT INTO sessions (token_hash, user_id, ip, ua, mfa_pending, created_at, last_seen) VALUES (?,?,?,?,?,?,?)',
            sha256(token), user.id, ctx.ip, String(ctx.req.headers['user-agent'] || '').slice(0, 200), mfaPending, now, now);
        ctx.setCookie = cookieFor(ctx.req, token, cfg.sessionIdleMinutes * 60);
        return token;
    }

    const touch = db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?');
    function sessionFrom(req) {
        const token = cookies(req)[COOKIE];
        if (!token) return null;
        const s = one(db, 'SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0', sha256(token));
        if (!s) return null;
        const now = Date.now();
        if (now - s.last_seen > cfg.sessionIdleMinutes * 60_000) { run(db, 'UPDATE sessions SET revoked = 1 WHERE id = ?', s.id); return null; }
        if (now - s.last_seen > 60_000) touch.run(now, s.id);
        return s;
    }

    /** هوية الطلب: مفتاح API، أو رمز جهاز، أو جلسة مستخدم. */
    function resolve(ctx) {
        const req = ctx.req;
        const apiKey = req.headers['x-api-key'];
        if (apiKey) {
            const k = one(db, 'SELECT k.*, r.permissions, r.key role FROM api_keys k LEFT JOIN roles r ON r.id = k.role_id WHERE k.key_hash = ? AND k.revoked = 0', sha256(apiKey));
            if (!k) fail(401, 'bad_api_key');
            run(db, "UPDATE api_keys SET last_used = datetime('now') WHERE id = ?", k.id);
            const grants = [{ role: k.role, permissions: JSON.parse(k.permissions || '{}'), scope_type: 'all', scope_id: null }];
            return { kind: 'api', name: `api:${k.name}`, userId: null, grants, apiKeyId: k.id, ip: ctx.ip };
        }
        const devToken = req.headers['x-device-token'];
        if (devToken) {
            const d = one(db, 'SELECT * FROM devices WHERE token_hash = ?', sha256(devToken));
            if (!d) fail(401, 'bad_device');
            return { kind: 'device', name: `device:${d.name}`, userId: null, device: d, grants: deviceGrants(d), ip: ctx.ip };
        }
        const s = sessionFrom(req);
        if (!s) return null;
        const user = one(db, 'SELECT id, name, email, org_id, status, lang, mfa_enabled, must_change_password, source FROM users WHERE id = ?', s.user_id);
        if (!user || user.status !== 'active') return null;
        return { kind: 'user', name: user.name, userId: user.id, user, session: s, grants: grantsOf(db, user.id), ip: ctx.ip, mfaPending: s.mfa_pending };
    }

    /** الأجهزة: الكشك وأجهزة الاستقبال تسجّل الحضور وتطبع، فقط ضمن فعاليتها إن حُدّدت. */
    function deviceGrants(d) {
        const perms = { checkin: ['view', 'create'], visitors: ['view', 'create'], events: ['view'], badges: ['view'], forms: ['view'] };
        return [{ role: 'device', permissions: perms, scope_type: d.event_id ? 'event' : 'all', scope_id: d.event_id }];
    }

    /* ───────── الدخول المحلي و LDAP ───────── */
    async function login(ctx, { login: id, password, method = 'local' }) {
        const ident = String(id || '').trim();
        if (!ident || !password) fail(400, 'missing');
        let user = one(db, 'SELECT * FROM users WHERE email = ? OR username = ?', ident, ident);
        if (user?.locked_until && user.locked_until > Date.now()) {
            app.audit.record({ name: ident, ip: ctx.ip }, 'auth.login_locked', 'users', user.id);
            fail(423, 'locked', { until: user.locked_until });
        }
        let ok = false;
        if (method === 'ldap' || user?.source === 'ldap') {
            const r = await app.integrations.ldapAuthenticate(ident, password).catch(() => null);
            if (r) {
                ok = true;
                user = app.integrations.provisionUser({ ...r, source: 'ldap' });
            }
        } else if (user && user.source === 'local') {
            ok = checkPassword(password, user.pass_hash);
        }
        if (!ok) {
            if (user) {
                const fails = user.failed_attempts + 1;
                const lock = fails >= MAX_FAILS ? Date.now() + LOCK_MINUTES * 60_000 : null;
                run(db, 'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', lock ? 0 : fails, lock, user.id);
                if (lock) app.notify('account_locked', 'high', { user: user.email }, 'users', user.id);
            }
            app.audit.record({ name: ident, ip: ctx.ip }, 'auth.login_failed', 'users', user?.id ?? null);
            fail(401, 'bad_login');
        }
        if (user.status !== 'active') fail(403, 'disabled');
        run(db, "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = datetime('now') WHERE id = ?", user.id);
        const pending = user.mfa_enabled ? 1 : mfaRequired(user.id) ? 2 : 0;
        createSession(ctx, user, pending);
        app.audit.record({ userId: user.id, name: user.name, ip: ctx.ip }, 'auth.login', 'users', user.id);
        return { mfa: pending === 1 ? 'verify' : pending === 2 ? 'enroll' : null, mustChangePassword: !!user.must_change_password };
    }

    function mfaRequired(userId) {
        const roles = app.getSetting('security', {}).mfa_required_roles ?? ['super_admin'];
        return grantsOf(db, userId).some((g) => roles.includes(g.role));
    }

    function mfaVerify(ctx, code) {
        const a = ctx.actor;
        if (!a || a.kind !== 'user') fail(401, 'unauthenticated');
        const u = one(db, 'SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?', a.userId);
        const secret = u.mfa_secret ? decrypt(app.keys.enc, u.mfa_secret) : '';
        if (!secret || !checkTotp(secret, code)) {
            app.audit.record(actorOf(ctx), 'auth.mfa_failed', 'users', a.userId);
            fail(401, 'bad_code');
        }
        if (!u.mfa_enabled) run(db, 'UPDATE users SET mfa_enabled = 1 WHERE id = ?', a.userId);
        run(db, 'UPDATE sessions SET mfa_pending = 0 WHERE id = ?', a.session.id);
        app.audit.record(actorOf(ctx), u.mfa_enabled ? 'auth.mfa_ok' : 'auth.mfa_enabled', 'users', a.userId);
        return { ok: true };
    }

    function mfaSetup(ctx) {
        const a = ctx.actor;
        const secret = newTotpSecret();
        run(db, 'UPDATE users SET mfa_secret = ?, mfa_enabled = 0 WHERE id = ?', app.encrypt(secret), a.userId);
        const issuer = encodeURIComponent(app.getSetting('branding', {}).name_en || 'Tanzeem');
        return { secret, uri: `otpauth://totp/${issuer}:${encodeURIComponent(a.user.email)}?secret=${secret}&issuer=${issuer}&digits=6&period=30` };
    }

    function logout(ctx) {
        if (ctx.actor?.session) run(db, 'UPDATE sessions SET revoked = 1 WHERE id = ?', ctx.actor.session.id);
        ctx.setCookie = `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`;
        if (ctx.actor?.userId) app.audit.record(actorOf(ctx), 'auth.logout', 'users', ctx.actor.userId);
    }

    function changePassword(ctx, { current, next }) {
        const u = one(db, 'SELECT * FROM users WHERE id = ?', ctx.actor.userId);
        if (u.source !== 'local') fail(400, 'not_local');
        if (!checkPassword(current, u.pass_hash)) fail(401, 'bad_password');
        const problems = passwordProblems(next);
        if (problems.length) fail(422, 'weak_password', { problems });
        run(db, 'UPDATE users SET pass_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(next), u.id);
        run(db, 'UPDATE sessions SET revoked = 1 WHERE user_id = ? AND id != ?', u.id, ctx.actor.session.id);
        app.audit.record(actorOf(ctx), 'auth.password_changed', 'users', u.id);
    }

    function revokeUserSessions(userId) {
        run(db, 'UPDATE sessions SET revoked = 1 WHERE user_id = ?', userId);
        app.hub?.kickUser(userId);
    }

    /* ───────── OIDC (Authorization Code + PKCE) ───────── */
    const oidcStates = new Map();
    async function oidcStart(ctx) {
        const c = app.integrations.config('oidc');
        if (!c) fail(404, 'oidc_off');
        const disc = await app.integrations.oidcDiscovery(c);
        const state = randomToken(16), nonce = randomToken(16), verifier = randomToken(32);
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        oidcStates.set(state, { nonce, verifier, at: Date.now() });
        for (const [k, v] of oidcStates) if (Date.now() - v.at > 600_000) oidcStates.delete(k);
        const u = new URL(disc.authorization_endpoint);
        u.search = new URLSearchParams({
            response_type: 'code', client_id: c.client_id, redirect_uri: `${cfg.publicUrl}/auth/oidc/callback`,
            scope: c.scope || 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
        }).toString();
        return u.toString();
    }
    async function oidcCallback(ctx) {
        const { code, state } = ctx.query;
        const st = oidcStates.get(state);
        if (!st) fail(400, 'bad_state');
        oidcStates.delete(state);
        const c = app.integrations.config('oidc');
        const claims = await app.integrations.oidcExchange(c, code, st.verifier, st.nonce, `${cfg.publicUrl}/auth/oidc/callback`);
        const user = app.integrations.provisionUser({ email: claims.email, name: claims.name || claims.preferred_username || claims.email, username: claims.preferred_username, source: 'oidc', defaultRole: c.default_role });
        if (user.status !== 'active') fail(403, 'disabled');
        run(db, "UPDATE users SET last_login = datetime('now') WHERE id = ?", user.id);
        createSession(ctx, user, user.mfa_enabled ? 1 : 0);
        app.audit.record({ userId: user.id, name: user.name, ip: ctx.ip }, 'auth.login_sso', 'users', user.id);
    }

    function actorOf(ctx) {
        const a = ctx.actor;
        return a ? { userId: a.userId, name: a.name, ip: ctx.ip } : { name: 'anonymous', ip: ctx.ip };
    }

    function need(ctx, module, action, scope) {
        const a = ctx.actor;
        if (!a) fail(401, 'unauthenticated');
        if (!can(a.grants, module, action, scope || null)) fail(403, 'forbidden', { module, action });
    }

    return {
        resolve, login, logout, mfaVerify, mfaSetup, changePassword, revokeUserSessions, oidcStart, oidcCallback,
        actorOf, need, scope: (ctx, module, action) => scopeOf(ctx.actor?.grants, module, action),
        me(ctx) {
            const a = ctx.actor;
            return { id: a.userId, name: a.user.name, email: a.user.email, lang: a.user.lang, org_id: a.user.org_id, source: a.user.source,
                mfa_enabled: !!a.user.mfa_enabled, mfa: a.mfaPending === 1 ? 'verify' : a.mfaPending === 2 ? 'enroll' : null,
                must_change_password: !!a.user.must_change_password, roles: a.grants.map((g) => ({ role: g.role, scope_type: g.scope_type, scope_id: g.scope_id })),
                permissions: flatten(a.grants) };
        },
        readJson,
    };
}
