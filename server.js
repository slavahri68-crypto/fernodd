import 'dotenv/config';
import { app, initMongo, checkExpiredSubscriptions } from './app.js';
import { initPresence } from './presence.js';

const PORT = process.env.PORT || 3000;

initPresence();

initMongo().then(() => {
  setInterval(checkExpiredSubscriptions, 30 * 60 * 1000);
  setTimeout(checkExpiredSubscriptions, 10_000);
  app.listen(PORT, () => console.log(`\n✅ Fernodd API: http://localhost:${PORT}\n`));
});