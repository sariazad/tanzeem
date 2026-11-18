// تنظيم — موجّه HTTP صغير بلا اعتماديات: مسارات بمعاملات، قراءة JSON، أخطاء موحّدة.

export class HttpError extends Error {
    constructor(status, code, extra = {}) {
        super(code);
        this.status = status;
        this.code = code;
        Object.assign(this, extra);
    }
}
export const fail = (status, code, extra) => { throw new HttpError(status, code, extra); };

export class Router {
    constructor() { this.routes = []; }
    add(method, pattern, opts, handler) {
        if (typeof opts === 'function') { handler = opts; opts = {}; }
        const keys = [];
        const rx = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
        this.routes.push({ method, rx, keys, handler, opts, pattern });
        return this;
    }
    get(p, o, h) { return this.add('GET', p, o, h); }
    post(p, o, h) { return this.add('POST', p, o, h); }
    put(p, o, h) { return this.add('PUT', p, o, h); }
    patch(p, o, h) { return this.add('PATCH', p, o, h); }
    del(p, o, h) { return this.add('DELETE', p, o, h); }
    match(method, path) {
        let allowed = false;
        for (const r of this.routes) {
            const m = path.match(r.rx);
            if (!m) continue;
            if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) { allowed = true; continue; }
            const params = {};
            r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
            return { route: r, params };
        }
        return allowed ? { notAllowed: true } : null;
    }
}

export function readBody(req, limit = 2_000_000) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { reject(new HttpError(413, 'too_big')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

export async function readJson(req, limit) {
    const buf = await readBody(req, limit);
    if (!buf.length) return {};
    try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'bad_json'); }
}

export const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; font-src 'self' data:; frame-ancestors 'self'; form-action 'self'; base-uri 'none'; object-src 'none'",
};

export function send(res, status, body, headers = {}) {
    if (res.headersSent) return;
    const isBuf = Buffer.isBuffer(body);
    const isJson = !isBuf && typeof body !== 'string';
    res.writeHead(status, {
        'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        ...SECURITY_HEADERS,
        ...headers,
    });
    res.end(isJson ? JSON.stringify(body) : body);
}

/** مُحدِّد معدّل بسيط بنافذة ثابتة لكل مفتاح. */
export function rateLimiter() {
    const hits = new Map();
    return (key, max, perMs) => {
        const now = Date.now();
        let h = hits.get(key);
        if (!h || now > h.reset) { h = { n: 0, reset: now + perMs }; hits.set(key, h); }
        h.n++;
        if (hits.size > 20000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
        return h.n > max;
    };
}

export function cookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

export function csvEscape(v) {
    if (v == null) return '';
    let s = String(v);
    // منع حقن الصيغ في Excel
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (cols, rows) => '﻿' + [cols.map((c) => csvEscape(c.label)).join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c.key])).join(','))].join('\r\n');
