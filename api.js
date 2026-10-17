import serverless from 'serverless-http';
import { app, notifyDiscordError } from '../../app.js';

const serverlessHandler = serverless(app);

export const handler = async (event, context) => {
  try {
    return await serverlessHandler(event, context);
  } catch (err) {
    console.error('[netlify handler]', err);
    notifyDiscordError({
      title: 'Ошибка Netlify-функции',
      description: err?.message || 'Unknown error',
      color: 0xdc2626,
      stack: err?.stack,
      extra: { 'Path': event?.path || '—', 'Method': event?.httpMethod || '—' },
    }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: 'server_error' }) };
  }
};