// تنظيم — جدول بيانات موحّد: بحث، فلاتر، ترتيب، ترقيم، تصدير، تحديد متعدد، وحالات التحميل والفراغ والخطأ.
import { h, icon, clear, debounce } from '../../core/dom.js';
import { t, fmtNum } from '../../core/i18n.js';
import { api, downloadFrom } from '../../core/api.js';
import { loading, empty, errorState, popover } from '../../core/ui.js';

export function dataTable(o) {
    const st = { q: '', sort: o.sort || null, dir: o.dir || null, page: 1, size: o.pageSize || 25, filters: { ...(o.initialFilters || {}) }, rows: [], total: 0, selected: new Set() };
    const body = h('div.tbl-wrap');
    const pager = h('div.pager');
    const searchInput = o.search === false ? null : h('input.input.grow', { type: 'search', placeholder: o.searchPlaceholder || t('common.search_placeholder'), 'aria-label': t('common.search'), on: { input: debounce((e) => { st.q = e.target.value.trim(); st.page = 1; load(); }, 300) } });
    const filterEls = (o.filters || []).map((f) => {
        if (f.type === 'date') return h('input.input', { type: 'date', 'aria-label': f.label, title: f.label, on: { change: (e) => { st.filters[f.key] = e.target.value; st.page = 1; load(); } } });
        return h('select.select', { 'aria-label': f.label, on: { change: (e) => { st.filters[f.key] = e.target.value; st.page = 1; load(); } } },
            h('option', { value: '' }, `${f.label}: ${t('common.all')}`), f.options.map((x) => h('option', { value: x.value, selected: String(st.filters[f.key] ?? '') === String(x.value) }, x.label)));
    });
    const exportBtn = o.exportResource || o.onExport ? h('button.btn.sm', { type: 'button', on: { click: (e) => {
        popover(e.currentTarget, [
            h('button', { type: 'button', on: { click: () => doExport('xlsx') } }, icon('download'), t('common.export_xlsx')),
            h('button', { type: 'button', on: { click: () => doExport('csv') } }, icon('download'), t('common.export_csv')),
            o.printable !== false ? h('button', { type: 'button', on: { click: () => window.print() } }, icon('printer'), t('common.export_pdf')) : null,
        ]);
    } } }, icon('download'), t('common.export')) : null;
    const bulkBar = h('div.actions', { style: { display: 'none' } });
    const toolbar = h('div.toolbar', searchInput, filterEls, o.toolbar || null, h('div', { style: { marginInlineStart: 'auto' } }, h('div.actions', bulkBar, exportBtn, h('button.btn.sm.icon', { type: 'button', title: t('common.refresh'), 'aria-label': t('common.refresh'), on: { click: () => load() } }, icon('refresh')))));
    const el = h('div.card', o.title ? h('div.card-h', h('h2', o.title), o.headerActions || null) : null, toolbar, body, pager);

    async function doExport(format) {
        try {
            if (o.onExport) return await o.onExport(format, params());
            const labels = Object.fromEntries((o.columns || []).filter((c) => c.key).map((c) => [c.key, c.label]));
            await downloadFrom(`/api/v1/${o.exportResource}/export`, { ...params(), format, labels: JSON.stringify(labels), page: undefined, size: undefined });
        } catch (e) { (await import('../../core/ui.js')).toastErr(e); }
    }
    function params() {
        const p = { ...(o.query || {}), q: st.q || undefined, page: st.page, size: st.size, sort: st.sort || undefined, dir: st.dir || undefined };
        for (const [k, v] of Object.entries(st.filters)) if (v !== '' && v != null) p[k] = v;
        return p;
    }
    let seq = 0;
    async function load() {
        const my = ++seq;
        if (!st.rows.length) clear(body, loading());
        else body.style.opacity = '.55';
        try {
            const res = o.fetch ? await o.fetch(params()) : await api(o.resource, { query: params() });
            if (my !== seq) return;
            st.rows = res.rows || [];
            st.total = res.total ?? st.rows.length;
            o.onData?.(res);
            render();
        } catch (e) {
            if (my !== seq) return;
            clear(body, errorState(e, load));
            pager.replaceChildren();
        } finally { body.style.opacity = ''; }
    }
    function sortBy(c) {
        const k = typeof c.sort === 'string' ? c.sort : c.key;
        if (st.sort === k) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sort = k; st.dir = 'asc'; }
        load();
    }
    function render() {
        if (!st.rows.length) {
            clear(body, empty(st.q || Object.values(st.filters).some(Boolean) ? t('common.no_results') : o.emptyTitle || t('common.empty'), o.emptyText, !st.q && o.emptyAction ? o.emptyAction : null));
            pager.replaceChildren();
            return;
        }
        const cols = o.columns;
        const allSel = st.rows.every((r) => st.selected.has(r.id));
        const thead = h('thead', h('tr',
            o.selectable ? h('th.cb', h('input', { type: 'checkbox', 'aria-label': t('common.select_all'), checked: allSel, on: { change: (e) => { st.rows.forEach((r) => (e.target.checked ? st.selected.add(r.id) : st.selected.delete(r.id))); render(); sel(); } } })) : null,
            cols.map((c) => {
                const k = typeof c.sort === 'string' ? c.sort : c.key;
                const sorted = c.sort && st.sort === k;
                return h(`th${c.sort ? '.sortable' : ''}${sorted ? '.sorted' : ''}`, { scope: 'col', style: c.width ? { width: c.width } : null, 'aria-sort': sorted ? (st.dir === 'asc' ? 'ascending' : 'descending') : null, tabindex: c.sort ? '0' : null, on: c.sort ? { click: () => sortBy(c), keydown: (e) => { if (e.key === 'Enter') sortBy(c); } } : {} },
                    c.label, c.sort ? h('span.arrow', sorted ? (st.dir === 'asc' ? '▲' : '▼') : '↕') : null);
            }),
            o.actions ? h('th', { scope: 'col' }, h('span.sr-only', t('common.actions'))) : null));
        const tbody = h('tbody', st.rows.map((r) => h(`tr${o.rowClick ? '.clickable' : ''}${st.selected.has(r.id) ? '.selected' : ''}`, { on: o.rowClick ? { click: (e) => { if (!e.target.closest('button,a,input,select')) o.rowClick(r); } } : {} },
            o.selectable ? h('td.cb', h('input', { type: 'checkbox', 'aria-label': t('common.select'), checked: st.selected.has(r.id), on: { change: (e) => { e.target.checked ? st.selected.add(r.id) : st.selected.delete(r.id); e.target.closest('tr').classList.toggle('selected', e.target.checked); sel(); } } })) : null,
            cols.map((c) => h('td', { class: c.class || '' }, c.render ? c.render(r) : (r[c.key] ?? '—'))),
            o.actions ? h('td.actions-cell', o.actions(r)) : null)));
        clear(body, h('table.tbl', thead, tbody));
        const pages = Math.max(1, Math.ceil(st.total / st.size));
        pager.replaceChildren(
            h('div', t('common.showing', { from: fmtNum((st.page - 1) * st.size + 1), to: fmtNum(Math.min(st.page * st.size, st.total)), total: fmtNum(st.total) })),
            h('div.pages',
                h('select.select', { style: { height: '30px', width: 'auto' }, 'aria-label': t('common.page_size'), on: { change: (e) => { st.size = Number(e.target.value); st.page = 1; load(); } } }, [10, 25, 50, 100].map((n) => h('option', { value: n, selected: n === st.size }, fmtNum(n)))),
                h('button.btn.xs.icon', { type: 'button', disabled: st.page <= 1, 'aria-label': t('common.prev'), on: { click: () => { st.page--; load(); } } }, icon(document.dir === 'rtl' ? 'chevron-right' : 'chevron-left')),
                h('span', `${fmtNum(st.page)} / ${fmtNum(pages)}`),
                h('button.btn.xs.icon', { type: 'button', disabled: st.page >= pages, 'aria-label': t('common.next'), on: { click: () => { st.page++; load(); } } }, icon(document.dir === 'rtl' ? 'chevron-left' : 'chevron-right'))));
    }
    function sel() {
        if (!o.bulkActions) return o.onSelect?.([...st.selected]);
        const ids = [...st.selected];
        bulkBar.style.display = ids.length ? 'flex' : 'none';
        bulkBar.replaceChildren(h('span.small.muted', t('common.selected_n', { n: fmtNum(ids.length) })), o.bulkActions(ids, () => { st.selected.clear(); render(); sel(); }));
        o.onSelect?.(ids);
    }
    load();
    return { el, reload: load, selected: () => [...st.selected], clearSelection() { st.selected.clear(); render(); sel(); }, rows: () => st.rows, setFilter(k, v) { st.filters[k] = v; st.page = 1; load(); } };
}
