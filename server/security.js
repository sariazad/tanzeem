// تنظيم — التشفير: كلمات المرور، الرموز، تشفير الحقول الحساسة، TOTP، وتوقيع رموز QR.
import crypto from 'node:crypto';

export const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ───────── كلمات المرور (scrypt) ───────── */
export function hashPassword(pw) {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
    return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function checkPassword(pw, stored) {
    if (!stored || !stored.startsWith('scrypt$')) return false;
    const [, s, k] = stored.split('$');
    const key = crypto.scryptSync(String(pw || ''), Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(key, Buffer.from(k, 'base64'));
}
/** سياسة كلمات المرور: 12 خانة فأكثر وثلاثة أنواع على الأقل من (صغيرة، كبيرة، أرقام، رموز). */
export function passwordProblems(pw) {
    const p = String(pw || '');
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
    const out = [];
    if (p.length < 12) out.push('too_short');
    if (classes < 3) out.push('too_simple');
    return out;
}

/* ───────── مفاتيح مشتقة من APP_SECRET ───────── */
export function keys(secret) {
    const derive = (label) => crypto.createHmac('sha256', secret).update(label).digest();
    return { enc: derive('tanzeem:enc:v1'), lookup: derive('tanzeem:lookup:v1'), qr: derive('tanzeem:qr:v1'), sign: derive('tanzeem:sign:v1') };
}

/** AES-256-GCM: v1.iv.tag.data (base64url). */
export function encrypt(key, plain) {
    if (plain == null || plain === '') return '';
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}
export function decrypt(key, blob) {
    if (!blob) return '';
    const [v, iv, tag, data] = String(blob).split('.');
    if (v !== 'v1') return '';
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
/** تجزئة للبحث المطابق دون تخزين القيمة الأصلية (رقم الهوية). */
export const lookupHash = (key, v) => crypto.createHmac('sha256', key).update(String(v).trim()).digest('hex');

/* ───────── رموز QR: لا تحمل أي بيانات شخصية ───────── */
// الصيغة: TZ1.<رقم الاعتماد بأساس 36>.<توقيع HMAC مختصر 128 بت>
export function signCredential(key, id, nonce) {
    const sig = crypto.createHmac('sha256', key).update(`cred:${id}:${nonce}`).digest('base64url').slice(0, 22);
    return `TZ1.${Number(id).toString(36)}.${sig}`;
}
export function parseCredential(token) {
    const m = String(token || '').trim().match(/^TZ1\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{22})$/);
    if (!m) return null;
    return { id: parseInt(m[1], 36), sig: m[2] };
}
export function verifyCredentialSig(key, id, nonce, token) {
    return safeEqual(signCredential(key, id, nonce), String(token).trim());
}
/** بصمة قصيرة للرمز للتحقق دون اتصال على الأجهزة (لا يمكن عكسها إلى الرمز). */
export const offlineFingerprint = (token) => sha256(String(token).trim()).slice(0, 24);

/* ───────── TOTP (RFC 6238) للتحقق الثنائي ───────── */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
    let bits = 0, value = 0, out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
}
export function base32Decode(s) {
    let bits = 0, value = 0;
    const out = [];
    for (const ch of String(s).replace(/=+$/, '').toUpperCase()) {
        const i = B32.indexOf(ch);
        if (i < 0) continue;
        value = (value << 5) | i;
        bits += 5;
        if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(out);
}
export function totp(secretB32, t = Date.now(), step = 30) {
    const counter = Math.floor(t / 1000 / step);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
    const o = h[h.length - 1] & 15;
    const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString();
    return code.padStart(6, '0');
}
export function checkTotp(secretB32, code, t = Date.now()) {
    const c = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(c)) return false;
    return [-1, 0, 1].some((w) => safeEqual(totp(secretB32, t + w * 30_000), c));
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));
