// تنظيم — تتبع الحضور المباشر: دخول وخروج وإشغال لحظي، مؤشرات الأداء، توقع الازدحام، والخريطة الحرارية لكثافة الحشود.
import { h, icon, clear } from '../../../core/dom.js';
import { t, fmtNum, fmtPct, fmtTime, pick, opt } from '../../../core/i18n.js';
import { api } from '../../../core/api.js';
import { mount, progress, badge, empty } from '../../../core/ui.js';
import { lineChart, seqColor, densityColor } from '../../../core/charts.js';

export default async function live({ root, eventId, ws }) {
    const top = h('div');
    const feed = h('div', { style: { maxHeight: '520px', overflow: 'auto' } });
    let data = null;
    const load = () => mount(top, () => api(`events/${eventId}/heatmap`), (d) => { data = d; return render(d); });
    root.append(top, h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h2', h('span.dot.ok.pulse', { style: { display: 'inline-block', marginInlineEnd: '8px' } }), t('live.feed')), h('span.small.muted', t('live.feed_hint'))), feed));
    await load();
    const logs = await api('attendance/logs', { query: { subject_type: 'event', subject_id: eventId, size: 40 } }).catch(() => ({ rows: [] }));
    feed.replaceChildren(...(logs.rows.length ? logs.rows.map((l) => feedItem({ direction: l.direction, method: l.method, gate: l.gate, at: l.at, visitor: l })) : [empty(t('dash.no_activity'))]));
    ws.sub(`event:${eventId}`);
    let tmr = null;
    const off = ws.on('attendance', (a) => {
        if (a.subject.id !== eventId || a.subject.type !== 'event') return;
        feed.querySelector('.state')?.remove();
        feed.prepend(feedItem(a));
        while (feed.children.length > 80) feed.lastChild.remove();
        if (data) { data.stats = a.stats; clear(top, render(data)); }
        clearTimeout(tmr);
        tmr = setTimeout(load, 5000);
    });
    const poll = setInterval(load, 60_000);
    return () => { off(); clearTimeout(tmr); clearInterval(poll); };
}

function feedItem(a) {
    const v = a.visitor;
    return h('div.feed-item', h(`div.dir.${a.direction}`, icon(a.direction === 'in' ? 'log-in' : 'log-out')),
        h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 500 } }, pick(v, 'name')), h('div.small.muted', [v.org_name, a.gate, opt('method', a.method)].filter(Boolean).join(' · '))),
        h('span.badge', { class: `badge ${a.direction === 'in' ? 'ok' : 'warn'}` }, a.direction === 'in' ? t('common.in') : t('common.out')),
        h('span.small.faint.num', { style: { width: '64px', textAlign: 'end' } }, fmtTime(a.at)));
}

function render(d) {
    const s = d.stats;
    const cap = d.capacity || 0;
    const pct = cap ? (s.inside / cap) * 100 : 0;
    const f = d.forecast;
    const kpi = (ic, v, l, sub) => h('div.card.kpi', h('div.kpi-ico', icon(ic)), h('div', h('div.kpi-v', v), h('div.kpi-l', l), sub ? h('div.kpi-s', sub) : null));
    const hrs = d.hourly.map((x) => x.hour);
    const firstH = hrs.findIndex((x, i) => d.hourly[i].in || d.hourly[i].out);
    const lastH = 23 - [...d.hourly].reverse().findIndex((x) => x.in || x.out);
    const range = firstH < 0 ? [8, 18] : [Math.max(0, firstH - 1), Math.min(23, lastH + 1)];
    const slice = d.hourly.slice(range[0], range[1] + 1);
    const maxCell = Math.max(1, ...Object.values(d.matrix));
    return h('div',
        h('div.kpis',
            kpi('users', fmtNum(s.inside), t('common.inside'), cap ? fmtPct(Math.round(pct)) + ' ' + t('live.of_capacity') : null),
            kpi('log-in', fmtNum(s.entries), t('common.entries')),
            kpi('log-out', fmtNum(s.exits), t('common.exits')),
            kpi('user-check', fmtNum(s.unique), t('live.unique')),
            f ? kpi('sparkles', fmtNum(f.projected_30m), t('forecast.projected'), `${t(`forecast.${f.level}`)} · ${t('forecast.rate', { n: fmtNum(f.rate_in_per_min) })}`) : null),
        cap ? h('div.card', { style: { marginBottom: '16px' } }, h('div.card-b', h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '8px' } }, h('b', t('live.occupancy')), h('span.num', `${fmtNum(s.inside)} / ${fmtNum(cap)}`)), progress(pct),
            f?.minutes_to_capacity ? h('div.hint-box.warn', { style: { marginTop: '12px' } }, icon('alert'), t('forecast.eta', { m: fmtNum(f.minutes_to_capacity) })) : null)) : null,
        h('div.grid.g2',
            h('div.card', h('div.card-h', h('h2', t('live.hourly'))), h('div.card-b', lineChart({ labels: slice.map((x) => `${String(x.hour).padStart(2, '0')}:00`), series: [{ name: t('common.in'), values: slice.map((x) => x.in) }, { name: t('common.out'), values: slice.map((x) => x.out) }] }))),
            h('div.card', h('div.card-h', h('h2', t('live.zones_now'))), h('div.card-b', d.zones.length ? h('div', { style: { display: 'grid', gap: '10px' } }, d.zones.map((z) => {
                const r = z.capacity ? z.inside / z.capacity : 0;
                return h('div', h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' } }, h('span', h('span.dot', { style: { display: 'inline-block', background: densityColor(r), marginInlineEnd: '6px' } }), pick(z, 'name')), h('span.num.muted', `${fmtNum(z.inside)} / ${fmtNum(z.capacity)}`)), progress(r * 100));
            })) : empty(t('live.no_zones'))))),
        d.zones.length ? h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h2', t('live.heatmap')), h('span.small.muted', t('live.heatmap_hint'))),
            h('div.card-b', { style: { overflowX: 'auto' } }, h('div.heat', { style: { gridTemplateColumns: `140px repeat(${slice.length}, minmax(34px, 1fr))`, minWidth: `${140 + slice.length * 38}px` } },
                h('div'), slice.map((x) => h('div.small.faint', String(x.hour).padStart(2, '0'))),
                d.zones.flatMap((z) => [h('div.small', { style: { justifyContent: 'start', display: 'flex', alignItems: 'center' } }, pick(z, 'name')),
                    ...slice.map((x) => { const v = d.matrix[`${z.id}:${x.hour}`] || 0; return h('div', { title: `${pick(z, 'name')} · ${String(x.hour).padStart(2, '0')}:00 — ${fmtNum(v)}`, style: { background: seqColor(v / maxCell), color: v / maxCell > 0.55 ? '#fff' : 'var(--muted)' } }, v ? fmtNum(v) : ''); })])),
            h('div.legend', { style: { marginTop: '10px' } }, h('span', t('live.low')), ...[0.1, 0.35, 0.6, 0.85, 1].map((x) => h('i', { style: { background: seqColor(x), width: '22px' } })), h('span', t('live.high'))))) : null);
}
void badge;
