import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// صفحات متعددة: كل واجهة بحزمتها (الكشك وتطبيق الجوال خفيفان)، وصفحات اللوحة تُحمَّل عند الطلب.
export default defineConfig({
    root: 'web',
    publicDir: 'public',
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        target: 'es2020',
        chunkSizeWarningLimit: 900,
        rollupOptions: { input: Object.fromEntries(['index', 'login', 'app', 'kiosk', 'm', 'docs', '404'].map((p) => [p, resolve('web', `${p}.html`)])) },
    },
    server: { proxy: { '/api': 'http://localhost:3000', '/auth': 'http://localhost:3000', '/healthz': 'http://localhost:3000', '/ws': { target: 'ws://localhost:3000', ws: true } } },
});
