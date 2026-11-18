// تنظيم — أوامر الإدارة من سطر الأوامر:
//   node server/cli.js admin <email> [الاسم]   مدير نظام (يسأل عن كلمة المرور؛ ADMIN_PASSWORD يتجاوز السؤال)
//   node server/cli.js seed-demo               بيانات تجريبية على قاعدة فارغة
//   node server/cli.js backup [مجلد]            نسخة احتياطية متسقة (VACUUM INTO) مع الاحتفاظ بآخر 14
//   node server/cli.js restore <ملف>            استعادة من نسخة (أوقف الخادم أولاً)
//   node server/cli.js verify-audit            التحقق من سلامة سلسلة سجل التدقيق
//   node server/cli.js retention               تطبيق سياسة الاحتفاظ الآن
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { config } from './config.js';
import { openDb, one, run } from './db.js';
import { hashPassword, passwordProblems } from './security.js';

const [cmd, arg, arg2] = process.argv.slice(2);

async function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    return new Promise((res) => rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); res(a); }));
}

async function main() {
    if (cmd === 'admin' && arg) {
        const { createApp } = await import('./app.js');
        const { app, close } = createApp({ noScheduler: true });
        let pass = process.env.ADMIN_PASSWORD || '';
        while (passwordProblems(pass).length) {
            if (pass) console.log('كلمة المرور ضعيفة: 12 خانة فأكثر، وثلاثة أنواع من (حروف صغيرة، كبيرة، أرقام، رموز).');
            pass = await ask('كلمة المرور: ');
        }
        const email = arg.trim().toLowerCase();
        const role = one(app.db, "SELECT id FROM roles WHERE key = 'super_admin'");
        let u = one(app.db, 'SELECT id FROM users WHERE email = ?', email);
        if (u) run(app.db, "UPDATE users SET pass_hash = ?, status = 'active', source = 'local', failed_attempts = 0, locked_until = NULL WHERE id = ?", hashPassword(pass), u.id);
        else u = { id: Number(run(app.db, 'INSERT INTO users (name, email, pass_hash) VALUES (?,?,?)', arg2 || 'مدير النظام', email, hashPassword(pass)).lastInsertRowid) };
        run(app.db, "INSERT OR IGNORE INTO user_roles (user_id, role_id, scope_type) VALUES (?, ?, 'all')", u.id, role.id);
        app.audit.record({ name: 'cli' }, 'users.cli_admin', 'users', u.id);
        close();
        console.log(`✔ مدير النظام ${email} جاهز`);
    } else if (cmd === 'seed-demo') {
        const { createApp } = await import('./app.js');
        const { seedDemo } = await import('./seed.js');
        const { app, close } = createApp({ noScheduler: true, seedDemo: false });
        if (one(app.db, 'SELECT id FROM events LIMIT 1')) { console.log('القاعدة فيها بيانات — لم يُضف شيء'); close(); return; }
        console.log(seedDemo(app));
        close();
    } else if (cmd === 'backup') {
        const dir = arg || path.join(config.dataDir, 'backups');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `tanzeem-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sqlite`);
        const db = openDb();
        db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
        db.close();
        const files = fs.readdirSync(dir).filter((f) => /^tanzeem-.*\.sqlite$/.test(f)).sort();
        for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(dir, f));
        console.log(`✔ ${file} (${Math.round(fs.statSync(file).size / 1024)}KB)`);
    } else if (cmd === 'restore' && arg) {
        if (!fs.existsSync(arg)) throw new Error('الملف غير موجود');
        const test = openDb(arg);
        const ok = one(test, 'PRAGMA integrity_check').integrity_check;
        test.close();
        if (ok !== 'ok') throw new Error(`النسخة تالفة: ${ok}`);
        for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(config.dbFile + ext)) fs.renameSync(config.dbFile + ext, `${config.dbFile}${ext}.before-restore`);
        fs.copyFileSync(arg, config.dbFile);
        console.log(`✔ استُعيدت ${arg} — النسخة السابقة: ${config.dbFile}.before-restore`);
    } else if (cmd === 'verify-audit') {
        const { createApp } = await import('./app.js');
        const { app, close } = createApp({ noScheduler: true, seedDemo: false });
        const r = app.audit.verify();
        close();
        console.log(r.ok ? `✔ السلسلة سليمة (${r.checked} سجل)` : `✗ انكسار عند السجل ${r.brokenAt}`);
        process.exit(r.ok ? 0 : 2);
    } else if (cmd === 'retention') {
        const { createApp, retention } = await import('./app.js');
        const { app, close } = createApp({ noScheduler: true, seedDemo: false });
        console.log(retention(app));
        close();
    } else {
        console.log('node server/cli.js admin <email> [name] | seed-demo | backup [dir] | restore <file> | verify-audit | retention');
        process.exit(1);
    }
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
