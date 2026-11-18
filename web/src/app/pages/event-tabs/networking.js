// تنظيم — الشبكات الذكية: مؤشرات تفاعل المشاركين، إحصاءات فورية، وتوصيات لربط أصحاب الاهتمامات المشتركة.
import { h, icon } from '../../../core/dom.js';
import { t, fmtNum, fmtPct, pick, opt } from '../../../core/i18n.js';
import { api, post } from '../../../core/api.js';
import { mount, empty, toast, errText, avatar } from '../../../core/ui.js';
import { hbars } from '../../../core/charts.js';

export default async function networking({ root, eventId, can, ws }) {
    const body = h('div');
    root.append(h('div.page-head', h('div', h('h2', t('event.tabs.networking')), h('p', t('net.subtitle')))), body);
    const load = () => mount(body, () => api(`events/${eventId}/networking`), (d) => {
        const kpi = (ic, v, l, sub) => h('div.card.kpi', h('div.kpi-ico', icon(ic)), h('div', h('div.kpi-v', v), h('div.kpi-l', l), sub ? h('div.kpi-s', sub) : null));
        return h('div',
            !d.enabled ? h('div.hint-box.warn', { style: { marginBottom: '16px' } }, icon('info'), t('net.disabled')) : null,
            h('div.kpis',
                kpi('user-check', fmtNum(d.attended), t('event.attended'), t('net.of_registered', { n: fmtNum(d.registered) })),
                kpi('share', fmtNum(d.connections), t('net.connections')),
                kpi('users', fmtNum(d.active_networkers), t('net.active'), fmtPct(d.engagement_rate)),
                kpi('activity', fmtNum(d.avg_connections), t('net.avg'))),
            h('div.grid.g-main',
                h('div.card', h('div.card-h', h('h2', icon('sparkles'), ' ', t('net.recommendations')), h('span.small.muted', t('net.reco_hint'))),
                    h('div.list', d.recommendations.length ? d.recommendations.map((p) => h('div.list-item',
                        person(p.a), h('div', { style: { textAlign: 'center', flex: 'none', width: '110px' } }, h('div', { style: { fontWeight: 700, color: 'var(--primary)' } }, `${fmtNum(p.score)}%`), h('div.small.faint', t('net.match'))), person(p.b),
                        h('div', { style: { flex: 1.2, minWidth: 0 } }, h('div.actions', p.shared.map((s) => h('span.chip', s)))),
                        can('events', 'update') ? h('button.btn.sm', { type: 'button', on: { click: async (e) => { try { await post(`events/${eventId}/networking/connect`, { a: p.a.id, b: p.b.id }); e.target.closest('.list-item').remove(); toast(t('net.connected'), 'ok'); } catch (er) { toast(errText(er), 'bad'); } } } }, icon('link'), t('net.connect')) : null))
                        : [empty(t('net.no_reco'), t('net.no_reco_hint'))])),
                h('div', { style: { display: 'grid', gap: '16px', alignContent: 'start' } },
                    h('div.card', h('div.card-h', h('h2', t('net.interests'))), h('div.card-b', d.top_interests.length ? hbars(d.top_interests.map((x) => ({ label: x.tag, value: x.n }))) : empty())),
                    h('div.card', h('div.card-h', h('h2', t('net.zones'))), h('div.card-b', d.zones.length ? hbars(d.zones.map((z) => ({ label: pick(z, 'name'), value: z.n }))) : empty())),
                    h('div.card', h('div.card-h', h('h2', t('net.orgs'))), h('div.card-b', d.orgs.length ? hbars(d.orgs.map((o) => ({ label: o.org, value: o.n }))) : empty())))));
    });
    const person = (p) => h('div.cell-person', { style: { flex: 1, minWidth: 0 } }, avatar(pick(p, 'name')), h('div', { style: { minWidth: 0 } }, h('a.cell-main', { href: `/app/visitors/${p.id}` }, pick(p, 'name')), h('div.cell-sub', `${p.org_name || ''}${p.inside ? ' · ' + t('common.inside') : ''}`)));
    await load();
    ws.sub(`event:${eventId}`);
    let tmr;
    const off = ws.on('connection', () => { clearTimeout(tmr); tmr = setTimeout(load, 1500); });
    return () => { off(); clearTimeout(tmr); };
}
void opt;
