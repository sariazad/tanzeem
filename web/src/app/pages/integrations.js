// تنظيم — التكاملات: الهوية الموحدة (SSO/OIDC)، Active Directory، التقويم، الطابعات، البريد والرسائل النصية، Webhooks، الذكاء الاصطناعي، ومفاتيح API.
// لكل تكامل: الحالة وآخر مزامنة، زر «اختبار الاتصال»، وسجل الأخطاء.
import { h, icon, clear } from '../../core/dom.js';
import { t, fmtDateTime, fmtAgo, pick } from '../../core/i18n.js';
import { api, post, put, del } from '../../core/api.js';
import { badge, dialog, toast, errText, confirm, copy, mount, empty } from '../../core/ui.js';
import { pageHead } from '../main.js';

const ICON = { oidc: 'key', ldap: 'users', calendar: 'calendar', smtp: 'mail', sms: 'message', webhook: 'zap', ai: 'sparkles' };
const SPEC = {
    oidc: [['label', 'text'], ['issuer', 'url'], ['client_id', 'text'], ['client_secret', 'secret'], ['scope', 'text', 'openid email profile'], ['default_role', 'role']],
    ldap: [['url', 'url', 'ldaps://dc.example.local:636'], ['bind_dn', 'text', 'CN=svc-tanzeem,OU=Service,DC=example,DC=local'], ['bind_password', 'secret'], ['base_dn', 'text', 'DC=example,DC=local'], ['user_filter', 'text', '(sAMAccountName={u})'], ['domain', 'text'], ['default_role', 'role'], ['insecure_tls', 'bool']],
    smtp: [['host', 'text'], ['port', 'number', '587'], ['user', 'text'], ['password', 'secret'], ['from', 'text', 'Tanzeem <no-reply@example.sa>'], ['insecure_tls', 'bool']],
    sms: [['provider', 'select', ['log', 'http']], ['url', 'url', 'https://sms.example.sa/api/send'], ['method', 'select', ['POST', 'GET']], ['content_type', 'text', 'application/json'], ['auth_header', 'text', 'Authorization'], ['auth_prefix', 'text', 'Bearer '], ['api_key', 'secret'], ['sender', 'text'], ['body_template', 'textarea', '{"to":"{to}","message":"{message}","sender":"{sender}"}']],
    calendar: [],
    webhook: [['url', 'url', 'https://'], ['events', 'events'], ['secret', 'readonly']],
    ai: [['provider', 'select', ['builtin', 'openai_compatible']], ['base_url', 'url', 'http://llm.internal:8000/v1'], ['model', 'text'], ['api_key', 'secret']],
};

export default async function integrations({ root, can }) {
    const body = h('div');
    const keysBox = h('div');
    root.append(pageHead(t('nav.integrations'), t('int.subtitle')), body, keysBox);
    let meta = null, roles = [];
    const load = () => mount(body, async () => { const [r, ro] = await Promise.all([api('integrations'), api('roles').catch(() => ({ rows: [] }))]); roles = ro.rows; return r; }, (r) => {
        meta = r;
        const by = (k) => r.rows.filter((x) => x.kind === k);
        const kinds = ['oidc', 'ldap', 'calendar', 'smtp', 'sms', 'webhook', 'ai'];
        return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: '16px' } },
            kinds.map((k) => {
                const items = by(k);
                return h('div.card', h('div.card-h', h('div.cell-person', h('div.kpi-ico', icon(ICON[k])), h('div', h('h2', t(`int.k_${k}`)), h('div.small.muted', t(`int.d_${k}`)))),
                    can('integrations', 'create') && (k === 'webhook' || !items.length) ? h('button.btn.sm', { type: 'button', on: { click: () => edit(k, null) } }, icon('plus'), t('common.add')) : null),
                h('div', items.length ? items.map((it) => h('div', { style: { padding: '12px 18px', borderTop: '1px solid var(--border)' } },
                    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' } }, h('b', it.name), it.enabled ? badge('integration_status', it.status) : h('span.badge', t('int.disabled'))),
                    h('div.small.muted', { style: { margin: '4px 0 8px' } }, it.last_sync ? t('int.last_sync', { t: fmtAgo(it.last_sync.replace(' ', 'T') + 'Z') }) : t('int.never'), it.last_error ? h('div', { style: { color: 'var(--bad)' } }, it.last_error) : null),
                    k === 'calendar' && it.config.feed_token ? h('div.actions', { style: { marginBottom: '8px' } }, h('span.mono.small', { style: { overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '230px', whiteSpace: 'nowrap' } }, `${location.origin}/api/public/calendar/${it.config.feed_token}.ics`), h('button.btn.xs', { type: 'button', on: { click: () => copy(`${location.origin}/api/public/calendar/${it.config.feed_token}.ics`) } }, icon('copy'))) : null,
                    h('div.actions',
                        can('integrations', 'update') ? h('button.btn.xs', { type: 'button', on: { click: () => test(it) } }, icon('zap'), t('int.test')) : null,
                        h('button.btn.xs', { type: 'button', on: { click: () => logs(it) } }, icon('list'), t('int.logs')),
                        can('integrations', 'update') ? h('button.btn.xs', { type: 'button', on: { click: () => edit(k, it) } }, icon('edit'), t('common.edit')) : null,
                        can('integrations', 'delete') ? h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.delete'), on: { click: async () => { if (await confirm(t('common.delete_confirm'), { danger: true })) { await del(`integrations/${it.id}`); load(); } } } }, icon('trash')) : null)))
                    : [h('div.small.muted', { style: { padding: '14px 18px', borderTop: '1px solid var(--border)' } }, k === 'smtp' ? t('int.smtp_off') : k === 'sms' ? t('int.sms_off') : t('int.not_configured'))]));
            }),
            h('div.card', h('div.card-h', h('div.cell-person', h('div.kpi-ico', icon('printer')), h('div', h('h2', t('int.k_printers')), h('div.small.muted', t('int.d_printers'))))), h('div.card-b', h('a.btn.sm', { href: '/app/devices' }, icon('cpu'), t('kiosk.manage_devices')))));
    });
    async function test(it) {
        let to;
        if (['smtp', 'sms'].includes(it.kind)) {
            const inp = h('input.input', { dir: 'ltr', placeholder: it.kind === 'smtp' ? 'name@example.com' : '05XXXXXXXX' });
            const ok = await dialog({ title: t('int.test'), size: 'narrow', body: h('div.field', h('label', t('int.test_to')), inp, h('div.hint', t('int.test_to_hint'))), footer: [{ label: t('common.cancel'), value: false }, { label: t('int.test'), kind: 'primary', value: true }] });
            if (!ok) return;
            to = inp.value.trim() || undefined;
        }
        toast(t('int.testing'));
        try { const r = await post(`integrations/${it.id}/test`, { to }); toast(`${r.ok ? t('int.test_ok') : t('int.test_fail')}: ${r.message}`, r.ok ? 'ok' : 'bad', 7000); load(); } catch (e) { toast(errText(e), 'bad'); }
    }
    async function logs(it) {
        const b = h('div');
        dialog({ title: `${t('int.logs')} — ${it.name}`, size: 'wide', body: b });
        mount(b, () => api(`integrations/${it.id}/logs`), (r) => h('div', r.rows.length ? h('table.tbl', h('thead', h('tr', h('th', t('audit.when')), h('th', t('audit.action')), h('th', t('f.status')), h('th', t('int.message')))),
            h('tbody', r.rows.map((l) => h('tr', h('td.small', fmtDateTime(l.at.replace(' ', 'T') + 'Z')), h('td.mono.small', l.action), h('td', l.ok ? h('span.badge.ok', 'OK') : h('span.badge.bad', t('int.error'))), h('td.small', l.message))))) : empty(t('int.no_logs')),
        r.deliveries.length ? h('div', { style: { marginTop: '16px' } }, h('h3', t('int.deliveries')), h('table.tbl', h('tbody', r.deliveries.map((d) => h('tr', h('td.mono.small', d.event), h('td', h('span.badge', { class: `badge ${d.status === 'delivered' ? 'ok' : d.status === 'failed' ? 'bad' : 'info'}` }, d.status)), h('td.small', `HTTP ${d.last_status ?? '—'} · ${d.attempts}×`)))))) : null));
    }
    async function edit(kind, it) {
        const cfg = { ...(it?.config || {}) };
        const name = h('input.input', { value: it?.name || t(`int.k_${kind}`) });
        const enabled = h('input', { type: 'checkbox', checked: it ? !!it.enabled : true });
        const fields = SPEC[kind].map(([k, type, extra]) => {
            const label = t(`int.f_${k}`);
            let input;
            if (type === 'bool') { input = h('input', { type: 'checkbox', checked: !!cfg[k], on: { change: (e) => { cfg[k] = e.target.checked; } } }); return h('label.check', input, label); }
            if (type === 'select') input = h('select.select', { on: { change: (e) => { cfg[k] = e.target.value; } } }, extra.map((o) => h('option', { value: o, selected: (cfg[k] ?? extra[0]) === o }, t(`int.o_${o}`) === `int.o_${o}` ? o : t(`int.o_${o}`))));
            else if (type === 'role') input = h('select.select', { on: { change: (e) => { cfg[k] = e.target.value; } } }, roles.filter((r) => r.key !== 'super_admin').map((r) => h('option', { value: r.key, selected: (cfg[k] || 'reception') === r.key }, pick(r, 'name'))));
            else if (type === 'textarea') input = h('textarea.textarea.mono', { dir: 'ltr', placeholder: extra || '', on: { input: (e) => { cfg[k] = e.target.value; } } }, cfg[k] || '');
            else if (type === 'events') input = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px' } }, meta.webhook_events.map((ev) => h('label.check.small', h('input', { type: 'checkbox', checked: (cfg.events || []).includes(ev), on: { change: (e) => { cfg.events = (cfg.events || []).filter((x) => x !== ev); if (e.target.checked) cfg.events.push(ev); } } }), h('span.mono', ev))));
            else if (type === 'readonly') input = h('div', { style: { display: 'flex', gap: '6px' } }, h('input.input.mono', { value: cfg[k] || t('int.auto_generated'), readOnly: true, dir: 'ltr' }));
            else input = h('input.input', { type: type === 'secret' ? 'password' : type === 'number' ? 'number' : 'text', value: cfg[k] ?? '', dir: 'ltr', placeholder: extra || '', autocomplete: 'off', on: { input: (e) => { cfg[k] = e.target.value; } } });
            return h(`div.field${['textarea', 'events'].includes(type) ? '.wide' : ''}`, h('label', label), input);
        });
        return dialog({ title: `${t(`int.k_${kind}`)}`, size: 'wide', body: h('div', { style: { display: 'grid', gap: '14px' } },
            kind === 'oidc' ? h('div.hint-box', icon('info'), h('div', t('int.oidc_hint'), h('div.mono', { style: { marginTop: '4px' } }, `${location.origin}/auth/oidc/callback`))) : null,
            kind === 'sms' ? h('div.hint-box', icon('info'), t('int.sms_hint')) : null,
            kind === 'calendar' ? h('div.hint-box', icon('info'), t('int.calendar_hint')) : null,
            kind === 'webhook' ? h('div.hint-box', icon('info'), t('int.webhook_hint')) : null,
            h('div.form-grid', h('div.field', h('label', t('f.name')), name), h('label.check', { style: { alignSelf: 'end' } }, enabled, t('f.enabled')), fields)), footer: [
            { label: t('common.cancel'), value: null },
            { label: t('common.save'), kind: 'primary', icon: 'save', onClick: async (close) => {
                try { const body = { kind, name: name.value, enabled: enabled.checked, config: cfg }; it ? await put(`integrations/${it.id}`, body) : await post('integrations', body); toast(t('common.saved'), 'ok'); close(true); load(); } catch (e) { toast(errText(e), 'bad'); }
            } }] });
    }

    /* مفاتيح API */
    const loadKeys = () => mount(keysBox, () => api('api-keys'), (r) => h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('div', h('h2', icon('key'), ' ', t('int.api_keys')), h('div.small.muted', t('int.api_keys_hint'))), h('div.actions', h('a.btn.sm', { href: '/docs', target: '_blank' }, icon('file-text'), 'OpenAPI'), can('integrations', 'create') ? h('button.btn.sm.primary', { type: 'button', on: { click: newKey } }, icon('plus'), t('int.new_key')) : null)),
        r.rows.length ? h('table.tbl', h('thead', h('tr', h('th', t('f.name')), h('th', t('int.prefix')), h('th', t('users.role')), h('th', t('int.last_used')), h('th', t('f.status')), h('th'))),
            h('tbody', r.rows.map((k) => h('tr', h('td', k.name), h('td.mono.small', `${k.prefix}…`), h('td', k.role ? t(`role.${k.role}`) : '—'), h('td.small', k.last_used ? fmtAgo(k.last_used.replace(' ', 'T') + 'Z') : '—'), h('td', k.revoked ? h('span.badge.bad', t('int.revoked')) : h('span.badge.ok', t('int.active'))),
                h('td.actions-cell', !k.revoked && can('integrations', 'delete') ? h('button.btn.xs.danger', { type: 'button', on: { click: async () => { if (await confirm(t('int.revoke_confirm'), { danger: true })) { await del(`api-keys/${k.id}`); loadKeys(); } } } }, t('int.revoke')) : null))))) : h('div.card-b', empty(t('int.no_keys')))));
    async function newKey() {
        const name = h('input.input');
        const role = h('select.select', roles.map((r) => h('option', { value: r.id }, pick(r, 'name'))));
        const ok = await dialog({ title: t('int.new_key'), size: 'narrow', body: h('div', { style: { display: 'grid', gap: '12px' } }, h('div.field', h('label', t('f.name')), name), h('div.field', h('label', t('users.role')), role)), footer: [{ label: t('common.cancel'), value: false }, { label: t('common.create'), kind: 'primary', value: true }] });
        if (!ok) return;
        try {
            const r = await post('api-keys', { name: name.value, role_id: Number(role.value) });
            await dialog({ title: t('int.key_created'), body: h('div', h('div.hint-box.warn', icon('alert'), t('int.key_once')), h('div.mono', { style: { margin: '14px 0', wordBreak: 'break-all', fontSize: '14px' } }, r.key), h('button.btn.sm', { type: 'button', on: { click: () => copy(r.key) } }, icon('copy'), t('common.copy'))) });
            loadKeys();
        } catch (e) { toast(errText(e), 'bad'); }
    }
    load();
    loadKeys();
    void clear;
}
