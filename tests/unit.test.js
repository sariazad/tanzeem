// تنظيم — اختبارات الوحدات: الصلاحيات، التشفير ورموز QR، TOTP، التحقق من الحقول، رسم البطاقة.
import { describe, it, expect } from 'vitest';
import { can, scopeOf, flatten, DEFAULT_ROLES, MODULES } from '../shared/permissions.js';
import { coerce, normPhone, RESOURCES } from '../shared/resources.js';
import { keys, encrypt, decrypt, signCredential, parseCredential, verifyCredentialSig, hashPassword, checkPassword, passwordProblems, totp, checkTotp, newTotpSecret, base32Decode, base32Encode, lookupHash } from '../server/security.js';
import { renderSvg, renderZpl, defaultDesign } from '../shared/badge.js';
import { fill, fmtDate } from '../shared/messages.js';

const role = (k) => DEFAULT_ROLES.find((r) => r.key === k).permissions;

describe('القائمة والصلاحيات', () => {
    it('القائمة الجانبية بالترتيب المحدد (16 عنصراً)', () => {
        expect(MODULES.map((m) => m.key)).toEqual(['dashboard', 'events', 'visits', 'visitors', 'groups', 'bulk', 'reports', 'notifications', 'checkin', 'kiosk', 'badges', 'devices', 'users', 'forms', 'audit', 'integrations']);
    });
    it('مدير النظام يملك كل شيء', () => {
        const g = [{ permissions: role('super_admin'), scope_type: 'all' }];
        expect(can(g, 'audit', 'view')).toBe(true);
        expect(flatten(g).integrations).toContain('delete');
    });
    it('النطاق: إداري جهة لا يرى جهة أخرى', () => {
        const g = [{ permissions: role('org_admin'), scope_type: 'org', scope_id: 2 }];
        expect(can(g, 'events', 'update', { orgId: 2 })).toBe(true);
        expect(can(g, 'events', 'update', { orgId: 3 })).toBe(false);
        expect(scopeOf(g, 'events')).toEqual({ all: false, orgs: [2], events: [] });
    });
    it('النطاق: منظم فعالية محددة فقط', () => {
        const g = [{ permissions: role('organizer'), scope_type: 'event', scope_id: 7 }];
        expect(can(g, 'checkin', 'create', { eventId: 7 })).toBe(true);
        expect(can(g, 'checkin', 'create', { eventId: 8 })).toBe(false);
        expect(can(g, 'users', 'view')).toBe(false);
    });
    it('موظف الاستقبال لا يحذف ولا يدير المستخدمين', () => {
        const g = [{ permissions: role('reception'), scope_type: 'all' }];
        expect(can(g, 'checkin', 'create')).toBe(true);
        expect(can(g, 'visitors', 'delete')).toBe(false);
        expect(can(g, 'audit', 'view')).toBe(false);
    });
});

describe('التشفير ورموز QR', () => {
    const k = keys('unit-secret');
    it('تشفير الحقول الحساسة وفكه', () => {
        const blob = encrypt(k.enc, '1012345678');
        expect(blob).not.toContain('1012345678');
        expect(decrypt(k.enc, blob)).toBe('1012345678');
        expect(lookupHash(k.lookup, '1012345678')).toHaveLength(64);
    });
    it('رمز QR بلا بيانات شخصية وتوقيع لا يُزوَّر', () => {
        const tok = signCredential(k.qr, 42, 'nonce');
        expect(tok).toMatch(/^TZ1\.[0-9a-z]+\.[A-Za-z0-9_-]{22}$/);
        expect(parseCredential(tok).id).toBe(42);
        expect(verifyCredentialSig(k.qr, 42, 'nonce', tok)).toBe(true);
        expect(verifyCredentialSig(k.qr, 42, 'other', tok)).toBe(false);
        expect(verifyCredentialSig(keys('x').qr, 42, 'nonce', tok)).toBe(false);
        expect(parseCredential('random text')).toBeNull();
    });
    it('كلمات المرور وسياستها', () => {
        const hsh = hashPassword('Abcdefghij12!');
        expect(checkPassword('Abcdefghij12!', hsh)).toBe(true);
        expect(checkPassword('wrong', hsh)).toBe(false);
        expect(passwordProblems('short')).toContain('too_short');
        expect(passwordProblems('alllowercaseletters')).toContain('too_simple');
        expect(passwordProblems('Good-Password-2026')).toEqual([]);
    });
    it('TOTP (RFC 6238)', () => {
        // متجه اختبار RFC 6238: السر "12345678901234567890" عند 59 ثانية → 94287082 (آخر 6 أرقام 287082)
        const secret = base32Encode(Buffer.from('12345678901234567890'));
        expect(totp(secret, 59_000)).toBe('287082');
        expect(base32Decode(secret).toString()).toBe('12345678901234567890');
        const s = newTotpSecret();
        expect(checkTotp(s, totp(s))).toBe(true);
        expect(checkTotp(s, '000000') && totp(s) !== '000000').toBe(false);
    });
});

describe('التحقق من الحقول', () => {
    const f = (key) => RESOURCES.events.fields.find((x) => x.key === key);
    it('خيارات وتواريخ وأرقام', () => {
        expect(coerce(f('type'), 'official')).toBe('official');
        expect(() => coerce(f('type'), 'party')).toThrow();
        expect(coerce(f('starts_at'), '2026-12-01T10:00:00+03:00')).toBe('2026-12-01T07:00:00.000Z');
        expect(() => coerce(f('capacity'), -1)).toThrow();
        expect(() => coerce(f('title_ar'), '')).toThrow();
    });
    it('توحيد أرقام الجوال السعودية', () => {
        expect(normPhone('0501234567')).toBe('+966501234567');
        expect(normPhone('966501234567')).toBe('+966501234567');
        expect(coerce({ key: 'p', type: 'phone' }, '050 123 4567')).toBe('+966501234567');
    });
    it('الصور: يرفض SVG في صور الزوار', () => {
        expect(() => coerce({ key: 'photo', type: 'image' }, 'data:image/svg+xml;base64,PHN2Zz4=')).toThrow();
        expect(coerce({ key: 'photo', type: 'image' }, 'data:image/png;base64,iVBORw0KGgo=')).toMatch(/^data:image\/png/);
    });
});

describe('البطاقة والرسائل', () => {
    it('SVG بالمقاس الحقيقي مع QR ونص آمن', () => {
        const svg = renderSvg(defaultDesign(), 54, 85.6, { name_ar: '<script>x</script>', qr: 'TZ1.a.AAAAAAAAAAAAAAAAAAAAAA', category: 'vip' });
        expect(svg).toContain('width="54mm"');
        expect(svg).not.toContain('<script>');
        expect(svg).toContain('&lt;script&gt;');
        expect(svg).toMatch(/<path d="M/);
    });
    it('ZPL لطابعات Zebra', () => {
        const z = renderZpl(defaultDesign(), 54, 85.6, { name_ar: 'محمد', name_en: 'Mohammed', qr: 'TZ1.a.AAAAAAAAAAAAAAAAAAAAAA', category: 'guest' });
        expect(z.startsWith('^XA')).toBe(true);
        expect(z).toContain('^CI28');
        expect(z).toContain('^BQN');
        expect(z.trim().endsWith('^XZ')).toBe(true);
    });
    it('قوالب الرسائل والتاريخ الهجري', () => {
        expect(fill('مرحباً {name} في {event}', { name: 'سارة', event: 'الملتقى' })).toBe('مرحباً سارة في الملتقى');
        expect(fmtDate('2026-11-18T09:00:00Z', 'ar')).toMatch(/1448/);
    });
});

describe('كاتب Excel المدمج', () => {
    it('ينتج ملف xlsx صالحاً يقرؤه Excel/SheetJS بالعربية ومن اليمين لليسار', async () => {
        const { writeXlsx } = await import('../server/exporter.js');
        const XLSX = (await import('xlsx')).default;
        const buf = writeXlsx(['الاسم', 'العدد', 'ملاحظة'], [['نورة', 12, '=SUM(1)'], ['Ahmed & co <x>', 3.5, null]]);
        const wb = XLSX.read(buf, { type: 'buffer' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
        expect(rows[0]).toEqual(['الاسم', 'العدد', 'ملاحظة']);
        expect(rows[1]).toEqual(['نورة', 12, "'=SUM(1)"]);
        expect(rows[2][0]).toBe('Ahmed & co <x>');
    });
});
