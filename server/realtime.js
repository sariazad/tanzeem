// تنظيم — التحديث اللحظي عبر WebSocket: قنوات يشترك بها المستخدمون (حسب صلاحياتهم) والأجهزة.
import { WebSocketServer } from 'ws';

/**
 * authorize(req) → { kind:'user'|'device'|'guest', user?, grants?, device?, canSub(channel) } | null
 */
export function createHub({ server, authorize, onDeviceMessage, onDeviceOpen, onDeviceClose, log = () => {} }) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
    const clients = new Set();

    server.on('upgrade', async (req, socket, head) => {
        const url = new URL(req.url, 'http://x');
        if (url.pathname !== '/ws') return socket.destroy();
        let who = null;
        try { who = await authorize(req, url); } catch { who = null; }
        if (!who) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            return socket.destroy();
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            const c = { ws, who, channels: new Set(), alive: true };
            clients.add(c);
            if (who.kind === 'device') {
                c.channels.add(`device:${who.device.id}`);
                onDeviceOpen?.(who.device);
            }
            ws.on('pong', () => { c.alive = true; });
            ws.on('message', (raw) => {
                let msg;
                try { msg = JSON.parse(raw.toString()); } catch { return; }
                if (msg.type === 'sub' && Array.isArray(msg.channels)) {
                    for (const ch of msg.channels.slice(0, 20)) if (who.canSub(String(ch))) c.channels.add(String(ch));
                    ws.send(JSON.stringify({ type: 'subscribed', channels: [...c.channels] }));
                } else if (msg.type === 'unsub' && Array.isArray(msg.channels)) {
                    for (const ch of msg.channels) c.channels.delete(String(ch));
                } else if (msg.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', now: Date.now() }));
                } else if (who.kind === 'device') {
                    try { onDeviceMessage?.(who.device, msg, (m) => ws.send(JSON.stringify(m))); } catch (e) { log('device msg error', e.message); }
                }
            });
            ws.on('close', () => {
                clients.delete(c);
                if (who.kind === 'device') {
                    const stillOpen = [...clients].some((o) => o.who.kind === 'device' && o.who.device.id === who.device.id);
                    if (!stillOpen) onDeviceClose?.(who.device);
                }
            });
            ws.send(JSON.stringify({ type: 'hello', kind: who.kind, now: Date.now() }));
        });
    });

    const beat = setInterval(() => {
        for (const c of clients) {
            if (!c.alive) { c.ws.terminate(); continue; }
            c.alive = false;
            try { c.ws.ping(); } catch { /* ignore */ }
        }
    }, 30_000);

    function publish(channel, type, data) {
        const payload = JSON.stringify({ type, channel, data, at: Date.now() });
        let n = 0;
        for (const c of clients) {
            if (c.channels.has(channel) && c.ws.readyState === 1) { c.ws.send(payload); n++; }
        }
        return n;
    }
    /** إغلاق اتصالات مستخدم (عند إجبار تسجيل الخروج). */
    function kickUser(userId) {
        for (const c of clients) if (c.who.kind === 'user' && c.who.user.id === userId) c.ws.close(4001, 'logged_out');
    }
    const deviceOnline = (id) => [...clients].some((c) => c.who.kind === 'device' && c.who.device.id === id && c.ws.readyState === 1);
    const stats = () => ({ clients: clients.size, devices: [...clients].filter((c) => c.who.kind === 'device').length });
    const close = () => { clearInterval(beat); for (const c of clients) c.ws.terminate(); wss.close(); };
    return { publish, kickUser, deviceOnline, stats, close };
}
