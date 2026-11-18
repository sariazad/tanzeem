// تنظيم — أدوات الاختبار: خادم حقيقي على منفذ عشوائي بقاعدة في الذاكرة، وعميل HTTP بالكوكيز.
import { createApp } from '../server/app.js';
import { seedDemo } from '../server/seed.js';
import { totp } from '../server/security.js';
import { one, run } from '../server/db.js';

export const PASS = 'Test-Pass-2026!x';

export async function startServer({ seed = true } = {}) {
    const inst = createApp({ dbFile: ':memory:', secret: 'test-secret-'.padEnd(64, 'x'), seedDemo: false, demoPassword: PASS, noScheduler: true, log: () => {}, publicUrl: 'http://localhost' });
    if (seed) seedDemo(inst.app, { password: PASS });
    await new Promise((r) => inst.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${inst.server.address().port}`;
    return { ...inst, base };
}

export function client(base) {
    let cookie = '';
    const headers = {};
    async function call(method, path, body, extra = {}) {
        const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'tanzeem', ...(cookie ? { cookie } : {}), ...headers, ...extra }, body: body !== undefined ? JSON.stringify(body) : undefined });
        const sc = res.headers.get('set-cookie');
        if (sc) cookie = sc.split(';')[0];
        const type = res.headers.get('content-type') || '';
        const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
        return { status: res.status, data, headers: res.headers };
    }
    return {
        get: (p, e) => call('GET', p, undefined, e), post: (p, b, e) => call('POST', p, b ?? {}, e), put: (p, b, e) => call('PUT', p, b ?? {}, e), del: (p, e) => call('DELETE', p, undefined, e),
        setHeader: (k, v) => { headers[k] = v; }, get cookie() { return cookie; }, set cookie(v) { cookie = v; },
    };
}

/** دخول كامل (مع تفعيل/تحقق TOTP عند الحاجة) */
export async function login(base, email, app) {
    const c = client(base);
    const r = await c.post('/api/v1/auth/login', { login: email, password: PASS });
    if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.data)}`);
    if (r.data.mfa === 'enroll') {
        const s = await c.post('/api/v1/auth/mfa/setup');
        await c.post('/api/v1/auth/mfa/verify', { code: totp(s.data.secret) });
        c.secret = s.data.secret;
    }
    return c;
}
export { one, run, totp };
