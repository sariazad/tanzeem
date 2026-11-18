// تنظيم — الملف الشخصي: اللغة، تغيير كلمة المرور، والتحقق الثنائي (TOTP).
import { h, icon, clear } from '../../core/dom.js';
import { t, setLang, getLang, opt } from '../../core/i18n.js';
import { api, post } from '../../core/api.js';
import { toast, errText, dialog, confirm } from '../../core/ui.js';
import { qrEl } from '../../core/qr.js';
import { pageHead } from '../main.js';

export default async function profile({ root, me }) {
    const cur = h('input.input', { type: 'password', autocomplete: 'current-password' });
    const next = h('input.input', { type: 'password', autocomplete: 'new-password' });
    const next2 = h('input.input', { type: 'password', autocomplete: 'new-password' });
    const mfaBox = h('div');
    const drawMfa = () => clear(mfaBox, me.mfa_enabled
        ? h('div', h('div.hint-box.ok', icon('shield'), t('profile.mfa_on')), h('button.btn.sm.danger', { type: 'button', style: { marginTop: '12px' }, on: { click: async () => { if (await confirm(t('profile.mfa_disable_confirm'), { danger: true })) { await post('auth/mfa/disable'); me.mfa_enabled = false; drawMfa(); } } } }, t('profile.mfa_disable')))
        : h('div', h('p.muted', t('profile.mfa_hint')), h('button.btn.primary', { type: 'button', on: { click: enroll } }, icon('shield'), t('profile.mfa_enable'))));
    async function enroll() {
        const s = await post('auth/mfa/setup');
        const code = h('input.input', { inputmode: 'numeric', maxlength: 6, dir: 'ltr', style: { fontSize: '20px', letterSpacing: '6px', textAlign: 'center' }, autocomplete: 'one-time-code' });
        await dialog({ title: t('profile.mfa_enable'), size: 'narrow', body: h('div', { style: { textAlign: 'center', display: 'grid', gap: '12px', justifyItems: 'center' } }, h('p.muted', t('profile.mfa_scan')), qrEl(s.uri, 200), h('div.mono.small', s.secret), code), footer: [
            { label: t('common.cancel'), value: null },
            { label: t('profile.verify'), kind: 'primary', onClick: async (close) => { try { await post('auth/mfa/verify', { code: code.value }); me.mfa_enabled = true; toast(t('profile.mfa_on'), 'ok'); drawMfa(); close(true); } catch (e) { toast(errText(e), 'bad'); } } }] });
    }
    drawMfa();
    root.append(pageHead(t('top.profile'), me.email),
        me.must_change_password ? h('div.hint-box.warn', { style: { marginBottom: '16px' } }, icon('alert'), t('profile.must_change')) : null,
        h('div.grid.g2',
            h('div.card', h('div.card-h', h('h2', t('profile.account'))), h('div.card-b', h('dl.kv', h('dt', t('f.name')), h('dd', me.name), h('dt', t('f.email')), h('dd.mono', me.email), h('dt', t('f.source')), h('dd', opt('user_source', me.source)), h('dt', t('users.roles')), h('dd', me.roles.map((r) => t(`role.${r.role}`)).join(t('common.sep')))),
                h('div.field', { style: { marginTop: '16px' } }, h('label', t('top.lang')), h('div.btn-group', [['ar', 'العربية'], ['en', 'English']].map(([l, n]) => h('button', { type: 'button', class: getLang() === l ? 'on' : '', on: { click: () => setLang(l) } }, n)))))),
            h('div.card', h('div.card-h', h('h2', t('profile.mfa'))), h('div.card-b', mfaBox)),
            me.source === 'local' ? h('div.card', h('div.card-h', h('h2', t('profile.password'))), h('div.card-b', { style: { display: 'grid', gap: '12px' } },
                h('div.field', h('label', t('profile.current')), cur), h('div.field', h('label', t('profile.new')), next, h('div.hint', t('users.password_policy'))), h('div.field', h('label', t('profile.confirm')), next2),
                h('button.btn.primary', { type: 'button', style: { justifySelf: 'start' }, on: { click: async () => {
                    if (next.value !== next2.value) return toast(t('profile.mismatch'), 'bad');
                    try { await post('auth/password', { current: cur.value, next: next.value }); toast(t('profile.changed'), 'ok'); cur.value = next.value = next2.value = ''; if (me.must_change_password) location.href = '/app'; } catch (e) { toast(e.code === 'weak_password' ? t('errors.weak_password') : errText(e), 'bad'); }
                } } }, icon('save'), t('profile.change')))) : null));
    void api;
}
