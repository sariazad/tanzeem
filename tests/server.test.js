// تنظيم — اختبارات تكامل الـ API على خادم حقيقي: الرحلة الكاملة لمعايير القبول + الأمن والصلاحيات + سجل التدقيق.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { startServer, client, login, PASS, one, run, totp } from './helpers.js';

let S, admin;
beforeAll(async () => { S = await startServer(); admin = await login(S.base, 'superadmin@tanzeem.demo'); });
afterAll(() => S.close());

describe('المصادقة والأمن', () => {
    it('يرفض الطلبات دون دخول', async () => {
        const r = await client(S.base).get('/api/v1/events');
        expect(r.status).toBe(401);
    });
    it('حماية CSRF: الطلبات المعدِّلة تتطلب الترويسة', async () => {
        const r = await admin.post('/api/v1/groups', { name: 'x' }, { 'x-requested-with': '' });
        expect(r.status).toBe(403);
        expect(r.data.error).toBe('csrf');
    });
    it('مدير النظام مُلزم بالتحقق الثنائي، والجلسة مقيّدة حتى التحقق', async () => {
        const c = client(S.base);
        const r = await c.post('/api/v1/auth/login', { login: 'superadmin@tanzeem.demo', password: PASS });
        expect(r.data.mfa).toBe('verify');
        expect((await c.get('/api/v1/events')).data.error).toBe('mfa_required');
        expect((await c.post('/api/v1/auth/mfa/verify', { code: '000001' })).status).toBe(401);
        expect((await c.post('/api/v1/auth/mfa/verify', { code: totp(admin.secret) })).status).toBe(200);
        expect((await c.get('/api/v1/events')).status).toBe(200);
    });
    it('قفل الحساب بعد 5 محاولات فاشلة', async () => {
        const c = client(S.base);
        for (let i = 0; i < 5; i++) await c.post('/api/v1/auth/login', { login: 'it@tanzeem.demo', password: 'wrong-password' });
        const r = await c.post('/api/v1/auth/login', { login: 'it@tanzeem.demo', password: PASS });
        expect(r.status).toBe(423);
        await admin.post(`/api/v1/users/${one(S.db, "SELECT id FROM users WHERE email = 'it@tanzeem.demo'").id}/unlock`);
        expect((await c.post('/api/v1/auth/login', { login: 'it@tanzeem.demo', password: PASS })).status).toBe(200);
    });
    it('ترويسات الأمان موجودة', async () => {
        const r = await client(S.base).get('/healthz');
        expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
        expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    });
    it('رقم الهوية مشفّر في القاعدة ولا يُعاد في القوائم', async () => {
        const v = one(S.db, 'SELECT * FROM visitors WHERE national_id_enc IS NOT NULL LIMIT 1');
        expect(v.national_id_enc.startsWith('v1.')).toBe(true);
        const list = await admin.get('/api/v1/visitors?size=5');
        expect(JSON.stringify(list.data)).not.toContain('national_id_enc');
    });
});

describe('الصلاحيات بالنطاق', () => {
    it('موظف الاستقبال لا يرى سجل التدقيق ولا يدير المستخدمين', async () => {
        const rec = await login(S.base, 'reception@tanzeem.demo');
        expect((await rec.get('/api/v1/audit')).status).toBe(403);
        expect((await rec.get('/api/v1/users')).status).toBe(403);
        expect((await rec.get('/api/v1/attendance/logs')).status).toBe(200);
    });
    it('إداري العمادة يرى فعاليات جهته فقط', async () => {
        const oa = await login(S.base, 'orgadmin@tanzeem.demo');
        const r = await oa.get('/api/v1/events?size=50');
        const orgId = one(S.db, "SELECT id FROM orgs WHERE code = 'DSA'").id;
        expect(r.data.rows.length).toBeGreaterThan(0);
        expect(r.data.rows.every((e) => e.org_id === orgId)).toBe(true);
        expect((await oa.get('/api/v1/events/1')).status).toBe(403);
    });
    it('منظم الفعالية يسجل الحضور لفعاليته فقط', async () => {
        const org = await login(S.base, 'organizer@tanzeem.demo');
        expect((await org.get('/api/v1/events/1/summary')).status).toBe(200);
        expect((await org.get('/api/v1/events/2/summary')).status).toBe(403);
    });
    it('فريق التقنية يرى خيارات الفعاليات لربط الأجهزة دون صلاحية عرض الفعاليات', async () => {
        const it_ = await login(S.base, 'it@tanzeem.demo');
        expect((await it_.get('/api/v1/events')).status).toBe(403);
        const r = await it_.get('/api/v1/options/events');
        expect(r.status).toBe(200);
        expect(r.data.rows.length).toBeGreaterThan(0);
        expect(Object.keys(r.data.rows[0])).toEqual(expect.arrayContaining(['id', 'title_ar', 'title_en', 'status']));
        expect(r.data.rows[0]).not.toHaveProperty('description_ar');
        expect((await it_.get('/api/v1/options/visitors')).status).toBe(403);
    });
    it('خيارات القوائم تحترم نطاق إداري الجهة', async () => {
        const oa = await login(S.base, 'orgadmin@tanzeem.demo');
        const orgId = one(S.db, "SELECT id FROM orgs WHERE code = 'DSA'").id;
        const ids = (await oa.get('/api/v1/options/events')).data.rows.map((e) => e.id);
        const own = one(S.db, 'SELECT COUNT(*) n FROM events WHERE org_id = ?', orgId).n;
        expect(ids.length).toBe(own);
    });
});

describe('الرحلة الكاملة (معايير القبول)', () => {
    let eventId, visitorId, invToken, qr, deviceToken;
    it('إنشاء فعالية ونشرها', async () => {
        const now = Date.now();
        const r = await admin.post('/api/v1/events', { title_ar: 'فعالية اختبار', title_en: 'Test event', type: 'guests', starts_at: new Date(now - 3600_000).toISOString(), ends_at: new Date(now + 5 * 3600_000).toISOString(), capacity: 50, venue_id: 1, org_id: 1 });
        expect(r.status).toBe(200);
        eventId = r.data.id;
        expect(r.data.status).toBe('draft');
        expect((await admin.post(`/api/v1/events/${eventId}/status`, { status: 'published' })).data.status).toBe('published');
    });
    it('تحقق من صحة البيانات (النهاية قبل البداية)', async () => {
        const r = await admin.post('/api/v1/events', { title_ar: 'خطأ', type: 'guests', starts_at: '2026-12-02T10:00:00Z', ends_at: '2026-12-01T10:00:00Z' });
        expect(r.status).toBe(422);
        expect(r.data.errors[0].field).toBe('ends_at');
    });
    it('دعوة (بالبريد — وضع السجل) ثم رابط الدعوة', async () => {
        const r = await admin.post(`/api/v1/events/${eventId}/invitations`, { rows: [{ name_ar: 'نورة المختبرة', phone: '0555000111', email: 'noura.test@example.com', org_name: 'جهة اختبار' }], channel: 'email', send: true });
        expect(r.data.created).toBe(1);
        expect(r.data.sent.ok).toBe(1);
        const list = await admin.get(`/api/v1/events/${eventId}/invitations`);
        expect(list.data.rows[0].status).toBe('sent');
        invToken = list.data.rows[0].link.split('/m/i/')[1];
        visitorId = list.data.rows[0].visitor_id;
    });
    it('المدعو يؤكد ويستلم QR لا يحمل بيانات شخصية', async () => {
        const pub = client(S.base);
        const before = await pub.get(`/api/public/inv/${invToken}`);
        expect(before.data.status).toBe('sent');
        expect((await pub.post(`/api/public/inv/${invToken}/respond`, { response: 'confirm' })).status).toBe(200);
        const after = await pub.get(`/api/public/inv/${invToken}`);
        expect(after.data.status).toBe('confirmed');
        qr = after.data.qr;
        expect(qr).toMatch(/^TZ1\./);
        expect(qr).not.toMatch(/noura|0555|نورة/);
    });
    it('ربط كشك والدخول منه مع الطباعة (معاينة SVG عند عدم وجود طابعة)', async () => {
        const d = await admin.post('/api/v1/devices', { name: 'كشك اختبار', kind: 'kiosk', event_id: eventId });
        expect(d.data.pair_code).toMatch(/^\d{6}$/);
        const kiosk = client(S.base);
        const p = await kiosk.post('/api/device/pair', { code: d.data.pair_code, version: 'test' });
        deviceToken = p.data.token;
        kiosk.setHeader('x-device-token', deviceToken);
        expect((await kiosk.get('/api/device/me')).data.event.id).toBe(eventId);
        // استماع لحظي للوحة قبل المسح
        const ws = new WebSocket(`${S.base.replace('http', 'ws')}/ws`, { headers: { cookie: admin.cookie } });
        const got = new Promise((res) => ws.on('message', (m) => { const x = JSON.parse(m); if (x.type === 'attendance') res(x.data); }));
        await new Promise((r) => ws.on('open', r));
        ws.send(JSON.stringify({ type: 'sub', channels: [`event:${eventId}`, 'dashboard'] }));
        await new Promise((r) => setTimeout(r, 100));
        const s = await kiosk.post('/api/v1/attendance/scan', { token: qr });
        expect(s.data.ok).toBe(true);
        expect(s.data.code).toBe('checked_in');
        expect(s.data.ms).toBeLessThan(500);
        const live = await got;
        expect(live.visitor.id).toBe(visitorId);
        expect(live.stats.inside).toBe(1);
        ws.close();
        const pr = await kiosk.post('/api/v1/print', { visitor_id: visitorId });
        expect(pr.data.via).toBe('browser');
        expect(pr.data.svg).toContain('<svg');
    });
    it('منع الدخول المزدوج', async () => {
        const kiosk = client(S.base);
        kiosk.setHeader('x-device-token', deviceToken);
        const s = await kiosk.post('/api/v1/attendance/scan', { token: qr });
        expect(s.data.ok).toBe(false);
        expect(s.data.code).toBe('already_inside');
    });
    it('رمز مزوّر يُرفض', async () => {
        const s = await admin.post('/api/v1/attendance/scan', { token: qr.slice(0, -2) + 'AA', subject_id: eventId });
        expect(s.data.code).toBe('invalid_qr');
    });
    it('الخريطة الحرارية والإشغال يظهران الحضور', async () => {
        const h = await admin.get(`/api/v1/events/${eventId}/heatmap`);
        expect(h.data.stats.inside).toBe(1);
        const dash = await admin.get('/api/v1/dashboard');
        expect(dash.data.recent[0].name_ar).toBe('نورة المختبرة');
    });
    it('الخروج من البوابة يحدّث الإشغال', async () => {
        const s = await admin.post('/api/v1/attendance/scan', { token: qr, direction: 'auto', gate: 'بوابة الخروج' });
        expect(s.data.code).toBe('checked_out');
        expect(s.data.stats.inside).toBe(0);
    });
    it('تقرير مُصدَّر (Excel و CSV)', async () => {
        const x = await admin.get(`/api/v1/reports/attendance/export?event_id=${eventId}&format=xlsx`);
        expect(x.status).toBe(200);
        expect(x.headers.get('content-type')).toContain('spreadsheetml');
        expect(x.data.subarray(0, 2).toString()).toBe('PK');
        const c = await admin.get(`/api/v1/reports/attendance/export?event_id=${eventId}&format=csv`);
        expect(c.data.toString('utf8')).toContain('نورة المختبرة');
    });
    it('كل عملية في سجل التدقيق والسلسلة سليمة وغير قابلة للحذف', async () => {
        const a = await admin.get('/api/v1/audit?size=200');
        const actions = a.data.rows.map((r) => r.action);
        for (const x of ['events.create', 'invitations.create', 'invitations.confirm', 'devices.paired', 'attendance.in', 'attendance.rejected', 'badges.print', 'attendance.out', 'reports.export']) expect(actions).toContain(x);
        expect((await admin.get('/api/v1/audit/verify')).data.ok).toBe(true);
        expect(() => run(S.db, 'DELETE FROM audit_log')).toThrow(/append-only/);
        expect(() => run(S.db, "UPDATE audit_log SET actor = 'x'")).toThrow(/append-only/);
    });
});

describe('الوحدات الأخرى', () => {
    it('الزائر المحظور يُرفض ويُنبَّه الأمن', async () => {
        const v = one(S.db, 'SELECT v.id FROM visitors v JOIN registrations r ON r.visitor_id = v.id WHERE r.event_id = 1 LIMIT 1');
        await admin.post(`/api/v1/visitors/${v.id}/block`, { blocked: true, reason: 'اختبار' });
        const s = await admin.post('/api/v1/attendance/scan', { visitor_id: v.id, subject_id: 1, direction: 'in' });
        expect(s.data.code).toBe('blocked');
        const n = await admin.get('/api/v1/notifications?type=blocked_visitor');
        expect(n.data.rows.length).toBeGreaterThan(0);
    });
    it('دورة الزيارة: طلب ← اعتماد ← تصريح ← دخول', async () => {
        const v = await admin.post('/api/v1/visits', { title: 'زيارة اختبار', org_id: 1, starts_at: new Date(Date.now() - 600_000).toISOString(), ends_at: new Date(Date.now() + 7200_000).toISOString() });
        expect(v.data.status).toBe('requested');
        await admin.post(`/api/v1/visits/${v.data.id}/visitors`, { create: [{ name_ar: 'ضيف الزيارة', phone: '0555999888' }] });
        expect((await admin.post(`/api/v1/visits/${v.data.id}/workflow/issue_permit`, {})).status).toBe(409);
        expect((await admin.post(`/api/v1/visits/${v.data.id}/workflow/approve`, {})).data.status).toBe('approved');
        expect((await admin.post(`/api/v1/visits/${v.data.id}/workflow/issue_permit`, { channel: 'none' })).data.status).toBe('permit_issued');
        const people = await admin.get(`/api/v1/visits/${v.data.id}/visitors`);
        const token = decodeURIComponent(people.data.rows[0].permit.split('/m/p/')[1]);
        const s = await admin.post('/api/v1/attendance/scan', { token, subject_type: 'visit', subject_id: v.data.id });
        expect(s.data.ok).toBe(true);
        expect((await admin.get(`/api/v1/visits/${v.data.id}`)).data.status).toBe('checked_in');
    });
    it('الحضور الجماعي مع استثناء', async () => {
        const g = one(S.db, "SELECT id FROM groups WHERE name LIKE 'وفد هيئة%'");
        const members = (await admin.get(`/api/v1/groups/${g.id}/members`)).data.rows;
        const r = await admin.post('/api/v1/attendance/bulk', { subject_id: 1, group_id: g.id, exclude: [members[0].id], direction: 'in' });
        expect(r.data.total).toBe(members.length - 1);
        expect(r.data.ok).toBeGreaterThan(0);
        expect(r.data.results.some((x) => x.visitor_id === members[0].id)).toBe(false);
    });
    it('العمليات دون اتصال تُزامن ويُكشف التعارض', async () => {
        const v = one(S.db, "SELECT c.id, c.nonce, c.visitor_id FROM credentials c LEFT JOIN presence p ON p.visitor_id = c.visitor_id AND p.subject_id = 1 AND p.subject_type = 'event' WHERE c.subject_type = 'event' AND c.subject_id = 1 AND c.revoked = 0 AND COALESCE(p.inside, 0) = 0 LIMIT 1");
        const token = S.app.attendance.tokenFor(v);
        const pack = await admin.get('/api/v1/attendance/offline-pack?subject_id=1');
        expect(pack.data.entries.length).toBeGreaterThan(10);
        expect(JSON.stringify(pack.data)).not.toMatch(/\+9665|national/);
        const r = await admin.post('/api/v1/attendance/sync', { items: [{ id: 1, token, subject_id: 1, direction: 'in', at: new Date().toISOString() }, { id: 2, token, subject_id: 1, direction: 'in', at: new Date().toISOString() }] });
        expect(r.data.results[0].ok).toBe(true);
        expect(r.data.results[1].code).toBe('already_inside');
    });
    it('الإعدادات: الهوية البصرية تُطبَّق وتظهر علناً', async () => {
        await admin.put('/api/v1/settings/branding', { primary: '#123456', name_ar: 'جهة تجريبية' });
        const b = await client(S.base).get('/api/public/branding');
        expect(b.data.primary).toBe('#123456');
        expect(b.data.name_ar).toBe('جهة تجريبية');
    });
    it('مفتاح API يعمل بصلاحيات دوره ويُلغى', async () => {
        const role = one(S.db, "SELECT id FROM roles WHERE key = 'reception'");
        const k = await admin.post('/api/v1/api-keys', { name: 'نظام خارجي', role_id: role.id });
        const ext = client(S.base);
        expect((await ext.get('/api/v1/events', { 'x-api-key': k.data.key })).status).toBe(200);
        expect((await ext.get('/api/v1/audit', { 'x-api-key': k.data.key })).status).toBe(403);
        await admin.del(`/api/v1/api-keys/${k.data.id}`);
        expect((await ext.get('/api/v1/events', { 'x-api-key': k.data.key })).status).toBe(401);
    });
    it('OpenAPI يغطي الموارد', async () => {
        const o = await client(S.base).get('/api/openapi.json');
        expect(o.data.openapi).toBe('3.1.0');
        expect(Object.keys(o.data.paths)).toContain('/api/v1/attendance/scan');
        expect(Object.keys(o.data.paths)).toContain('/api/v1/visitors/{id}');
    });
    it('كل التقارير السبعة تعمل', async () => {
        for (const r of ['attendance', 'timings', 'participation', 'performance', 'visits', 'visitors', 'devices']) expect((await admin.get(`/api/v1/reports/${r}`)).status).toBe(200);
    });
    it('النموذج الديناميكي: الحقل الشرطي الإلزامي', async () => {
        const ev = await admin.post('/api/v1/events', { title_ar: 'نموذج', type: 'guests', status: 'draft', starts_at: new Date(Date.now() - 1000).toISOString(), ends_at: new Date(Date.now() + 9e6).toISOString(), form_id: 1, open_registration: 1 });
        await admin.post(`/api/v1/events/${ev.data.id}/status`, { status: 'published' });
        const pub = client(S.base);
        const base = { name_ar: 'مسجل', phone: '0544000222', answers: { org: 'x', attend_type: 'media', consent: true } };
        const bad = await pub.post(`/api/public/events/${ev.data.id}/register`, base);
        expect(bad.status).toBe(422);
        expect(bad.data.errors.map((e) => e.field)).toContain('media_outlet');
        const ok = await pub.post(`/api/public/events/${ev.data.id}/register`, { ...base, answers: { ...base.answers, media_outlet: 'SPA' } });
        expect(ok.data.link).toMatch(/^\/m\/i\//);
    });
    it('تصميم صفحة الفعالية: حفظ مع التحقق، ظهوره في الصفحة العامة، وحصره بالصلاحيات', async () => {
        const ev = one(S.db, "SELECT id FROM events WHERE status IN ('published','running') AND open_registration = 1 LIMIT 1");
        const g = await admin.get(`/api/v1/events/${ev.id}/page`);
        expect(g.status).toBe(200);
        expect(g.data.design.layout).toBe('cover');
        const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const p = await admin.put(`/api/v1/events/${ev.id}/page`, { design: { layout: 'split', theme: { primary: '#123ABC', mode: 'dark', radius: 99 }, background: { kind: 'evil', image: 'javascript:alert(1)' }, hero: { cover: png, title_ar: 'عنوان' }, sections: [{ key: 'speakers', on: false }, { key: 'bogus' }], maps_url: 'javascript:x' } });
        expect(p.status).toBe(200);
        const d = p.data.design;
        expect(d.layout).toBe('split');
        expect(d.theme).toMatchObject({ primary: '#123abc', mode: 'dark', radius: 32 });
        expect(d.background.kind).toBe('gradient');
        expect(d.background.image).toBeNull();
        expect(d.hero.cover).toBe(png);
        expect(d.sections[0]).toEqual({ key: 'speakers', on: false });
        expect(d.sections.map((x) => x.key)).not.toContain('bogus');
        expect(d.sections).toHaveLength(7);
        expect(d.maps_url).toBe('');
        const pub = await client(S.base).get(`/api/public/events/${ev.id}/register`);
        expect(pub.data.design.layout).toBe('split');
        expect(pub.data.extras.seats).toHaveProperty('capacity');
        expect(Array.isArray(pub.data.extras.speakers)).toBe(true);
        const ev2 = await admin.get('/api/v1/events?size=5');
        expect(ev2.data.rows[0]).not.toHaveProperty('page');
        const rec = await login(S.base, 'reception@tanzeem.demo');
        expect((await rec.put(`/api/v1/events/${ev.id}/page`, { design: {} })).status).toBe(403);
        const draft = await admin.post('/api/v1/events', { title_ar: 'مسودة', type: 'guests', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 9e6).toISOString(), open_registration: 1 });
        expect((await client(S.base).get(`/api/public/events/${draft.data.id}/register`)).status).toBe(404);
        expect((await admin.get(`/api/v1/events/${draft.data.id}/page/preview`)).data.preview).toBe(true);
    });
    it('رسالة تأكيد التسجيل تصل بالبريد مع رمز QR ورابط البطاقة (تسجيل مفتوح وتأكيد دعوة)', async () => {
        const sent = [];
        const orig = S.app.integrations.sendMail;
        S.app.integrations.sendMail = async (m) => { sent.push(m); return { channel: 'smtp' }; };
        try {
            const ev = await admin.post('/api/v1/events', { title_ar: 'تأكيد بالبريد', title_en: 'Mail confirm', type: 'students', status: 'draft', starts_at: new Date(Date.now() + 864e5).toISOString(), ends_at: new Date(Date.now() + 9e7).toISOString(), open_registration: 1 });
            await admin.post(`/api/v1/events/${ev.data.id}/status`, { status: 'published' });
            const r = await client(S.base).post(`/api/public/events/${ev.data.id}/register`, { name_ar: 'طالب', name_en: 'Student', phone: '0544000999', email: 'student@example.com', lang: 'en' });
            expect(r.status).toBe(200);
            await expect.poll(() => sent.length).toBe(1);
            expect(sent[0].to).toBe('student@example.com');
            expect(sent[0].subject).toBe('Registration confirmed: Mail confirm');
            expect(sent[0].text).toContain(`http://localhost${r.data.link}`);
            expect(sent[0].attachments[0].cid).toBe('qr');
            // تأكيد دعوة من صفحة المدعو
            const inv = one(S.db, "SELECT i.token FROM invitations i JOIN visitors v ON v.id = i.visitor_id WHERE i.status IN ('sent','pending') AND v.email IS NOT NULL AND v.email != '' AND i.event_id IN (SELECT id FROM events WHERE status IN ('published','running') AND form_id IS NULL) LIMIT 1");
            expect(inv).toBeTruthy();
            {
                const c = await client(S.base).post(`/api/public/inv/${inv.token}/respond`, { response: 'confirm', answers: {} });
                expect(c.status).toBe(200);
                await expect.poll(() => sent.length).toBe(2);
                expect(sent[1].subject).toMatch(/^تم تأكيد تسجيلك: /);
            }
            // بلا بريد: لا رسالة ولا خطأ في التسجيل
            const n = await client(S.base).post(`/api/public/events/${ev.data.id}/register`, { name_ar: 'بلا بريد', phone: '0544000998' });
            expect(n.status).toBe(200);
            await new Promise((x) => setTimeout(x, 50));
            expect(sent.every((m) => m.to)).toBe(true);
        } finally { S.app.integrations.sendMail = orig; }
    });
});
