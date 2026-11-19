// تنظيم — التدفقات الحرجة في متصفح حقيقي: الدخول مع التحقق الثنائي، القائمة والترجمة، الاستقبال، الكشك مع الطباعة، وصفحة المشارك.
import { test, expect } from '@playwright/test';
import { totp } from '../../server/security.js';

import fs from 'node:fs';

const PASS = 'E2e-Pass-2026!';
const SECRET_FILE = '/tmp/tanzeem-e2e.secret'; // يبقى بين العمّال إذا أُعيد تشغيلهم

async function signIn(page, email = 'superadmin@tanzeem.demo') {
    await page.goto('/login');
    await page.fill('#u', email);
    await page.fill('#p', PASS);
    await page.click('button[type=submit]');
    if (email !== 'superadmin@tanzeem.demo') return page.waitForURL(/\/app/);
    await page.waitForURL(/mfa=/);
    if (page.url().includes('enroll')) fs.writeFileSync(SECRET_FILE, (await page.locator('.mono.small').textContent()).trim());
    await page.fill('input[inputmode=numeric]', totp(fs.readFileSync(SECRET_FILE, 'utf8')));
    await page.click('button[type=submit]');
    await page.waitForURL(/\/app/);
}
const api = (page, method, path, data) => page.request.fetch(path, { method, data, headers: { 'X-Requested-With': 'tanzeem' } }).then((r) => r.json());

test('الدخول بالتحقق الثنائي، القائمة بالترتيب، والتبديل للإنجليزية', async ({ page }) => {
    await signIn(page);
    await expect(page.locator('.kpi')).toHaveCount(6);
    const nav = await page.locator('.nav a span:first-of-type').allTextContents();
    expect(nav).toEqual(['لوحة التحكم', 'الفعاليات', 'الزيارات', 'الزوار', 'المجموعات', 'الحضور الجماعي', 'التقارير', 'الإشعارات', 'تسجيل الحضور', 'الكشك', 'تصميم البطاقات', 'الأجهزة', 'المستخدمين والأدوار', 'النماذج', 'سجل التدقيق', 'التكاملات']);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.click('.lang-btn');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('.nav a').first()).toContainText('Dashboard');
    await page.click('.lang-btn');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('الصفحات الـ16 والصفحات الفرعية الخمس تعمل دون أخطاء', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await signIn(page);
    for (const p of ['/app', '/app/events', '/app/visits', '/app/visitors', '/app/groups', '/app/bulk', '/app/reports', '/app/notifications', '/app/checkin', '/app/kiosk', '/app/badges', '/app/devices', '/app/users', '/app/forms', '/app/audit', '/app/integrations',
        '/app/events/1/invitations', '/app/events/1/schedule', '/app/events/1/live', '/app/events/1/map', '/app/events/1/networking', '/app/events/1/design']) {
        await page.goto(p);
        await expect(page.locator('#content .page-head, #content .kpis, #content .card').first()).toBeVisible();
        await expect(page.locator('#content .state[role=alert]')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
});

test('الاستقبال: بحث يدوي وتسجيل دخول مع ظهور النتيجة', async ({ page }) => {
    await signIn(page, 'reception@tanzeem.demo');
    await page.goto('/app/checkin');
    await page.locator('select.select').first().selectOption('1');
    const reg = await api(page, 'GET', '/api/v1/events/1/registrations');
    const target = reg.rows.find((r) => !r.inside && r.status === 'confirmed');
    await page.getByPlaceholder('الاسم أو الجوال أو رقم الهوية…').fill(target.name_ar.split(' ')[0] + ' ' + target.name_ar.split(' ')[1]);
    const row = page.locator('.list-item', { hasText: target.name_ar }).first();
    await row.locator('button.primary').click();
    await expect(page.locator('[aria-live=assertive]')).toContainText('تم تسجيل الدخول');
});

test('الكشك: ربط، تسجيل فوري، وطباعة البطاقة', async ({ page, browser }) => {
    await signIn(page);
    const dev = await api(page, 'POST', '/api/v1/devices', { name: 'كشك e2e', kind: 'kiosk', event_id: 1 });
    await api(page, 'PUT', `/api/v1/devices/${dev.id}/config`, { capture_photo: false });
    const kctx = await browser.newContext();
    const k = await kctx.newPage();
    await k.goto('/kiosk');
    for (const d of dev.pair_code) await k.click(`.k-key:text-is("${d}")`);
    await expect(k.locator('.k-langs .k-btn').first()).toBeVisible();
    await k.locator('.k-langs .k-btn').first().click();
    await k.locator('.k-choice').nth(1).click();
    const inputs = k.locator('.k-field input');
    await inputs.nth(0).fill('زائر الكشك');
    await inputs.nth(2).fill('0533000444');
    // حقول النموذج الإلزامية للفعالية (الجهة، طبيعة الحضور، الموافقة)
    await k.locator('.k-field', { hasText: 'الجهة' }).last().locator('input').fill('جهة اختبار');
    await k.locator('.k-field select').first().selectOption('person');
    await k.locator('.k-check input').last().check();
    await k.click('button[type=submit]');
    await expect(k.locator('.k-ok')).toBeVisible({ timeout: 15000 });
    await expect(k.locator('.k-badge svg')).toBeVisible();
    const jobs = await api(page, 'GET', `/api/v1/devices/${dev.id}/faults`);
    expect(jobs.jobs.length).toBe(1);
    expect(jobs.jobs[0].format).toBe('browser');
    await kctx.close();
});

test('المشارك: تأكيد الدعوة وعرض رمز QR', async ({ page, browser }) => {
    await signIn(page);
    const inv = await api(page, 'GET', '/api/v1/events/2/invitations?status=sent&size=1');
    const link = new URL(inv.rows[0].link).pathname;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const m = await ctx.newPage();
    await m.goto(link);
    await m.locator('.m-card .field').first().waitFor().catch(() => {});
    for (const f of await m.locator('.m-card .field').all()) {
        if (await f.locator('select').count()) await f.locator('select').selectOption({ index: 1 });
        else if (await f.locator('input[type=text], input:not([type])').count()) await f.locator('input').first().fill('412345678');
    }
    await m.click('button.btn.primary.lg');
    await m.locator('.m-tabs button').nth(1).click();
    await expect(m.locator('.m-pass svg[aria-label=QR]')).toBeVisible();
    await ctx.close();
});

test('القوائم المنسدلة المرتبطة تعرض خياراتها (فريق التقنية: جهاز جديد)', async ({ page }) => {
    await signIn(page, 'it@tanzeem.demo');
    await page.goto('/app/devices');
    await page.locator('#content .page-head .btn.primary').first().click();
    const selects = page.locator('[role=dialog] select.select');
    await expect.poll(async () => {
        for (let i = 0; i < await selects.count(); i++) if ((await selects.nth(i).locator('option').count()) > 1) return true;
        return false;
    }).toBe(true);
    // قائمة الفعاليات تحديداً: أكثر من الخيار الفارغ
    const counts = await selects.evaluateAll((els) => els.map((s) => s.options.length));
    expect(counts.filter((n) => n > 1).length).toBeGreaterThanOrEqual(2); // الفعالية والطابعة
});

test('مصمم الصفحة: قالب جاهز يُحفظ، ثم تسجيل زائر عبر الصفحة التفاعلية بخطوات', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await signIn(page, 'orgadmin@tanzeem.demo');
    const evs = await api(page, 'GET', '/api/v1/events?size=50');
    const ev = evs.rows.find((e) => e.open_registration && ['published', 'running'].includes(e.status)) || evs.rows[0];
    if (!(ev.open_registration && ['published', 'running'].includes(ev.status))) {
        await api(page, 'PUT', `/api/v1/events/${ev.id}`, { open_registration: 1 });
        await api(page, 'POST', `/api/v1/events/${ev.id}/status`, { status: 'published' });
    }
    await page.goto(`/app/events/${ev.id}/design`);
    await expect(page.locator('.dz-preset')).toHaveCount(4);
    await page.locator('.dz-preset').nth(1).click(); // طلابي: بطاقة + خطوات + احتفال
    // المعاينة الحية تتحدث دون حفظ
    await expect(page.frameLocator('.dz-frame').locator('.lp.lay-card')).toBeVisible();
    await page.locator('.dz-bar .btn.primary').click();
    await expect(page.locator('.dz-status:not(.dirty)')).toBeVisible();
    // الصفحة العامة بلا تسجيل دخول
    const pub = await page.context().browser().newContext({ baseURL: page.url().replace(/\/app.*$/, '') });
    const p2 = await pub.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(`/m/r/${ev.id}`);
    await expect(p2.locator('.lp.lay-card .lp-steps')).toBeVisible();
    await p2.locator('#lp-form').scrollIntoViewIfNeeded();
    const inputs = p2.locator('#lp-form .lp-form-body input.input');
    await inputs.nth(0).fill('زائر تجريبي');
    await inputs.nth(2).fill('0551112233');
    await p2.locator('#lp-form button[type=submit]').click();
    // خطوة التفاصيل (إن وُجدت حقول إضافية) ثم المراجعة
    for (let i = 0; i < 3 && !(await p2.locator('.lp-review').count()); i++) {
        for (const sel of await p2.locator('#lp-form select[required]').all()) await sel.selectOption({ index: 1 });
        for (const inp of await p2.locator('#lp-form input.input[required]').all()) if (!(await inp.inputValue())) await inp.fill((await inp.getAttribute('pattern')) ? '441234567' : '1234');
        for (const c of await p2.locator('#lp-form input[type=checkbox][required]').all()) await c.check();
        for (const r of await p2.locator('#lp-form .lp-choices').all()) { const first = r.locator('input[type=radio]').first(); if (await first.count()) await first.check(); }
        await p2.locator('#lp-form button[type=submit]').click();
    }
    await expect(p2.locator('.lp-review')).toContainText('زائر تجريبي');
    await p2.locator('#lp-form button[type=submit]').click();
    await expect(p2.locator('.lp-success')).toBeVisible();
    await p2.waitForURL(/\/m\/i\//, { timeout: 10_000 });
    await pub.close();
    expect(errors).toEqual([]);
});
