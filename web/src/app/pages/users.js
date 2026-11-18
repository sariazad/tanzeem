// تنظيم — المستخدمون والأدوار: الحسابات (محلية أو من AD/SSO) وحالتها، الأدوار ومصفوفة الصلاحيات بنطاق، الجلسات النشطة، وإجبار تسجيل الخروج.
import { h, icon, clear } from '../../core/dom.js';
import { t, fmtAgo, fmtDateTime, opt, fmtNum, pick } from '../../core/i18n.js';
import { api, post, put, del } from '../../core/api.js';
import { badge, dialog, toast, errText, confirm, copy, mount, popover, avatar } from '../../core/ui.js';
import { dataTable } from '../components/table.js';
import { refOptions, fieldInput } from '../components/form.js';
import { pageHead } from '../main.js';

const TABS = ['users', 'roles', 'sessions'];

export default async function users({ root, params, can, navigate, me }) {
    const tab = TABS.includes(params[0]) ? params[0] : 'users';
    const body = h('div');
    root.append(pageHead(t('nav.users'), t('users.subtitle'), tab === 'users' && can('users', 'create') ? [h('button.btn.primary', { type: 'button', on: { click: () => editUser(null).then((r) => r && reload()) } }, icon('plus'), t('users.new'))] : tab === 'roles' && can('users', 'create') ? [h('button.btn.primary', { type: 'button', on: { click: () => editRole(null).then((r) => r && reload()) } }, icon('plus'), t('users.new_role'))] : null),
    h('nav.tabs', TABS.map((k) => h('a', { href: `/app/users/${k}`, class: k === tab ? 'active' : '' }, icon({ users: 'users', roles: 'shield', sessions: 'activity' }[k]), t(`users.tab_${k}`)))), body);
    let reload = () => {};
    const rolesData = await api('roles');

    if (tab === 'users') {
        const tbl = dataTable({
            resource: 'users',
            filters: [{ key: 'f_status', label: t('f.status'), options: ['active', 'disabled'].map((s) => ({ value: s, label: opt('user_status', s) })) }, { key: 'f_source', label: t('f.source'), options: ['local', 'ldap', 'oidc'].map((s) => ({ value: s, label: opt('user_source', s) })) }],
            columns: [
                { key: 'name', label: t('f.name'), sort: true, render: (u) => h('div.cell-person', avatar(u.name), h('div', h('div.cell-main', u.name), h('div.cell-sub.mono', u.email))) },
                { key: 'roles', label: t('users.roles'), render: (u) => h('div.actions', u.roles.map((r) => h('span.chip', `${pick(r, 'name')}${r.scope_type !== 'all' ? ` · ${t(`scope.${r.scope_type}`)} #${r.scope_id}` : ''}`))) },
                { key: 'source', label: t('f.source'), render: (u) => h('span.chip', opt('user_source', u.source)) },
                { key: 'status', label: t('f.status'), sort: true, render: (u) => h('div.actions', badge('user_status', u.locked ? 'locked' : u.status), u.mfa_enabled ? h('span.badge.primary.plain', icon('shield'), 'MFA') : null) },
                { key: 'last_login', label: t('users.last_login'), sort: true, render: (u) => h('span.small', u.last_login ? fmtAgo(u.last_login.replace(' ', 'T') + 'Z') : '—') },
            ],
            rowClick: can('users', 'update') ? (u) => editUser(u).then((r) => r && tbl.reload()) : null,
            actions: can('users', 'update') ? (u) => [h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.more'), on: { click: (e) => popover(e.currentTarget, [
                h('button', { type: 'button', on: { click: () => editUser(u).then((r) => r && tbl.reload()) } }, icon('edit'), t('common.edit')),
                u.locked ? h('button', { type: 'button', on: { click: () => act(`users/${u.id}/unlock`) } }, icon('unlock'), t('users.unlock')) : null,
                u.mfa_enabled ? h('button', { type: 'button', on: { click: () => act(`users/${u.id}/reset-mfa`, t('users.reset_mfa_confirm')) } }, icon('shield'), t('users.reset_mfa')) : null,
                h('button', { type: 'button', on: { click: () => act(`users/${u.id}/logout`, t('users.force_logout_confirm')) } }, icon('log-out'), t('users.force_logout')),
                can('users', 'delete') && u.id !== me.id ? h('button', { type: 'button', on: { click: async () => { if (await confirm(t('users.delete_confirm'), { danger: true })) { await del(`users/${u.id}`); tbl.reload(); } } } }, icon('trash'), t('common.delete')) : null,
            ]) } }, icon('more'))] : null,
        });
        async function act(path, q) { if (q && !(await confirm(q))) return; try { await post(path); toast(t('common.saved'), 'ok'); tbl.reload(); } catch (e) { toast(errText(e), 'bad'); } }
        reload = () => tbl.reload();
        body.append(tbl.el);
    } else if (tab === 'roles') {
        const draw = () => mount(body, () => api('roles'), (r) => h('div', { style: { display: 'grid', gap: '16px' } },
            h('div.card', h('div.card-b.flush', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', t('users.role')), h('th', t('users.users_count')), h('th', t('users.modules_count')), h('th'))),
                h('tbody', r.rows.map((role) => h('tr', h('td', h('b', pick(role, 'name')), role.system ? h('span.chip', { style: { marginInlineStart: '8px' } }, t('users.system_role')) : null, h('div.cell-sub.mono', role.key)), h('td.num', fmtNum(role.users)),
                    h('td', role.permissions['*'] ? t('users.all_perms') : fmtNum(Object.keys(role.permissions).length)),
                    h('td.actions-cell', can('users', 'update') && role.key !== 'super_admin' ? h('button.btn.xs', { type: 'button', on: { click: () => editRole(role).then((x) => x && draw()) } }, icon('sliders'), t('users.edit_perms')) : null,
                        can('users', 'delete') && !role.system ? h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.delete'), on: { click: async () => { if (await confirm(t('common.delete_confirm'), { danger: true })) { await del(`roles/${role.id}`); draw(); } } } }, icon('trash')) : null))))))))));
        reload = draw;
        draw();
    } else {
        const draw = () => mount(body, () => api('sessions'), (r) => h('div.card', h('div.card-b.flush', h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', t('f.name')), h('th', 'IP'), h('th', t('users.device')), h('th', t('users.started')), h('th', t('users.last_activity')), h('th'))),
            h('tbody', r.rows.map((s) => h('tr', h('td', h('div.cell-main', s.name), h('div.cell-sub.mono', s.email)), h('td.mono.small', s.ip || '—'), h('td.small', { title: s.ua }, (s.ua || '').replace(/\(.*?\)/g, '').slice(0, 50)), h('td.small', fmtDateTime(s.created_at)), h('td.small', fmtAgo(s.last_seen)),
                h('td.actions-cell', can('users', 'update') ? h('button.btn.xs.danger', { type: 'button', on: { click: async () => { if (await confirm(t('users.end_session'))) { await del(`sessions/${s.id}`); draw(); } } } }, icon('log-out'), t('users.end')) : null)))))))));
        reload = draw;
        draw();
    }

    async function editUser(u) {
        const values = u || { status: 'active', source: 'local', roles: [] };
        const fields = [
            fieldInput('users', { key: 'name', type: 'text', req: 1 }, values.name),
            fieldInput('users', { key: 'email', type: 'email', req: 1 }, values.email),
            fieldInput('users', { key: 'username', type: 'text' }, values.username),
            fieldInput('users', { key: 'phone', type: 'phone' }, values.phone),
            fieldInput('users', { key: 'org_id', type: 'ref', ref: 'orgs' }, values.org_id),
            fieldInput('users', { key: 'source', type: 'select', opts: ['local', 'ldap', 'oidc'], label: t('f.source') }, values.source),
            fieldInput('users', { key: 'status', type: 'select', opts: ['active', 'disabled'] }, values.status),
            fieldInput('users', { key: 'password', type: 'secret', placeholder: u ? t('common.unchanged') : t('users.auto_password'), hint: t('users.password_policy') }, ''),
        ];
        // تعديل الخيارات المعروضة لنوع الحساب والحالة
        fields[5].input.querySelectorAll('option').forEach((o) => { if (o.value) o.textContent = opt('user_source', o.value); });
        fields[6].input.querySelectorAll('option').forEach((o) => { if (o.value) o.textContent = opt('user_status', o.value); });
        const grants = (values.roles || []).map((r) => ({ role_id: r.role_id, scope_type: r.scope_type, scope_id: r.scope_id }));
        const rolesBox = h('div');
        const [orgs, events] = await Promise.all([refOptions('orgs'), refOptions('events')]);
        const drawRoles = () => clear(rolesBox, ...grants.map((g, i) => h('div', { style: { display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.4fr auto', gap: '8px', marginBottom: '8px' } },
            h('select.select', { 'aria-label': t('users.role'), on: { change: (e) => { g.role_id = Number(e.target.value); } } }, rolesData.rows.map((r) => h('option', { value: r.id, selected: r.id === g.role_id }, pick(r, 'name')))),
            h('select.select', { 'aria-label': t('users.scope'), on: { change: (e) => { g.scope_type = e.target.value; g.scope_id = null; drawRoles(); } } }, ['all', 'org', 'event'].map((s) => h('option', { value: s, selected: s === g.scope_type }, t(`scope.${s}`)))),
            g.scope_type === 'all' ? h('div') : h('select.select', { 'aria-label': t('users.scope'), on: { change: (e) => { g.scope_id = Number(e.target.value); } } }, h('option', { value: '' }, '—'), (g.scope_type === 'org' ? orgs : events).map((o) => h('option', { value: o.value, selected: o.value === g.scope_id }, o.label))),
            h('button.btn.icon.ghost', { type: 'button', 'aria-label': t('common.remove'), on: { click: () => { grants.splice(i, 1); drawRoles(); } } }, icon('trash')))),
        h('button.btn.sm', { type: 'button', on: { click: () => { grants.push({ role_id: rolesData.rows.find((r) => r.key === 'reception')?.id || rolesData.rows[0].id, scope_type: 'all', scope_id: null }); drawRoles(); } } }, icon('plus'), t('users.add_role')));
        drawRoles();
        return dialog({ title: u ? t('users.edit') : t('users.new'), size: 'wide', body: h('div', h('div.form-grid', fields.map((f) => f.el)), h('div.label', { style: { margin: '18px 0 8px' } }, t('users.roles_scopes')), rolesBox), footer: [
            { label: t('common.cancel'), value: null },
            { label: t('common.save'), kind: 'primary', icon: 'save', onClick: async (close) => {
                const body = Object.fromEntries(fields.map((f) => [f.key, f.get()]).filter(([, v]) => v !== undefined));
                body.roles = grants.filter((g) => g.scope_type === 'all' || g.scope_id);
                try {
                    const r = u ? await put(`users/${u.id}`, body) : await post('users', body);
                    toast(t('common.saved'), 'ok');
                    if (r.temp_password) await dialog({ title: t('users.temp_password'), size: 'narrow', body: h('div', h('p.muted', t('users.temp_password_hint')), h('div.mono', { style: { fontSize: '20px', fontWeight: 700, margin: '12px 0' } }, r.temp_password), h('button.btn.sm', { type: 'button', on: { click: () => copy(r.temp_password) } }, icon('copy'), t('common.copy'))) });
                    close(r);
                } catch (e) { for (const f of fields) f.setError(null); for (const er of e.errors || []) fields.find((f) => f.key === er.field)?.setError(er.code); if (!e.errors?.length) toast(errText(e), 'bad'); }
            } }] });
    }

    async function editRole(role) {
        const perms = JSON.parse(JSON.stringify(role?.permissions || {}));
        const nameAr = h('input.input', { value: role?.name_ar || '' });
        const nameEn = h('input.input', { value: role?.name_en || '', dir: 'ltr' });
        const { modules, actions } = rolesData;
        const has = (m, a) => perms[m]?.includes(a) || perms[m]?.includes('*');
        const matrix = h('table.tbl.matrix', h('thead', h('tr', h('th', t('users.module')), actions.map((a) => h('th', t(`action.${a}`))), h('th', t('common.all')))),
            h('tbody', modules.map((m) => h('tr', h('td', t(`nav.${m}`)), actions.map((a) => h('td', h('input', { type: 'checkbox', 'aria-label': `${t(`nav.${m}`)} — ${t(`action.${a}`)}`, checked: has(m, a), on: { change: (e) => { perms[m] = (perms[m] || []).filter((x) => x !== a && x !== '*'); if (e.target.checked) perms[m].push(a); } } }))),
                h('td', h('input', { type: 'checkbox', 'aria-label': t('common.all'), checked: actions.every((a) => has(m, a)), on: { change: (e) => { perms[m] = e.target.checked ? [...actions] : []; e.target.closest('tr').querySelectorAll('td:not(:last-child) input').forEach((c) => { c.checked = e.target.checked; }); } } }))))));
        return dialog({ title: role ? t('users.edit_role', { name: pick(role, 'name') }) : t('users.new_role'), size: 'wide', body: h('div', h('div.form-grid', h('div.field', h('label', t('f.name_ar')), nameAr), h('div.field', h('label', t('f.name_en')), nameEn)), h('div.hint-box', { style: { margin: '14px 0' } }, icon('info'), t('users.scope_hint')), h('div.tbl-wrap', matrix)), footer: [
            { label: t('common.cancel'), value: null },
            { label: t('common.save'), kind: 'primary', icon: 'save', onClick: async (close) => { try { const body = { name_ar: nameAr.value, name_en: nameEn.value, permissions: perms }; close(role ? await put(`roles/${role.id}`, body) : await post('roles', body)); toast(t('common.saved'), 'ok'); } catch (e) { toast(errText(e), 'bad'); } } }] });
    }
    void navigate;
}
