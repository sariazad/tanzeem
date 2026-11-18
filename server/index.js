// تنظيم — تشغيل الخادم:  node server/index.js   (PORT, HOST, DATA_DIR, APP_SECRET, PUBLIC_URL في .env)
import { config } from './config.js';
import { createApp } from './app.js';

const app = createApp();
app.server.listen(config.port, config.host, () => {
    console.log(JSON.stringify({ t: new Date().toISOString(), msg: `tanzeem on http://${config.host}:${config.port}`, public: config.publicUrl }));
});

const stop = () => {
    app.close();
    process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
