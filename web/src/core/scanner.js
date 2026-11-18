// تنظيم — مسح QR بالكاميرا: BarcodeDetector إن وُجد، وإلا jsQR. يعمل أيضاً مع الماسحات اليدوية (لوحة مفاتيح) عبر حقل الإدخال.
import { h } from './dom.js';

export async function startScanner(container, onCode, { facing = 'environment' } = {}) {
    const video = h('video', { playsinline: true, muted: true, autoplay: true, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } });
    const frame = h('div', { style: { position: 'absolute', inset: '18%', border: '3px solid rgba(255,255,255,.85)', borderRadius: '16px', boxShadow: '0 0 0 2000px rgba(0,0,0,.25)' } });
    container.replaceChildren(h('div', { style: { position: 'relative', width: '100%', height: '100%', background: '#000', borderRadius: '14px', overflow: 'hidden' } }, video, frame));
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false });
    video.srcObject = stream;
    await video.play().catch(() => {});
    let detector = null;
    if ('BarcodeDetector' in window) { try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; } }
    let jsQR = null;
    if (!detector) jsQR = (await import('jsqr')).default;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let stopped = false, last = '', lastAt = 0;
    async function loop() {
        if (stopped) return;
        if (video.readyState >= 2) {
            let code = null;
            try {
                if (detector) { const r = await detector.detect(video); code = r[0]?.rawValue || null; }
                else {
                    const w = 480, hh = Math.round((video.videoHeight / video.videoWidth) * w) || 360;
                    canvas.width = w; canvas.height = hh;
                    ctx.drawImage(video, 0, 0, w, hh);
                    const img = ctx.getImageData(0, 0, w, hh);
                    code = jsQR(img.data, w, hh, { inversionAttempts: 'dontInvert' })?.data || null;
                }
            } catch { /* إطار تالف */ }
            if (code && (code !== last || Date.now() - lastAt > 3000)) { last = code; lastAt = Date.now(); onCode(code); }
        }
        setTimeout(loop, detector ? 120 : 180);
    }
    loop();
    return () => { stopped = true; stream.getTracks().forEach((tr) => tr.stop()); };
}

/** التقاط صورة من الكاميرا (الكشك) */
export async function capturePhoto(container) {
    const video = h('video', { playsinline: true, muted: true, autoplay: true, style: { width: '100%', borderRadius: '16px', transform: 'scaleX(-1)' } });
    container.replaceChildren(video);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 } }, audio: false });
    video.srcObject = stream;
    await video.play().catch(() => {});
    return {
        snap() {
            const c = document.createElement('canvas');
            const side = Math.min(video.videoWidth, video.videoHeight);
            c.width = 480; c.height = 600;
            const sw = side * 0.8, sh = sw * 1.25;
            c.getContext('2d').drawImage(video, (video.videoWidth - sw) / 2, Math.max(0, (video.videoHeight - sh) / 2), sw, Math.min(sh, video.videoHeight), 0, 0, 480, 600);
            return c.toDataURL('image/jpeg', 0.82);
        },
        stop() { stream.getTracks().forEach((tr) => tr.stop()); },
    };
}
