// تنظيم — الإعدادات من البيئة (ومن ملف .env اختياري بجانب package.json أو في المجلد الأعلى على الخادم).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m || process.env[m[1]] !== undefined) continue;
        process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
}
loadEnv(path.join(ROOT, '.env'));
loadEnv(path.join(ROOT, '..', '.env')); // على Serv00: ~/tanzeem/.env بجانب ~/tanzeem/app

const env = process.env;
export const config = {
    port: Number(env.PORT || 3000),
    host: env.HOST || '0.0.0.0',
    dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
    distDir: env.DIST_DIR || path.join(ROOT, 'dist'),
    // يجب ضبطه في .env: يوقّع رموز QR ويشفّر الحقول الحساسة، وتغييره يُبطل الرموز القائمة
    secret: env.APP_SECRET || (env.NODE_ENV === 'production' ? '' : 'dev-only-' + crypto.createHash('sha256').update(ROOT).digest('hex')),
    publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
    seedDemo: env.SEED_DEMO === '1',
    demoPassword: env.DEMO_PASSWORD || '',
    dbFile: env.DB_FILE || '',
    sessionIdleMinutes: Number(env.SESSION_IDLE_MINUTES || 720),
    trustProxy: env.TRUST_PROXY !== '0',
};
config.dbFile ||= path.join(config.dataDir, 'tanzeem.sqlite');
if (!config.secret) {
    console.error('APP_SECRET مطلوب في الإنتاج (.env)');
    process.exit(1);
}
