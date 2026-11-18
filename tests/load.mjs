// تنظيم — اختبار تحمّل ذروة الدخول: مسح رموز QR متزامن (الهدف: 1000 تحقق/دقيقة وزمن p95 أقل من 500ms).
// محلياً: node tests/load.mjs   |   على خادم: BASE=https://… TOKEN_FILE=tokens.txt DEVICE=tzd_… node tests/load.mjs
import { startServer, login } from './helpers.js';

const N = Number(process.env.SCANS || 1200);
const CONC = Number(process.env.CONCURRENCY || 25);
let base = process.env.BASE, close = () => {}, headers = {}, tokens = [];
if (!base) {
    const S = await startServer();
    base = S.base;
    close = S.close;
    const admin = await login(base, 'superadmin@tanzeem.demo');
    headers = { cookie: admin.cookie, 'x-requested-with': 'tanzeem', 'content-type': 'application/json' };
    // فعالية ذروة: N زائر مؤكد
    const now = Date.now();
    const ev = await admin.post('/api/v1/events', { title_ar: 'اختبار ذروة', type: 'guests', starts_at: new Date(now - 3600e3).toISOString(), ends_at: new Date(now + 3600e3).toISOString(), capacity: 0 });
    await admin.post(`/api/v1/events/${ev.data.id}/status`, { status: 'published' });
    const rows = Array.from({ length: N }, (_, i) => ({ name_ar: `زائر ${i}`, phone: `+9665${String(10000000 + i).slice(-8)}` }));
    await admin.post(`/api/v1/events/${ev.data.id}/invitations`, { rows, channel: 'none', send: true });
    for (const c of S.db.prepare("SELECT id, nonce FROM credentials WHERE subject_type = 'event' AND subject_id = ?").all(ev.data.id)) tokens.push(S.app.attendance.tokenFor(c));
} else {
    tokens = (await import('node:fs')).readFileSync(process.env.TOKEN_FILE, 'utf8').split(/\s+/).filter(Boolean);
    headers = { 'x-device-token': process.env.DEVICE, 'content-type': 'application/json' };
}
const times = [];
let ok = 0, fail = 0, i = 0;
const t0 = Date.now();
async function worker() {
    while (i < tokens.length) {
        const token = tokens[i++];
        const s = performance.now();
        const r = await fetch(`${base}/api/v1/attendance/scan`, { method: 'POST', headers, body: JSON.stringify({ token }) });
        const j = await r.json();
        times.push(performance.now() - s);
        j.ok ? ok++ : fail++;
    }
}
await Promise.all(Array.from({ length: CONC }, worker));
const dur = (Date.now() - t0) / 1000;
times.sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(1);
const perMin = Math.round((times.length / dur) * 60);
console.log(JSON.stringify({ scans: times.length, ok, fail, seconds: dur, per_minute: perMin, p50_ms: pct(0.5), p95_ms: pct(0.95), p99_ms: pct(0.99) }));
close();
if (pct(0.95) > 500 || perMin < 1000 || fail) { console.error('✗ الهدف لم يتحقق'); process.exit(1); }
console.log('✔ ≥1000 تحقق/دقيقة و p95 < 500ms');
