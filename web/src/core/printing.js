// تنظيم — طباعة البطاقة من المتصفح بالمقاس الحقيقي (CR80 أو مخصص). مع Chrome بوضع --kiosk-printing تُطبع مباشرة دون نافذة.
export function printSvg(svg, widthMm, heightMm) {
    return new Promise((resolve) => {
        const frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0', insetInlineStart: '-9999px' });
        document.body.appendChild(frame);
        const doc = frame.contentDocument;
        doc.open();
        doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>badge</title><style>@page{size:${widthMm}mm ${heightMm}mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:${widthMm}mm;height:${heightMm}mm}</style></head><body>${svg}</body></html>`);
        doc.close();
        const go = () => {
            frame.contentWindow.focus();
            frame.contentWindow.print();
            setTimeout(() => { frame.remove(); resolve(true); }, 800);
        };
        const imgs = [...doc.images];
        if (doc.fonts?.ready) doc.fonts.ready.then(() => setTimeout(go, imgs.length ? 300 : 100)); else setTimeout(go, 400);
    });
}
