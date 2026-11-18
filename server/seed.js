// تنظيم — بيانات تجريبية واقعية: جهات، 5 فعاليات، 300 زائر، دعوات، زيارات، أجهزة، وسجلات حضور.
import { one, all, run, tx } from './db.js';
import { hashPassword, randomToken } from './security.js';
import { defaultDesign } from '../shared/badge.js';

function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const FIRST_M = ['عبدالله', 'محمد', 'فهد', 'سلطان', 'خالد', 'سعود', 'عبدالرحمن', 'تركي', 'نايف', 'فيصل', 'ماجد', 'بندر', 'ناصر', 'سلمان', 'عمر', 'يوسف', 'إبراهيم', 'حمد', 'راكان', 'مشعل', 'زياد', 'عادل', 'وليد', 'سامي', 'هشام'];
const FIRST_F = ['نورة', 'سارة', 'ريم', 'هيا', 'لمى', 'العنود', 'منيرة', 'أمل', 'جواهر', 'دانة', 'شهد', 'لطيفة', 'مها', 'رزان', 'غادة', 'أسماء', 'هند', 'وعد', 'بشاير', 'ليان'];
const LAST = ['القحطاني', 'العتيبي', 'الدوسري', 'الشمري', 'الغامدي', 'الزهراني', 'المطيري', 'الحربي', 'السبيعي', 'العنزي', 'الشهري', 'التميمي', 'السديري', 'الرشيد', 'المالكي', 'الجهني', 'البقمي', 'الخالدي', 'العمري', 'السهلي', 'الفيفي', 'الأحمدي'];
const EN_FIRST = { 'عبدالله': 'Abdullah', 'محمد': 'Mohammed', 'فهد': 'Fahad', 'سلطان': 'Sultan', 'خالد': 'Khalid', 'سعود': 'Saud', 'عبدالرحمن': 'Abdulrahman', 'تركي': 'Turki', 'نايف': 'Nayef', 'فيصل': 'Faisal', 'ماجد': 'Majed', 'بندر': 'Bandar', 'ناصر': 'Nasser', 'سلمان': 'Salman', 'عمر': 'Omar', 'يوسف': 'Yousef', 'إبراهيم': 'Ibrahim', 'حمد': 'Hamad', 'راكان': 'Rakan', 'مشعل': 'Mishal', 'زياد': 'Ziyad', 'عادل': 'Adel', 'وليد': 'Waleed', 'سامي': 'Sami', 'هشام': 'Hisham',
    'نورة': 'Noura', 'سارة': 'Sarah', 'ريم': 'Reem', 'هيا': 'Haya', 'لمى': 'Lama', 'العنود': 'Alanoud', 'منيرة': 'Munira', 'أمل': 'Amal', 'جواهر': 'Jawaher', 'دانة': 'Dana', 'شهد': 'Shahad', 'لطيفة': 'Latifa', 'مها': 'Maha', 'رزان': 'Razan', 'غادة': 'Ghada', 'أسماء': 'Asma', 'هند': 'Hind', 'وعد': 'Waad', 'بشاير': 'Bashayer', 'ليان': 'Layan' };
const EN_LAST = { 'القحطاني': 'Alqahtani', 'العتيبي': 'Alotaibi', 'الدوسري': 'Aldosari', 'الشمري': 'Alshammari', 'الغامدي': 'Alghamdi', 'الزهراني': 'Alzahrani', 'المطيري': 'Almutairi', 'الحربي': 'Alharbi', 'السبيعي': 'Alsubaie', 'العنزي': 'Alanazi', 'الشهري': 'Alshehri', 'التميمي': 'Altamimi', 'السديري': 'Alsudairi', 'الرشيد': 'Alrasheed', 'المالكي': 'Almalki', 'الجهني': 'Aljuhani', 'البقمي': 'Albaqami', 'الخالدي': 'Alkhalidi', 'العمري': 'Alomari', 'السهلي': 'Alsahli', 'الفيفي': 'Alfaifi', 'الأحمدي': 'Alahmadi' };
const EXT_ORGS = ['وزارة التعليم', 'هيئة الحكومة الرقمية', 'الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا)', 'الهيئة الوطنية للأمن السيبراني', 'شركة أرامكو السعودية', 'مجموعة stc', 'شركة علم', 'جامعة الأميرة نورة بنت عبدالرحمن', 'جامعة الإمام محمد بن سعود الإسلامية', 'وزارة الاتصالات وتقنية المعلومات', 'هيئة تقويم التعليم والتدريب', 'صندوق تنمية الموارد البشرية', 'جامعة الملك عبدالله للعلوم والتقنية', 'إمارة منطقة الرياض'];
const JOBS = ['مدير إدارة', 'مستشار', 'أستاذ مشارك', 'أستاذ مساعد', 'مهندس برمجيات', 'أخصائي تقنية', 'وكيل العمادة', 'مدير مشروع', 'محلل بيانات', 'باحث', 'منسق برامج', 'رئيس قسم'];
const INTERESTS = ['الذكاء الاصطناعي', 'الأمن السيبراني', 'التحول الرقمي', 'تحليل البيانات', 'الحوسبة السحابية', 'ريادة الأعمال', 'التعليم الإلكتروني', 'إنترنت الأشياء', 'الواقع الافتراضي', 'الحكومة الرقمية', 'البحث العلمي', 'الاستدامة'];

const MAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600"><rect width="1000" height="600" fill="#f8fafc"/><g fill="none" stroke="#94a3b8" stroke-width="4"><rect x="10" y="10" width="980" height="580" rx="8"/><path d="M10 420 H300 M300 420 V590 M700 10 V200 M700 200 H990 M450 590 V520"/></g><g fill="#cbd5e1"><rect x="430" y="575" width="60" height="18" rx="3"/><rect x="20" y="300" width="14" height="60" rx="3"/></g><g font-family="Tahoma" font-size="14" fill="#64748b"><text x="460" y="570" text-anchor="middle">⬆</text></g></svg>`;

export function seedDemo(app, { password = app.cfg.demoPassword } = {}) {
    const { db } = app;
    const R = rng(1447);
    const pick = (a) => a[Math.floor(R() * a.length)];
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const H = 3600_000, D = 86400_000;
    const counts = {};

    tx(db, () => {
        /* الجهات */
        const org = (name_ar, name_en, code, parent) => Number(run(db, 'INSERT INTO orgs (name_ar, name_en, code, parent_id) VALUES (?,?,?,?)', name_ar, name_en, code, parent).lastInsertRowid);
        const ksu = org('جامعة الملك سعود', 'King Saud University', 'KSU', null);
        const orgs = {
            students: org('عمادة شؤون الطلاب', 'Deanship of Student Affairs', 'DSA', ksu),
            ccis: org('كلية علوم الحاسب والمعلومات', 'College of Computer & Information Sciences', 'CCIS', ksu),
            eng: org('كلية الهندسة', 'College of Engineering', 'ENG', ksu),
            it: org('عمادة التعاملات الإلكترونية والاتصالات', 'Deanship of E-Transactions & Communications', 'DETC', ksu),
            pr: org('الإدارة العامة للعلاقات العامة والإعلام', 'Public Relations & Media', 'PR', ksu),
            grad: org('وكالة الجامعة للدراسات العليا والبحث العلمي', 'Vice Rectorate for Graduate Studies & Research', 'VRGS', ksu),
        };

        /* المستخدمون التجريبيون (فقط إذا ضُبطت DEMO_PASSWORD) */
        if (password) {
            const roles = Object.fromEntries(all(db, 'SELECT id, key FROM roles').map((r) => [r.key, r.id]));
            const user = (name, email, role, scope_type = 'all', scope_id = null, orgId = null) => {
                const id = Number(run(db, 'INSERT OR IGNORE INTO users (name, email, pass_hash, org_id) VALUES (?,?,?,?)', name, email, hashPassword(password), orgId).lastInsertRowid);
                if (id) run(db, 'INSERT INTO user_roles (user_id, role_id, scope_type, scope_id) VALUES (?,?,?,?)', id, roles[role], scope_type, scope_id);
                return id;
            };
            user('مدير النظام (تجريبي)', 'superadmin@tanzeem.demo', 'super_admin');
            user('إداري العمادة', 'orgadmin@tanzeem.demo', 'org_admin', 'org', orgs.students, orgs.students);
            counts.organizer = user('منظم الملتقى', 'organizer@tanzeem.demo', 'organizer', 'event', 1, orgs.it);
            user('موظف الاستقبال', 'reception@tanzeem.demo', 'reception');
            user('فريق التقنية', 'it@tanzeem.demo', 'it');
        }

        /* القاعات والمناطق */
        const venue = Number(run(db, 'INSERT INTO venues (name_ar, name_en, address, map_bg, map_w, map_h) VALUES (?,?,?,?,?,?)', 'قاعة الملك فهد الكبرى', 'King Fahd Grand Hall', 'المدينة الجامعية — الدرعية', `data:image/svg+xml;base64,${Buffer.from(MAP_SVG).toString('base64')}`, 1000, 600).lastInsertRowid);
        const venue2 = Number(run(db, 'INSERT INTO venues (name_ar, name_en, address) VALUES (?,?,?)', 'مركز المؤتمرات — كلية علوم الحاسب', 'CCIS Conference Center', 'مبنى 31').lastInsertRowid);
        run(db, 'INSERT INTO venues (name_ar, name_en, address) VALUES (?,?,?)', 'بهو المدينة الجامعية للطالبات', 'Female Campus Atrium', 'المدينة الجامعية للطالبات');
        const zone = (v, ar, en, kind, cap, x, y, w, h, color) => Number(run(db, 'INSERT INTO zones (venue_id, name_ar, name_en, kind, capacity, x, y, w, h, color) VALUES (?,?,?,?,?,?,?,?,?,?)', v, ar, en, kind, cap, x, y, w, h, color).lastInsertRowid);
        const Z = {
            stage: zone(venue, 'المنصة الرئيسية', 'Main Stage', 'stage', 40, 330, 30, 340, 110, null),
            hall: zone(venue, 'القاعة الرئيسية', 'Main Hall', 'hall', 260, 330, 160, 340, 330, null),
            reg: zone(venue, 'منطقة التسجيل', 'Registration', 'registration', 60, 320, 500, 260, 80, null),
            exhibit: zone(venue, 'المعرض المصاحب', 'Exhibition', 'exhibition', 120, 30, 30, 270, 370, null),
            services: zone(venue, 'منطقة الخدمات', 'Services', 'services', 50, 30, 440, 250, 140, null),
            vip: zone(venue, 'صالة كبار الضيوف', 'VIP Lounge', 'vip', 30, 720, 30, 250, 150, null),
            entrance: zone(venue, 'البوابة الرئيسية', 'Main Gate', 'entrance', 80, 720, 230, 250, 160, null),
        };
        zone(venue2, 'القاعة أ', 'Hall A', 'hall', 120, 40, 40, 400, 300, null);
        zone(venue2, 'منطقة الشركات', 'Employers Area', 'exhibition', 200, 480, 40, 460, 300, null);

        /* المتحدثون */
        const sp = (ar, en, title, orgName) => Number(run(db, 'INSERT INTO speakers (name_ar, name_en, title, org_name) VALUES (?,?,?,?)', ar, en, title, orgName).lastInsertRowid);
        const speakers = [
            sp('د. عبدالله السبيعي', 'Dr. Abdullah Alsubaie', 'وكيل الجامعة', 'جامعة الملك سعود'), sp('م. نورة القحطاني', 'Eng. Noura Alqahtani', 'مديرة التحول الرقمي', 'هيئة الحكومة الرقمية'),
            sp('د. فهد الدوسري', 'Dr. Fahad Aldosari', 'أستاذ الذكاء الاصطناعي', 'كلية علوم الحاسب'), sp('أ. ريم الشهري', 'Reem Alshehri', 'مستشارة أمن سيبراني', 'الهيئة الوطنية للأمن السيبراني'),
            sp('د. خالد الغامدي', 'Dr. Khalid Alghamdi', 'باحث رئيسي', 'سدايا'), sp('م. سلطان العتيبي', 'Eng. Sultan Alotaibi', 'رئيس الحلول السحابية', 'مجموعة stc'),
            sp('د. هيا الرشيد', 'Dr. Haya Alrasheed', 'عميدة التعلم الإلكتروني', 'جامعة الأميرة نورة'), sp('أ. ماجد الحربي', 'Majed Alharbi', 'رائد أعمال', 'شركة علم'),
        ];

        /* النماذج */
        const opt = (list) => list.map((x, i) => ({ value: `i${i}`, label_ar: x, label_en: x }));
        const formEvent = Number(run(db, 'INSERT INTO forms (name, scope, fields) VALUES (?,?,?)', 'نموذج تسجيل الفعاليات العامة', 'event', JSON.stringify([
            { key: 'org', type: 'text', label_ar: 'الجهة', label_en: 'Organization', required: true },
            { key: 'job', type: 'text', label_ar: 'المسمى الوظيفي', label_en: 'Job title' },
            { key: 'attend_type', type: 'radio', label_ar: 'طبيعة الحضور', label_en: 'Attendance', required: true, options: [{ value: 'person', label_ar: 'حضوري', label_en: 'In person' }, { value: 'speaker', label_ar: 'متحدث', label_en: 'Speaker' }, { value: 'media', label_ar: 'إعلامي', label_en: 'Media' }] },
            { key: 'media_outlet', type: 'text', label_ar: 'الوسيلة الإعلامية', label_en: 'Media outlet', required: true, show_if: { field: 'attend_type', equals: 'media' } },
            { key: 'topics', type: 'multi', label_ar: 'المحاور المهتم بها', label_en: 'Topics of interest', options: opt(INTERESTS.slice(0, 8)) },
            { key: 'photo', type: 'photo', label_ar: 'صورة شخصية للبطاقة', label_en: 'Badge photo' },
            { key: 'consent', type: 'checkbox', label_ar: 'أوافق على سياسة الخصوصية', label_en: 'I accept the privacy policy', required: true },
        ])).lastInsertRowid);
        const formStudents = Number(run(db, 'INSERT INTO forms (name, scope, fields) VALUES (?,?,?)', 'نموذج تسجيل الطلاب', 'event', JSON.stringify([
            { key: 'student_id', type: 'text', label_ar: 'الرقم الجامعي', label_en: 'Student ID', required: true, pattern: '4\\d{8}' },
            { key: 'college', type: 'select', label_ar: 'الكلية', label_en: 'College', required: true, options: [{ value: 'ccis', label_ar: 'علوم الحاسب والمعلومات', label_en: 'CCIS' }, { value: 'eng', label_ar: 'الهندسة', label_en: 'Engineering' }, { value: 'bus', label_ar: 'إدارة الأعمال', label_en: 'Business' }, { value: 'sci', label_ar: 'العلوم', label_en: 'Science' }] },
            { key: 'level', type: 'number', label_ar: 'المستوى الدراسي', label_en: 'Level', min: 1, max: 12 },
        ])).lastInsertRowid);
        run(db, 'INSERT INTO forms (name, scope, fields) VALUES (?,?,?)', 'نموذج الزيارة الرسمية', 'visit', JSON.stringify([
            { key: 'purpose', type: 'textarea', label_ar: 'الغرض من الزيارة', label_en: 'Purpose', required: true },
            { key: 'vehicle', type: 'text', label_ar: 'رقم لوحة المركبة', label_en: 'Vehicle plate' },
            { key: 'national_id', type: 'national_id', label_ar: 'رقم الهوية', label_en: 'National ID', required: true },
        ]));

        /* قالب بطاقة أفقي إضافي */
        const land = defaultDesign(85.6, 54);
        land.elements = [
            { id: 'band', type: 'band', x: 0, y: 0, w: 85.6, h: 11, color: 'category' },
            { id: 'logo', type: 'logo', x: 2, y: 1.5, w: 8, h: 8 },
            { id: 'ev', type: 'field', field: 'event_title', x: 11, y: 1.5, w: 72, h: 8, size: 9, bold: true, color: '#ffffff', align: 'right' },
            { id: 'photo', type: 'photo', x: 63, y: 14, w: 19, h: 23, radius: 2 },
            { id: 'name', type: 'field', field: 'name_ar', x: 24, y: 15, w: 37, h: 8, size: 12, bold: true, color: '#111827', align: 'right' },
            { id: 'name_en', type: 'field', field: 'name_en', x: 24, y: 23, w: 37, h: 5, size: 7, color: '#4b5563', align: 'right' },
            { id: 'org', type: 'field', field: 'org_name', x: 24, y: 29, w: 37, h: 5, size: 7.5, color: '#374151', align: 'right' },
            { id: 'qr', type: 'qr', x: 3, y: 14, w: 19, h: 19 },
            { id: 'cat', type: 'field', field: 'category_label', x: 0, y: 47, w: 85.6, h: 7, size: 8, bold: true, color: '#ffffff', bg: 'category', align: 'center' },
        ];
        const tplLand = Number(run(db, 'INSERT INTO badge_templates (name, width_mm, height_mm, design) VALUES (?,?,?,?)', 'CR80 أفقي — الملتقيات', 85.6, 54, JSON.stringify(land)).lastInsertRowid);
        const tplDefault = one(db, 'SELECT id FROM badge_templates WHERE is_default = 1').id;

        /* الزوار */
        const visitors = [];
        const usedPhones = new Set();
        for (let i = 0; i < 300; i++) {
            const female = R() < 0.42;
            const f = pick(female ? FIRST_F : FIRST_M);
            const l = pick(LAST);
            const middle = pick(FIRST_M);
            const cat = i < 18 ? 'vip' : i < 26 ? 'speaker' : i < 34 ? 'media' : i < 150 ? 'student' : i < 200 ? 'staff' : i < 205 ? 'contractor' : 'guest';
            const orgName = cat === 'student' ? 'جامعة الملك سعود — طالب' : cat === 'staff' ? pick(['عمادة شؤون الطلاب', 'كلية علوم الحاسب والمعلومات', 'كلية الهندسة', 'عمادة التعاملات الإلكترونية والاتصالات']) : cat === 'media' ? pick(['صحيفة الرياض', 'قناة الإخبارية', 'وكالة الأنباء السعودية', 'رسالة الجامعة']) : pick(EXT_ORGS);
            let phone;
            do phone = `+9665${Math.floor(R() * 1e8).toString().padStart(8, '0')}`; while (usedPhones.has(phone));
            usedPhones.add(phone);
            const nid = `${R() < 0.85 ? 1 : 2}${Math.floor(R() * 1e9).toString().padStart(9, '0')}`;
            const ints = [...new Set(Array.from({ length: 2 + Math.floor(R() * 3) }, () => pick(INTERESTS)))].join(',');
            const id = Number(run(db, `INSERT INTO visitors (name_ar, name_en, org_name, job_title, category, phone, email, national_id_enc, national_id_hash, national_id_last4, interests, blocked, block_reason, source, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            `${f} ${female ? 'بنت' : 'بن'} ${middle} ${l}`, `${EN_FIRST[f]} ${EN_LAST[l]}`, orgName, cat === 'student' ? null : pick(JOBS), cat, phone,
            `${EN_FIRST[f].toLowerCase()}.${EN_LAST[l].toLowerCase()}${i}@example.com`, app.encrypt(nid), app.lookup(nid), nid.slice(-4), ints,
            i === 290 || i === 291 ? 1 : 0, i === 290 ? 'مخالفة تعليمات الأمن في زيارة سابقة' : i === 291 ? 'طلب من الجهة المختصة' : null, pick(['manual', 'import', 'import', 'web']), iso(now - (60 + Math.floor(R() * 300)) * D)).lastInsertRowid);
            visitors.push({ id, cat });
        }
        counts.visitors = visitors.length;
        const byCat = (c) => visitors.filter((v) => v.cat === c).map((v) => v.id);

        /* المجموعات */
        const group = (name, kind, orgId, ids) => {
            const g = Number(run(db, 'INSERT INTO groups (name, kind, org_id) VALUES (?,?,?)', name, kind, orgId).lastInsertRowid);
            for (const v of ids) run(db, 'INSERT OR IGNORE INTO group_members (group_id, visitor_id) VALUES (?,?)', g, v);
            return g;
        };
        const guests = byCat('guest');
        group('وفد وزارة التعليم', 'delegation', orgs.pr, guests.slice(0, 8));
        group('وفد هيئة الحكومة الرقمية', 'delegation', orgs.it, guests.slice(8, 14));
        group('دفعة طلاب علوم الحاسب 1447هـ', 'cohort', orgs.ccis, byCat('student').slice(0, 40));
        group('منسوبو عمادة شؤون الطلاب', 'org', orgs.students, byCat('staff').slice(0, 15));
        group('الإعلاميون المعتمدون', 'other', orgs.pr, byCat('media'));

        /* الفعاليات */
        const ev = (o) => Number(run(db, `INSERT INTO events (org_id, title_ar, title_en, type, status, starts_at, ends_at, venue_id, location, capacity, audience, description, form_id, badge_template_id, open_registration, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, o.org, o.ar, o.en, o.type, o.status, iso(o.start), iso(o.end), o.venue, o.location, o.cap, o.audience, o.desc, o.form, o.tpl, o.open ?? 1, iso(o.start - 30 * D)).lastInsertRowid);
        const hourNow = now - (now % H);
        const E1 = ev({ org: orgs.it, ar: 'ملتقى التحول الرقمي في التعليم العالي 2026', en: 'Digital Transformation in Higher Education Forum 2026', type: 'official', status: 'running', start: hourNow - 2 * H, end: hourNow + 6 * H + D, venue, location: 'قاعة الملك فهد الكبرى', cap: 400, audience: 'القيادات والمختصون', desc: 'ملتقى سنوي يجمع قيادات الجامعات والجهات الحكومية لاستعراض تجارب التحول الرقمي.', form: formEvent, tpl: tplLand });
        const E2 = ev({ org: orgs.ccis, ar: 'يوم المهنة لطلاب كلية علوم الحاسب', en: 'CCIS Career Day', type: 'students', status: 'published', start: hourNow + 5 * D + 2 * H, end: hourNow + 5 * D + 9 * H, venue: venue2, location: 'مركز المؤتمرات — مبنى 31', cap: 600, audience: 'طلاب وطالبات المستوى السابع فأعلى', desc: 'لقاء مباشر مع أكثر من 40 جهة توظيف.', form: formStudents, tpl: tplDefault });
        const E3 = ev({ org: orgs.pr, ar: 'حفل تخريج الدفعة السادسة والستين', en: 'Graduation Ceremony — Class 66', type: 'official', status: 'published', start: hourNow + 20 * D, end: hourNow + 20 * D + 4 * H, venue, location: 'قاعة الملك فهد الكبرى', cap: 1500, audience: 'الخريجون وذووهم', desc: 'حفل تخريج برعاية معالي رئيس الجامعة.', form: null, tpl: tplDefault, open: 0 });
        const E4 = ev({ org: orgs.grad, ar: 'ورشة الذكاء الاصطناعي في التعليم', en: 'AI in Education Workshop', type: 'guests', status: 'ended', start: hourNow - 10 * D - 4 * H, end: hourNow - 10 * D + 3 * H, venue: venue2, location: 'القاعة أ', cap: 150, audience: 'أعضاء هيئة التدريس', desc: 'ورشة تطبيقية حول توظيف النماذج اللغوية في التدريس والتقييم.', form: formEvent, tpl: tplLand });
        const E5 = ev({ org: orgs.students, ar: 'اللقاء التعريفي للطلاب المستجدين', en: 'New Students Orientation', type: 'students', status: 'draft', start: hourNow + 40 * D, end: hourNow + 40 * D + 5 * H, venue, location: 'قاعة الملك فهد الكبرى', cap: 1200, audience: 'الطلاب المستجدون', desc: 'تعريف بالخدمات الجامعية والأندية الطلابية.', form: formStudents, tpl: tplDefault });
        counts.events = 5;

        /* جدول الملتقى */
        const ses = (e, day, track, ar, en, startH, durH, hall, sps, featured) => run(db, 'INSERT INTO event_sessions (event_id, day, track, title_ar, title_en, starts_at, ends_at, hall, speaker_ids, featured) VALUES (?,?,?,?,?,?,?,?,?,?)', e, day, track, ar, en, iso(hourNow - 2 * H + (day - 1) * D + startH * H), iso(hourNow - 2 * H + (day - 1) * D + (startH + durH) * H), hall, JSON.stringify(sps), featured ? 1 : 0);
        ses(E1, 1, 'الجلسات الرئيسية', 'الافتتاح والكلمة الرئيسية', 'Opening & Keynote', 0, 1, 'المنصة الرئيسية', [speakers[0]], 1);
        ses(E1, 1, 'الجلسات الرئيسية', 'الحكومة الرقمية: من الخدمة إلى التجربة', 'Digital Government: From Service to Experience', 1, 1, 'المنصة الرئيسية', [speakers[1]], 1);
        ses(E1, 1, 'الذكاء الاصطناعي', 'النماذج اللغوية العربية في الجامعات', 'Arabic LLMs in Universities', 2.5, 1, 'القاعة الرئيسية', [speakers[2], speakers[4]], 0);
        ses(E1, 1, 'الأمن السيبراني', 'ضوابط الأمن السيبراني للجهات التعليمية', 'Cybersecurity Controls for Education', 2.5, 1, 'صالة كبار الضيوف', [speakers[3]], 0);
        ses(E1, 1, 'الذكاء الاصطناعي', 'حلقة نقاش: مستقبل التقييم', 'Panel: The Future of Assessment', 4, 1.5, 'القاعة الرئيسية', [speakers[2], speakers[6]], 1);
        ses(E1, 2, 'الجلسات الرئيسية', 'السحابة السيادية والبنية التحتية', 'Sovereign Cloud & Infrastructure', 0, 1, 'المنصة الرئيسية', [speakers[5]], 1);
        ses(E1, 2, 'ريادة الأعمال', 'من البحث إلى المنتج', 'From Research to Product', 1.5, 1, 'القاعة الرئيسية', [speakers[7]], 0);
        ses(E1, 2, 'الأمن السيبراني', 'ورشة: الاستجابة للحوادث', 'Workshop: Incident Response', 1.5, 2, 'صالة كبار الضيوف', [speakers[3]], 0);
        ses(E1, 2, 'الجلسات الرئيسية', 'الختام وتوصيات الملتقى', 'Closing & Recommendations', 4, 1, 'المنصة الرئيسية', [speakers[0], speakers[1]], 1);
        ses(E2, 1, 'لقاءات', 'كيف تبني سيرتك الذاتية التقنية', 'Building a Tech Resume', 120 + 1, 1, 'القاعة أ', [speakers[7]], 1);
        ses(E4, 1, 'ورش', 'النماذج اللغوية في التدريس', 'LLMs in Teaching', -240, 2, 'القاعة أ', [speakers[2]], 1);

        /* الدعوات والتسجيل والاعتمادات */
        // الرموز والمفاتيح عشوائية تشفيرياً حتى في البيانات التجريبية
        const nonce = () => randomToken(9);
        const invite = (e, vid, status, channel, sentAgo, ev0) => {
            const token = randomToken(18);
            run(db, `INSERT OR IGNORE INTO invitations (event_id, visitor_id, channel, status, token, sent_at, responded_at) VALUES (?,?,?,?,?,?,?)`, e, vid, channel, status, token,
                status === 'pending' ? null : iso(now - sentAgo), ['confirmed', 'declined'].includes(status) ? iso(now - sentAgo + 2 * D * R()) : null);
            if (status === 'confirmed') {
                run(db, "INSERT OR IGNORE INTO registrations (event_id, visitor_id, source, answers) VALUES (?, ?, 'invite', '{}')", e, vid);
                run(db, 'INSERT OR IGNORE INTO credentials (subject_type, subject_id, visitor_id, nonce, valid_from, valid_to) VALUES (?,?,?,?,?,?)', 'event', e, vid, nonce(), iso(new Date(ev0.start).getTime() - 3 * H), iso(new Date(ev0.end).getTime() + 12 * H));
            }
            if (status === 'sent') run(db, 'INSERT OR IGNORE INTO credentials (subject_type, subject_id, visitor_id, nonce, valid_from, valid_to) VALUES (?,?,?,?,?,?)', 'event', e, vid, nonce(), iso(new Date(ev0.start).getTime() - 3 * H), iso(new Date(ev0.end).getTime() + 12 * H));
        };
        const evRow = (id) => one(db, 'SELECT starts_at start, ends_at end FROM events WHERE id = ?', id);
        const nonStudents = visitors.filter((v) => v.cat !== 'student' && v.cat !== 'contractor').map((v) => v.id);
        // الملتقى: 300 مدعو تقريباً
        const e1 = evRow(E1);
        for (const vid of [...nonStudents, ...byCat('student').slice(0, 40)]) {
            const x = R();
            invite(E1, vid, x < 0.78 ? 'confirmed' : x < 0.86 ? 'sent' : x < 0.93 ? 'declined' : x < 0.97 ? 'pending' : 'failed', R() < 0.7 ? 'email' : 'both', 12 * D, e1);
        }
        const e2 = evRow(E2);
        for (const vid of byCat('student').slice(0, 110)) { const x = R(); invite(E2, vid, x < 0.55 ? 'confirmed' : x < 0.85 ? 'sent' : x < 0.9 ? 'declined' : 'pending', 'sms', 3 * D, e2); }
        const e3 = evRow(E3);
        for (const vid of [...byCat('vip'), ...byCat('staff').slice(0, 30)]) invite(E3, vid, R() < 0.4 ? 'confirmed' : 'sent', 'email', 1 * D, e3);
        const e4 = evRow(E4);
        for (const vid of [...byCat('staff'), ...guests.slice(0, 80)]) { const x = R(); invite(E4, vid, x < 0.82 ? 'confirmed' : x < 0.9 ? 'declined' : 'expired', 'email', 25 * D, e4); }
        // تسجيلات فورية (من الكشك والويب) للملتقى
        for (const vid of guests.slice(80, 92)) {
            run(db, "INSERT OR IGNORE INTO registrations (event_id, visitor_id, source, answers) VALUES (?, ?, ?, '{}')", E1, vid, R() < 0.6 ? 'kiosk' : 'web');
            run(db, 'INSERT OR IGNORE INTO credentials (subject_type, subject_id, visitor_id, nonce, valid_from, valid_to) VALUES (?,?,?,?,?,?)', 'event', E1, vid, nonce(), iso(new Date(e1.start).getTime() - 3 * H), iso(new Date(e1.end).getTime() + 12 * H));
        }

        /* سجلات الحضور */
        const zonesE1 = [Z.hall, Z.hall, Z.hall, Z.stage, Z.exhibit, Z.exhibit, Z.services, Z.reg, Z.vip, Z.entrance];
        const logIn = (subjType, subjId, vid, at, method, gate, zoneId, devId) => run(db, 'INSERT INTO attendance_logs (subject_type, subject_id, visitor_id, credential_id, direction, method, gate, zone_id, device_id, at) VALUES (?,?,?,(SELECT id FROM credentials WHERE subject_type=? AND subject_id=? AND visitor_id=?),?,?,?,?,?,?)', subjType, subjId, vid, subjType, subjId, vid, 'in', method, gate, zoneId, devId, iso(at));
        const logOut = (subjType, subjId, vid, at, gate) => run(db, 'INSERT INTO attendance_logs (subject_type, subject_id, visitor_id, direction, method, gate, at) VALUES (?,?,?,?,?,?,?)', subjType, subjId, vid, 'out', 'qr', gate, iso(at));
        const pres = (t, s, v, inside, zoneId, firstIn, last) => run(db, 'INSERT OR REPLACE INTO presence (subject_type, subject_id, visitor_id, inside, zone_id, first_in, last_at) VALUES (?,?,?,?,?,?,?)', t, s, v, inside, inside ? zoneId : null, iso(firstIn), iso(last));
        const regE1 = all(db, "SELECT visitor_id FROM registrations WHERE event_id = ? AND status = 'confirmed'", E1).map((r) => r.visitor_id);
        let n1 = 0;
        for (const vid of regE1) {
            if (R() > 0.72) continue;
            const start = new Date(e1.start).getTime();
            const t = start - 40 * 60_000 + Math.floor(Math.pow(R(), 1.6) * (now - start + 35 * 60_000));
            const method = pick(['qr', 'qr', 'qr', 'kiosk', 'kiosk', 'manual', 'mobile']);
            const zoneId = pick(zonesE1);
            logIn('event', E1, vid, Math.min(t, now - 60_000), method, pick(['البوابة الرئيسية', 'البوابة الرئيسية', 'بوابة كبار الضيوف', 'بوابة 2']), zoneId, null);
            let inside = 1, last = Math.min(t, now - 60_000);
            if (R() < 0.14) { last = Math.min(now - 30_000, last + Math.floor(R() * 90 * 60_000)); logOut('event', E1, vid, last, 'البوابة الرئيسية'); inside = 0; }
            pres('event', E1, vid, inside, zoneId, Math.min(t, now - 60_000), last);
            n1++;
        }
        const regE4 = all(db, "SELECT visitor_id FROM registrations WHERE event_id = ? AND status = 'confirmed'", E4).map((r) => r.visitor_id);
        for (const vid of regE4) {
            if (R() > 0.8) continue;
            const start = new Date(e4.start).getTime();
            const t = start - 30 * 60_000 + Math.floor(Math.pow(R(), 2) * 2 * H);
            logIn('event', E4, vid, t, pick(['qr', 'qr', 'kiosk', 'manual']), 'البوابة الرئيسية', null, null);
            const out = new Date(e4.end).getTime() - Math.floor(R() * 2 * H);
            logOut('event', E4, vid, out, 'البوابة الرئيسية');
            pres('event', E4, vid, 0, null, t, out);
        }
        counts.attendance = n1;

        /* الزيارات */
        const visit = (o) => {
            const id = Number(run(db, 'INSERT INTO visits (org_id, title, purpose, host_name, location, starts_at, ends_at, status, notes, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?)', o.org, o.title, o.purpose, o.host, o.loc, iso(o.start), iso(o.end), o.status, o.notes || null, ['approved', 'permit_issued', 'checked_in', 'checked_out'].includes(o.status) ? iso(o.start - 3 * D) : null).lastInsertRowid);
            for (const v of o.people) {
                run(db, 'INSERT OR IGNORE INTO visit_visitors (visit_id, visitor_id) VALUES (?,?)', id, v);
                if (['permit_issued', 'checked_in', 'checked_out'].includes(o.status)) run(db, 'INSERT OR IGNORE INTO credentials (subject_type, subject_id, visitor_id, nonce, valid_from, valid_to) VALUES (?,?,?,?,?,?)', 'visit', id, v, nonce(), iso(o.start - 3 * H), iso(o.end + 12 * H));
                if (o.status === 'checked_in' || o.status === 'checked_out') {
                    logIn('visit', id, v, o.start + 10 * 60_000, 'qr', 'بوابة الإدارة', null, null);
                    if (o.status === 'checked_out') logOut('visit', id, v, o.end - 15 * 60_000, 'بوابة الإدارة');
                    pres('visit', id, v, o.status === 'checked_in' ? 1 : 0, null, o.start + 10 * 60_000, o.status === 'checked_out' ? o.end - 15 * 60_000 : o.start + 10 * 60_000);
                }
            }
            return id;
        };
        visit({ org: orgs.pr, title: 'زيارة وفد وزارة التعليم لمركز الابتكار', purpose: 'الاطلاع على مشاريع الابتكار الطلابية', host: 'د. عبدالله السبيعي', loc: 'مركز الابتكار — مبنى 4', start: hourNow - 1 * H, end: hourNow + 2 * H, status: 'checked_in', people: guests.slice(0, 6) });
        visit({ org: orgs.it, title: 'زيارة فريق هيئة الحكومة الرقمية', purpose: 'مراجعة مؤشرات قياس التحول الرقمي', host: 'م. فيصل الشمري', loc: 'عمادة التعاملات الإلكترونية', start: hourNow + 1 * D + 2 * H, end: hourNow + 1 * D + 4 * H, status: 'permit_issued', people: guests.slice(8, 12) });
        visit({ org: orgs.eng, title: 'وفد جامعة الملك عبدالله للعلوم والتقنية', purpose: 'بحث التعاون في المختبرات المشتركة', host: 'عميد كلية الهندسة', loc: 'كلية الهندسة — قاعة المجلس', start: hourNow + 3 * D, end: hourNow + 3 * D + 3 * H, status: 'approved', people: guests.slice(14, 18) });
        visit({ org: orgs.students, title: 'زيارة مدرسية — ثانوية الملك فيصل', purpose: 'جولة تعريفية بالجامعة لطلاب الثانوية', host: 'وكيل عمادة شؤون الطلاب', loc: 'مبنى عمادة شؤون الطلاب', start: hourNow + 6 * D, end: hourNow + 6 * D + 3 * H, status: 'requested', people: guests.slice(18, 21) });
        visit({ org: orgs.ccis, title: 'زيارة شركة علم لمعامل الأمن السيبراني', purpose: 'تقييم شراكة تدريب', host: 'رئيس قسم أمن المعلومات', loc: 'كلية علوم الحاسب — معمل 2120', start: hourNow + 2 * D, end: hourNow + 2 * D + 2 * H, status: 'requested', people: guests.slice(21, 24) });
        visit({ org: orgs.pr, title: 'زيارة إعلامية لتغطية الملتقى', purpose: 'تغطية صحفية', host: 'الإدارة العامة للعلاقات العامة', loc: 'المركز الإعلامي', start: hourNow - 1 * D - 4 * H, end: hourNow - 1 * D, status: 'checked_out', people: byCat('media').slice(0, 4) });
        visit({ org: orgs.grad, title: 'وفد جامعة أجنبية — شراكات بحثية', purpose: 'توقيع مذكرة تفاهم', host: 'وكيل الجامعة للدراسات العليا', loc: 'مبنى الإدارة العليا', start: hourNow - 5 * D, end: hourNow - 5 * D + 3 * H, status: 'rejected', notes: 'تم تأجيل الزيارة بطلب من الجهة الضيفة', people: guests.slice(24, 27) });
        visit({ org: orgs.it, title: 'مقاول صيانة أنظمة التكييف', purpose: 'صيانة دورية', host: 'إدارة المرافق', loc: 'قاعة الملك فهد — غرفة التحكم', start: hourNow + 1 * D, end: hourNow + 1 * D + 6 * H, status: 'approved', people: byCat('contractor') });

        /* الأجهزة */
        const dev = (name, kind, loc, status, eventId, extra = {}) => Number(run(db, 'INSERT INTO devices (name, kind, location, status, version, last_seen, event_id, gate, zone_id, pair_code, pair_expires, config) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            name, kind, loc, status, status === 'pending' ? null : '1.0.0', status === 'pending' ? null : now - Math.floor(R() * 10 * 60_000), eventId, extra.gate || null, extra.zone || null, status === 'pending' ? String(100000 + Math.floor(R() * 899999)) : null, status === 'pending' ? now + D : null,
            JSON.stringify(kind === 'kiosk' ? { idle_seconds: 45, allow_walkin: true, capture_photo: true, languages: ['ar', 'en'], print_mode: 'auto' } : kind === 'printer' ? { dpmm: 12 } : {})).lastInsertRowid);
        const printer = dev('طابعة البطاقات — Zebra ZC300', 'printer', 'منطقة التسجيل', 'offline', E1);
        const k1 = dev('كشك الخدمة الذاتية 1', 'kiosk', 'البوابة الرئيسية', 'offline', E1, { gate: 'البوابة الرئيسية', zone: Z.reg });
        run(db, 'UPDATE devices SET printer_id = ? WHERE id = ?', printer, k1);
        dev('كشك الخدمة الذاتية 2', 'kiosk', 'بوابة 2', 'pending', E1, { gate: 'بوابة 2', zone: Z.reg });
        dev('جهاز الاستقبال — البهو', 'checkin', 'البوابة الرئيسية', 'offline', E1, { gate: 'البوابة الرئيسية' });
        dev('ماسح بوابة الخروج', 'gate', 'بوابة الخروج', 'offline', E1, { gate: 'بوابة الخروج' });
        const p2 = dev('طابعة Evolis Primacy 2', 'printer', 'مركز المؤتمرات', 'pending', null);
        run(db, 'INSERT INTO device_faults (device_id, code, message, at) VALUES (?,?,?,?)', printer, 'paper_low', 'مستوى البطاقات أقل من 10%', iso(now - 50 * 60_000).replace('T', ' ').slice(0, 19));
        run(db, 'INSERT INTO device_faults (device_id, code, message, at) VALUES (?,?,?,?)', k1, 'offline', 'انقطاع الشبكة 3 دقائق', iso(now - 3 * H).replace('T', ' ').slice(0, 19));
        void p2;

        /* التنبيهات */
        const note = (type, pr, params, entity, id, ago, status = 'new') => run(db, 'INSERT INTO notifications (type, priority, status, params, entity, entity_id, created_at) VALUES (?,?,?,?,?,?,?)', type, pr, status, JSON.stringify(params), entity, id, iso(now - ago));
        note('zone_crowded', 'high', { zone: 'القاعة الرئيسية', inside: 238, capacity: 260 }, 'zones', Z.hall, 12 * 60_000);
        note('printer_paper_low', 'medium', { device: 'طابعة البطاقات — Zebra ZC300' }, 'devices', printer, 50 * 60_000);
        note('blocked_visitor', 'critical', { name: 'زائر محظور', subject: 'ملتقى التحول الرقمي في التعليم العالي 2026', gate: 'بوابة 2' }, 'visitors', visitors[290].id, 35 * 60_000);
        note('device_offline', 'high', { device: 'كشك الخدمة الذاتية 1', location: 'البوابة الرئيسية' }, 'devices', k1, 3 * H, 'resolved');
        note('integration_failed', 'high', { action: 'send', message: 'SMTP connection timeout' }, 'integrations', null, 26 * H, 'ack');

        /* التكاملات */
        const integ = (kind, name, cfg, status = 'ok') => run(db, "INSERT INTO integrations (kind, name, config_enc, enabled, status, last_sync) VALUES (?,?,?,1,?,datetime('now'))", kind, name, app.encrypt(JSON.stringify(cfg)), status);
        integ('sms', 'مزود الرسائل النصية (وضع السجل)', { provider: 'log', sender: 'KSU' });
        integ('calendar', 'موجز التقويم (Exchange / Google)', { feed_token: randomToken(18) });
        integ('ai', 'المزوّد المدمج', { provider: 'builtin' });

        /* الشبكات الذكية: بعض التعارف في الملتقى */
        const insideE1 = all(db, "SELECT visitor_id FROM presence WHERE subject_type='event' AND subject_id = ? AND inside = 1 LIMIT 40", E1).map((r) => r.visitor_id);
        for (let i = 0; i + 1 < insideE1.length; i += 3) run(db, 'INSERT OR IGNORE INTO connections (event_id, a_id, b_id, source) VALUES (?,?,?,?)', E1, Math.min(insideE1[i], insideE1[i + 1]), Math.max(insideE1[i], insideE1[i + 1]), 'participant');

        run(db, 'INSERT INTO report_schedules (name, report, frequency, hour, recipients, format, enabled) VALUES (?,?,?,?,?,?,0)', 'تقرير الحضور اليومي للإدارة', 'participation', 'daily', 7, 'events-office@example.com', 'xlsx');
        void E5;
    });
    app.audit.record({ name: 'system' }, 'system.seed_demo', null, null, null, counts);
    return counts;
}
