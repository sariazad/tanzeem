// تنظيم — قوالب الرسائل الثنائية اللغة (قابلة للتعديل من الإعدادات). المتغيرات: {name} {event} {date} {time} {location} {link} {org}

export const DEFAULT_TEMPLATES = {
    invitation: {
        ar: {
            subject: 'دعوة: {event}',
            body: 'السلام عليكم {name}،\n\nيسعدنا دعوتكم لحضور «{event}» يوم {date} الساعة {time} في {location}.\n\nلتأكيد الحضور واستلام رمز الدخول: {link}\n\nمع التحية،\n{org}',
            sms: 'دعوة لحضور {event} يوم {date} {time}. للتأكيد ورمز الدخول: {link}',
        },
        en: {
            subject: 'Invitation: {event}',
            body: 'Dear {name},\n\nYou are invited to attend "{event}" on {date} at {time}, {location}.\n\nConfirm your attendance and get your entry code: {link}\n\nBest regards,\n{org}',
            sms: 'You are invited to {event} on {date} {time}. Confirm & entry code: {link}',
        },
    },
    reminder: {
        ar: { subject: 'تذكير: {event}', body: 'تذكير بموعد «{event}» يوم {date} الساعة {time} في {location}.\nرمز الدخول: {link}', sms: 'تذكير: {event} {date} {time}. رمز الدخول: {link}' },
        en: { subject: 'Reminder: {event}', body: 'A reminder that "{event}" is on {date} at {time}, {location}.\nEntry code: {link}', sms: 'Reminder: {event} {date} {time}. Entry code: {link}' },
    },
    permit: {
        ar: { subject: 'تصريح زيارة: {event}', body: 'السلام عليكم {name}،\n\nتم اعتماد زيارتكم «{event}» يوم {date} الساعة {time} في {location}.\nتصريح الدخول (رمز QR): {link}\n\n{org}', sms: 'تم اعتماد زيارتكم {event} {date} {time}. التصريح: {link}' },
        en: { subject: 'Visit permit: {event}', body: 'Dear {name},\n\nYour visit "{event}" on {date} at {time}, {location} has been approved.\nEntry permit (QR): {link}\n\n{org}', sms: 'Your visit {event} {date} {time} is approved. Permit: {link}' },
    },
    message: {
        ar: { subject: '{event}', body: '{body}', sms: '{body}' },
        en: { subject: '{event}', body: '{body}', sms: '{body}' },
    },
};

export function fill(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

/** تنسيق التاريخ والوقت حسب اللغة (التقويم الميلادي مع الهجري بين قوسين بالعربية). */
export function fmtDate(iso, lang = 'ar', tz = 'Asia/Riyadh') {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const g = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    if (lang !== 'ar') return g;
    const h = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    return `${g} (${h})`;
}
export function fmtTime(iso, lang = 'ar', tz = 'Asia/Riyadh') {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: lang === 'ar' }).format(d);
}
