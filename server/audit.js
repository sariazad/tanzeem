// تنظيم — سجل التدقيق: كل عملية تُضاف بسلسلة تجزئة (كل سطر يحمل تجزئة السطر قبله) فيُكشف أي عبث.
import crypto from 'node:crypto';
import { one, all } from './db.js';

const REDACT = new Set(['pass_hash', 'mfa_secret', 'national_id_enc', 'national_id_hash', 'token_hash', 'key_hash', 'config_enc', 'nonce', 'token', 'photo', 'map_bg', 'password', 'national_id']);

export function redact(obj) {
    if (!obj || typeof obj !== 'object') return obj ?? null;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (REDACT.has(k)) out[k] = v ? '•••' : v;
        else out[k] = v;
    }
    return out;
}

export function makeAudit(db) {
    const last = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
    const ins = db.prepare('INSERT INTO audit_log (at, user_id, actor, action, entity, entity_id, before, after, ip, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    function record(actor, action, entity = null, entityId = null, before = null, after = null) {
        const at = new Date().toISOString();
        const prev = last.get()?.hash || '';
        const b = before ? JSON.stringify(redact(before)) : null;
        const a = after ? JSON.stringify(redact(after)) : null;
        const userId = actor?.userId ?? null;
        const name = actor?.name ?? 'system';
        const ip = actor?.ip ?? null;
        const hash = crypto.createHash('sha256').update([prev, at, userId, name, action, entity, entityId, b, a, ip].join('|')).digest('hex');
        ins.run(at, userId, name, action, entity, entityId == null ? null : String(entityId), b, a, ip, prev, hash);
    }
    /** يتحقق من سلامة السلسلة كاملة. */
    function verify() {
        let prev = '';
        let n = 0;
        for (const r of db.prepare('SELECT * FROM audit_log ORDER BY id').iterate()) {
            const h = crypto.createHash('sha256').update([prev, r.at, r.user_id, r.actor, r.action, r.entity, r.entity_id, r.before, r.after, r.ip].join('|')).digest('hex');
            if (r.prev_hash !== prev || r.hash !== h) return { ok: false, brokenAt: r.id, checked: n };
            prev = r.hash;
            n++;
        }
        return { ok: true, checked: n };
    }
    return { record, verify, count: () => one(db, 'SELECT COUNT(*) n FROM audit_log').n, recent: (n = 20) => all(db, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', n) };
}
