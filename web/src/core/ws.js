// تنظيم — اتصال لحظي واحد يعيد الاتصال تلقائياً ويعيد الاشتراك بالقنوات.
export function connect({ query = '', onStatus } = {}) {
    let ws = null, alive = false, retry = 0, closed = false;
    const channels = new Set();
    const handlers = new Map();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    function open() {
        ws = new WebSocket(`${proto}://${location.host}/ws${query ? `?${query}` : ''}`);
        ws.onopen = () => { alive = true; retry = 0; onStatus?.(true); if (channels.size) ws.send(JSON.stringify({ type: 'sub', channels: [...channels] })); };
        ws.onmessage = (e) => {
            let m; try { m = JSON.parse(e.data); } catch { return; }
            for (const fn of handlers.get(m.type) || []) fn(m.data, m);
            for (const fn of handlers.get('*') || []) fn(m.data, m);
        };
        ws.onclose = (e) => {
            alive = false; onStatus?.(false);
            if (closed || e.code === 4001) return;
            setTimeout(open, Math.min(15000, 800 * 2 ** retry++));
        };
        ws.onerror = () => ws.close();
    }
    open();
    const ping = setInterval(() => { if (alive) ws.send(JSON.stringify({ type: 'ping' })); }, 25000);
    return {
        sub(...chs) { chs.forEach((c) => channels.add(c)); if (alive) ws.send(JSON.stringify({ type: 'sub', channels: chs })); },
        unsub(...chs) { chs.forEach((c) => channels.delete(c)); if (alive) ws.send(JSON.stringify({ type: 'unsub', channels: chs })); },
        on(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); return () => handlers.get(type).delete(fn); },
        send(m) { if (alive) ws.send(JSON.stringify(m)); },
        get alive() { return alive; },
        close() { closed = true; clearInterval(ping); ws?.close(); },
    };
}
