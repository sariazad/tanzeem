// تنظيم — لوحة التحكم: مؤشرات لحظية، الدخول والخروج بالساعة، أحدث العمليات، التنبيهات، والفعاليات القادمة.
import { h, icon, clear } from '../../core/dom.js';
import { t, fmtNum, fmtPct, fmtDate, fmtTime, fmtAgo, pick, opt } from '../../core/i18n.js';
import { api } from '../../core/api.js';
import { badge, progress, mount, empty } from '../../core/ui.js';
import { lineChart } from '../../core/charts.js';
import { pageHead } from '../main.js';

export default async function dashboard({ root, ws, can, me }) {
    const body = h('div');
    root.append(pageHead(t('dash.title'), t('dash.subtitle', { name: me.name.split(' ')[0] }), [
        can('checkin', 'create') ? h('a.btn', { href: '/app/checkin' }, icon('scan'), t('nav.checkin')) : null,
        can('events', 'create') ? h('a.btn.primary', { href: '/app/events/new' }, icon('plus'), t('events.new')) : null,
    ]), body);
    let data = null;
    const load = () => mount(body, () => api('dashboard'), (d) => { data = d; return render(d); });
    await load();
    let pending = null;
    const off = ws.on('attendance', (a) => {
        if (!data) return;
        // تحديث فوري للأرقام والسجل، ثم إعادة تحميل هادئة
        data.kpi.inside_now += a.direction === 'in' ? 1 : -1;
        data.recent.unshift({ id: Date.now(), direction: a.direction, method: a.method, gate: a.gate, at: a.at, name_ar: a.visitor.name_ar, name_en: a.visitor.name_en, category: a.visitor.category, subject_title: a.subject.title_ar });
        data.recent = data.recent.slice(0, 12);
        clear(body, render(data));
        clearTimeout(pending);
        pending = setTimeout(() => api('dashboard').then((d) => { data = d; clear(body, render(d)); }).catch(() => {}), 4000);
    });
    const off2 = ws.on('notification', () => { clearTimeout(pending); pending = setTimeout(load, 1500); });
    const timer = setInterval(() => api('dashboard').then((d) => { data = d; clear(body, render(d)); }).catch(() => {}), 60_000);
    return () => { off(); off2(); clearInterval(timer); clearTimeout(pending); };
}

function render(d) {
    const k = d.kpi;
    const kpi = (ic, v, l, s, accent) => h(`div.card.kpi${accent ? '.accent' : ''}`, h('div.kpi-ico', icon(ic)), h('div', h('div.kpi-v', v), h('div.kpi-l', l), s ? h('div.kpi-s', s) : null));
    const hours = d.hourly.map((x) => `${String(x.hour).padStart(2, '0')}:00`);
    return h('div',
        h('div.kpis',
            kpi('calendar', fmtNum(k.active_events), t('dash.active_events'), k.pending_visits ? t('dash.pending_visits', { n: fmtNum(k.pending_visits) }) : null),
            kpi('users', fmtNum(k.inside_now), t('dash.inside_now'), t('dash.live'), true),
            kpi('user-check', fmtNum(k.visitors_today), t('dash.visitors_today')),
            kpi('trending', fmtPct(k.attendance_rate), t('dash.attendance_rate'), t('dash.of_registered')),
            kpi('mail', fmtNum(k.invitations_confirmed), t('dash.invitations_confirmed'), t('dash.of_total', { n: fmtNum(k.invitations_total) })),
            kpi('cpu', `${fmtNum(k.devices_online)}/${fmtNum(k.devices_total)}`, t('dash.devices_online'))),
        h('div.grid.g-main',
            h('div.card', h('div.card-h', h('h2', t('dash.hourly')), h('span.small.muted', t('dash.today'))),
                h('div.card-b', lineChart({ labels: hours, series: [{ name: t('common.in'), values: d.hourly.map((x) => x.in) }, { name: t('common.out'), values: d.hourly.map((x) => x.out) }], ariaLabel: t('dash.hourly') }))),
            h('div.card', h('div.card-h', h('h2', t('dash.alerts')), h('a.small', { href: '/app/notifications' }, t('common.view_all'))),
                h('div.list', d.alerts.length ? d.alerts.map((n) => h('div.list-item', h('span', { class: `dot ${n.priority === 'critical' ? 'bad' : n.priority === 'high' ? 'warn' : 'info'}` }),
                    h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 500 } }, t(`notif.${n.type}.title`)), h('div.small.muted', t(`notif.${n.type}.body`, n.params))), h('span.small.faint', fmtAgo(n.created_at))))
                    : [empty(t('dash.no_alerts'))]))),
        d.running.length ? h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h2', t('dash.running_now'))),
            h('div.card-b', h('div.grid.g2', d.running.map((e) => {
                const pct = e.capacity ? (e.inside / e.capacity) * 100 : 0;
                return h('a', { href: `/app/events/${e.id}/live`, style: { color: 'inherit', textDecoration: 'none' } }, h('div', { style: { border: '1px solid var(--border)', borderRadius: '12px', padding: '14px' } },
                    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, h('b', pick(e, 'title')), e.forecast ? badge('priority', { normal: 'low', busy: 'high', critical: 'critical', unknown: 'low' }[e.forecast.level], t(`forecast.${e.forecast.level}`)) : null),
                    h('div', { style: { display: 'flex', gap: '18px', margin: '10px 0 8px' } }, stat(t('common.inside'), e.inside), stat(t('common.entries'), e.entries), stat(t('common.exits'), e.exits), e.capacity ? stat(t('f.capacity'), e.capacity) : null),
                    e.capacity ? progress(pct) : null,
                    e.forecast?.minutes_to_capacity ? h('div.small.muted', { style: { marginTop: '6px' } }, icon('sparkles'), ' ', t('forecast.eta', { m: fmtNum(e.forecast.minutes_to_capacity) })) : null));
            })))) : null,
        h('div.grid.g2', { style: { marginTop: '16px' } },
            h('div.card', h('div.card-h', h('h2', t('dash.recent'))),
                h('div', d.recent.length ? d.recent.map((r) => h('div.feed-item', h(`div.dir.${r.direction}`, icon(r.direction === 'in' ? 'log-in' : 'log-out')),
                    h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 500 } }, pick(r, 'name')), h('div.small.muted', `${r.subject_title || ''}${r.gate ? ' · ' + r.gate : ''} · ${opt('method', r.method)}`)),
                    h('span.small.faint.num', fmtTime(r.at)))) : [empty(t('dash.no_activity'))])),
            h('div.card', h('div.card-h', h('h2', t('dash.upcoming')), h('a.small', { href: '/app/events' }, t('common.view_all'))),
                h('div.list', d.upcoming.length ? d.upcoming.map((e) => h('a.list-item', { href: `/app/events/${e.id}`, style: { color: 'inherit', textDecoration: 'none' } },
                    h('div', { style: { width: '46px', textAlign: 'center', flex: 'none' } }, h('div', { style: { fontSize: '19px', fontWeight: 700, color: 'var(--primary)' } }, new Intl.DateTimeFormat('en', { day: 'numeric', timeZone: 'Asia/Riyadh' }).format(new Date(e.starts_at))), h('div.small.muted', new Intl.DateTimeFormat(document.documentElement.lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en', { month: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(e.starts_at)))),
                    h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 500 } }, pick(e, 'title')), h('div.small.muted', `${fmtDate(e.starts_at)} · ${fmtTime(e.starts_at)}`)),
                    h('div', { style: { textAlign: 'end' } }, badge('status', e.status), h('div.small.faint', { style: { marginTop: '4px' } }, t('events.registered_n', { n: fmtNum(e.registered) }))))) : [empty(t('dash.no_upcoming'))]))));
}
const stat = (l, v) => h('div', h('div', { style: { fontSize: '20px', fontWeight: 700 } }, fmtNum(v)), h('div.small.muted', l));
