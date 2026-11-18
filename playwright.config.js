// تنظيم — اختبارات المتصفح للتدفقات الحرجة. محلياً بمتصفح النظام: CHROME_PATH=/usr/bin/google-chrome npx playwright test
import { defineConfig } from '@playwright/test';

const PORT = 4567;
export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 60_000,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: `http://localhost:${PORT}`,
        viewport: { width: 1366, height: 860 },
        permissions: ['camera'],
        launchOptions: { executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: `rm -f /tmp/tanzeem-e2e.sqlite* /tmp/tanzeem-e2e.secret && DB_FILE=/tmp/tanzeem-e2e.sqlite PORT=${PORT} PUBLIC_URL=http://localhost:${PORT} SEED_DEMO=1 DEMO_PASSWORD=E2e-Pass-2026! APP_SECRET=e2e-secret-e2e-secret-e2e-secret-0001 NODE_NO_WARNINGS=1 node server/index.js`,
        url: `http://localhost:${PORT}/healthz`,
        reuseExistingServer: false,
        timeout: 30_000,
    },
});
