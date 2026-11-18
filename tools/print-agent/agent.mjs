#!/usr/bin/env node
// تنظيم — Print Agent: خدمة خفيفة على جهاز الاستقبال أو الكشك. تتصل بالخادم عبر WebSocket وتستقبل أوامر الطباعة
// وتطبعها على طابعة البطاقات: Zebra عبر الشبكة (ZPL على المنفذ 9100) أو طابعة النظام (lp/lpr) أو ملف للاختبار.
//
// التشغيل لأول مرة (ربط):  node agent.mjs --server https://tanzeem.example.sa --code 123456 --printer tcp://192.168.1.50:9100
// بعدها يكفي:               node agent.mjs            (الإعدادات في ~/.tanzeem-agent.json)
// أنواع الطابعة: tcp://IP:9100 (ZPL)  |  lp:اسم_الطابعة (ZPL خام)  |  file:/tmp/badges (يحفظ ZPL و SVG للتجربة)
// لا يحتاج إلا Node 22+ (WebSocket مدمج).
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

const VERSION = '1.0.0';
const CONF = path.join(os.homedir(), '.tanzeem-agent.json');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []));
let conf = fs.existsSync(CONF) ? JSON.parse(fs.readFileSync(CONF, 'utf8')) : {};
if (args.server) conf.server = String(args.server).replace(/\/$/, '');
if (args.printer) conf.printer = String(args.printer);
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function pair() {
    if (!conf.server) throw new Error('--server مطلوب');
    const r = await fetch(`${conf.server}/api/device/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: String(args.code), version: `agent-${VERSION}` }) });
    const j = await r.json();
    if (!r.ok) throw new Error(`فشل الربط: ${j.error}`);
    conf.token = j.token;
    fs.writeFileSync(CONF, JSON.stringify(conf, null, 2), { mode: 0o600 });
    log(`✔ تم الربط: ${j.device.name}`);
}

function printZpl(zpl, job) {
    const target = conf.printer || 'file:' + path.join(os.tmpdir(), 'tanzeem-badges');
    return new Promise((resolve, reject) => {
        if (target.startsWith('tcp://')) {
            const [host, port] = target.slice(6).split(':');
            const s = net.createConnection({ host, port: Number(port || 9100), timeout: 8000 }, () => s.end(zpl, 'utf8'));
            s.on('close', (hadErr) => (hadErr ? null : resolve()));
            s.on('timeout', () => { s.destroy(); reject(new Error('printer timeout')); });
            s.on('error', reject);
        } else if (target.startsWith('lp:')) {
            const p = spawn(process.platform === 'win32' ? 'print' : 'lp', ['-d', target.slice(3), '-o', 'raw']);
            p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`lp exit ${c}`))));
            p.on('error', reject);
            p.stdin.end(zpl);
        } else {
            const dir = target.slice(5);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `job-${job.job_id}.zpl`), zpl);
            if (job.svg) fs.writeFileSync(path.join(dir, `job-${job.job_id}.svg`), job.svg);
            resolve();
        }
    });
}

/** حالة الورق لطابعات Zebra عبر ~HS (سطر الحالة الأول: الحقل 2 = نفاد الورق). */
function paperStatus() {
    if (!conf.printer?.startsWith('tcp://')) return Promise.resolve({});
    const [host, port] = conf.printer.slice(6).split(':');
    return new Promise((resolve) => {
        let buf = '';
        const s = net.createConnection({ host, port: Number(port || 9100), timeout: 4000 }, () => s.write('~HS'));
        s.on('data', (d) => { buf += d; if (buf.split('\x03').length > 3) s.end(); });
        s.on('close', () => { const f = buf.split('\x02')[1]?.split(','); resolve(f ? { paper_low: f[1] === '1' } : { error: 'printer not responding' }); });
        s.on('timeout', () => { s.destroy(); resolve({ error: 'printer timeout' }); });
        s.on('error', (e) => resolve({ error: e.message }));
    });
}

function connect() {
    const url = `${conf.server.replace(/^http/, 'ws')}/ws?device=${encodeURIComponent(conf.token)}`;
    const ws = new WebSocket(url);
    let beat = null;
    ws.onopen = async () => {
        log('متصل بالخادم');
        const send = async () => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'heartbeat', version: `agent-${VERSION}`, ...(await paperStatus()) }));
        send();
        beat = setInterval(send, 30_000);
    };
    ws.onmessage = async (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'print') {
            const job = m.data;
            try { await printZpl(job.zpl, job); ws.send(JSON.stringify({ type: 'print_result', job_id: job.job_id, ok: true })); log(`✔ طُبع الأمر #${job.job_id}`); }
            catch (err) { ws.send(JSON.stringify({ type: 'print_result', job_id: job.job_id, ok: false, error: err.message })); log(`✗ الأمر #${job.job_id}: ${err.message}`); }
        } else if (m.type === 'command') {
            log('أمر:', m.data.cmd);
            if (m.data.cmd === 'unpair') { delete conf.token; fs.writeFileSync(CONF, JSON.stringify(conf, null, 2)); process.exit(0); }
            if (['restart', 'update', 'reload'].includes(m.data.cmd)) process.exit(3); // مدير الخدمة (systemd/NSSM) يعيد التشغيل
        }
    };
    ws.onclose = () => { clearInterval(beat); log('انقطع الاتصال — إعادة المحاولة بعد 5 ثوانٍ'); setTimeout(connect, 5000); };
    ws.onerror = () => {};
}

(async () => {
    if (args.code) await pair();
    if (!conf.token) { console.error('الجهاز غير مربوط: شغّل مع --server و --code'); process.exit(1); }
    fs.writeFileSync(CONF, JSON.stringify(conf, null, 2), { mode: 0o600 });
    log(`Tanzeem Print Agent ${VERSION} → ${conf.server} (${conf.printer || 'file'})`);
    connect();
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
