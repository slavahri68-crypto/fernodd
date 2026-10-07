// presence.js
import { Client, GatewayIntentBits, Partials } from 'discord.js';

let client = null;
let ready = false;
const presenceCache = new Map();

export function initPresence() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.warn('[presence] DISCORD_BOT_TOKEN не задан — presence отключён');
    return;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
    ],
    partials: [Partials.GuildMember, Partials.User],
  });

  client.once('clientReady', async () => {
    console.log(`[presence] ✅ Бот запущен: ${client.user.tag}`);
    ready = true;

    const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    if (!guild) {
      console.warn('[presence] ❌ Гильдия не найдена. GUILD_ID:', process.env.DISCORD_GUILD_ID);
      console.warn('[presence] Доступные гильдии:', client.guilds.cache.map(g => `${g.name} (${g.id})`).join(', '));
      return;
    }

    console.log(`[presence] Гильдия: ${guild.name}, участников в кэше: ${guild.members.cache.size}`);

    // ★ Ждём 3 секунды — Discord успевает прислать presences
    console.log('[presence] Ждём 3 сек для получения presences...');
    await new Promise(r => setTimeout(r, 3000));

    // ★ Принудительно подгружаем ВСЕХ участников
    try {
      const members = await guild.members.fetch();
      console.log(`[presence] Загружено участников: ${members.size}`);

      members.forEach(m => {
        presenceCache.set(m.id, {
          status: m.presence?.status || 'offline',
          activities: m.presence ? extractActivities(m.presence) : [],
          updatedAt: Date.now(),
        });
      });

      let online = 0, idle = 0, dnd = 0;
      presenceCache.forEach(v => {
        if (v.status === 'online') online++;
        else if (v.status === 'idle') idle++;
        else if (v.status === 'dnd') dnd++;
      });

      console.log(`[presence] Кэш: ${presenceCache.size} | 🟢 ${online} | 🟡 ${idle} | 🔴 ${dnd}`);

      if (online + idle + dnd === 0) {
        console.warn('[presence] ⚠️ Все offline! Проверь PRESENCE INTENT в Developer Portal.');
      }
    } catch (e) {
      console.error('[presence] fetch members error:', e.message);
    }
  });

  // Также оставляем on('ready') как fallback для v14
  client.once('ready', () => {
    if (!ready) {
      // в v15 не сработает, но для совместимости
      console.log('[presence] ready event (legacy)');
    }
  });

  client.on('presenceUpdate', (oldP, newP) => {
    if (!newP) return;
    presenceCache.set(newP.userId, {
      status: newP.status || 'offline',
      activities: extractActivities(newP),
      updatedAt: Date.now(),
    });
  });

  client.on('guildMemberAdd', (m) => {
    presenceCache.set(m.id, { status: 'offline', activities: [], updatedAt: Date.now() });
  });

  client.on('guildMemberRemove', (m) => {
    presenceCache.delete(m.id);
  });

  client.on('error', (e) => console.error('[presence] error:', e));
  client.on('shardDisconnect', () => { ready = false; });
  client.on('shardReconnecting', () => { ready = false; });
  client.on('shardResume', () => { ready = true; });

  client.login(process.env.DISCORD_BOT_TOKEN).catch(e => {
    console.error('[presence] login error:', e.message);
  });
}

function extractActivities(presence) {
  if (!presence.activities || !presence.activities.length) return [];
  return presence.activities.map(a => ({
    name: a.name,
    type: a.type,
    details: a.details || '',
    state: a.state || '',
    url: a.url || '',
    applicationId: a.applicationId || '',
  }));
}

export function isPresenceReady() { return ready; }

export function getPresence(userId) {
  return presenceCache.get(userId) || {
    status: 'offline',
    activities: [],
    updatedAt: Date.now(),
  };
}

export function getAllPresence() {
  const out = {};
  presenceCache.forEach((v, k) => { out[k] = v; });
  return out;
}

export function getPresenceStats() {
  let online = 0, idle = 0, dnd = 0, offline = 0;
  presenceCache.forEach(v => {
    if (v.status === 'online') online++;
    else if (v.status === 'idle') idle++;
    else if (v.status === 'dnd') dnd++;
    else offline++;
  });
  return { online, idle, dnd, offline, total: presenceCache.size, ready };
}