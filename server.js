import 'dotenv/config';
import { app, initMongo, checkExpiredSubscriptions, notifyDiscordError } from './app.js';
import { initPresence } from './presence.js';

const PORT = process.env.PORT || 3000;

process.on('unhandledRejection', (reason) => { console.error('[bootstrap unhandledRejection]', reason); });
process.on('uncaughtException', (err) => { console.error('[bootstrap uncaughtException]', err); });

initPresence();

initMongo().then(() => {
  setInterval(checkExpiredSubscriptions, 30 * 60 * 1000);
  setTimeout(checkExpiredSubscriptions, 10_000);

  const server = app.listen(PORT, () => {
    console.log(`\n✅ Fernodd API: http://localhost:${PORT}\n`);
  });

  server.on('error', (err) => {
    console.error('[server error]', err);
    notifyDiscordError({ title: 'Ошибка HTTP-сервера', description: err.message, color: 0xef4444, stack: err.stack }).catch(() => {});
  });
}).catch((err) => {
  console.error('[bootstrap initMongo]', err);
  notifyDiscordError({ title: 'Ошибка запуска приложения', description: err.message, color: 0xdc2626, stack: err.stack, extra: { 'Серьёзность': 'КРИТИЧНО' } }).catch(() => {});
  app.listen(PORT, () => { console.log(`\n⚠️ Fernodd API запущен без БД: http://localhost:${PORT}\n`); });
});