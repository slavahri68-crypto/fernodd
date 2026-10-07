import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initPresence, getPresence, getAllPresence, getPresenceStats } from './presence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

const IS_RENDER = !!process.env.RENDER;
if (!IS_RENDER) {
  app.use(express.static(__dirname));
}

/* ============ CORS ============ */
const ALLOWED_ORIGINS = [
  'https://fernodd.netlify.app',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:10000'
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* ============ ENV ============ */
const {
  STEAM_API_KEY,
  STEAM_REALM = 'http://localhost:3000',
  STEAM_RETURN_URL = 'http://localhost:3000/auth/steam/callback',
  OWNER_STEAM_ID,
  ADMIN_STEAM_IDS = '',
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID,
  DISCORD_APPLY_CHANNEL_ID,
  DISCORD_LOGS_CHANNEL_ID,
  DISCORD_OPEN_TICKETS_CATEGORY_ID,
  DISCORD_CLOSED_TICKETS_CATEGORY_ID,
  ROLE_CURATOR,
  ROLE_WATCHER,
  ROLE_HEADADMIN,
  ROLE_MODERATOR,
  ROLE_SENIOR_MODERATOR,
  ROLE_CHIEF_MODERATOR,
  FRONTEND_URL = 'http://localhost:3000',
  JWT_SECRET,
  PORT = process.env.PORT || 3000,
  DISCORD_WEBHOOK_URL
} = process.env;

/* ============ СТАРТОВАЯ ДИАГНОСТИКА ============ */
console.log('========================================');
console.log('  FERNODD API STARTUP');
console.log('========================================');
console.log('PORT:                     ', PORT);
console.log('IS_RENDER:                ', IS_RENDER);
console.log('STEAM_API_KEY:            ', STEAM_API_KEY ? '✅ задан' : '❌ НЕ ЗАДАН');
console.log('STEAM_REALM:              ', STEAM_REALM);
console.log('STEAM_RETURN_URL:         ', STEAM_RETURN_URL);
console.log('FRONTEND_URL:             ', FRONTEND_URL);
console.log('OWNER_STEAM_ID:           ', OWNER_STEAM_ID || '❌ не задан');
console.log('JWT_SECRET:               ', JWT_SECRET ? '✅ задан' : '❌ НЕ ЗАДАН');
console.log('DISCORD_BOT_TOKEN:        ', DISCORD_BOT_TOKEN ? '✅ задан' : '❌ не задан');
console.log('DISCORD_GUILD_ID:         ', DISCORD_GUILD_ID || '❌ не задан');
console.log('DISCORD_APPLY_CHANNEL_ID: ', DISCORD_APPLY_CHANNEL_ID || '❌ не задан');
console.log('DISCORD_WEBHOOK_URL:      ', DISCORD_WEBHOOK_URL ? '✅ задан' : '❌ не задан');
console.log('========================================\n');

const ADMIN_ROLES = [ROLE_CURATOR, ROLE_WATCHER, ROLE_HEADADMIN].filter(Boolean);
const MODERATOR_ROLES = [ROLE_MODERATOR, ROLE_SENIOR_MODERATOR, ROLE_CHIEF_MODERATOR].filter(Boolean);
const ALL_STAFF_ROLES = [...ADMIN_ROLES, ...MODERATOR_ROLES];
const ADMIN_STEAM_LIST = ADMIN_STEAM_IDS.split(',').map(s => s.trim()).filter(Boolean);

/* ============ Файлы-хранилища ============ */
const REQUESTS_FILE = path.join(__dirname, 'requests.json');
const HISTORY_FILE = path.join(__dirname, 'requests-history.json');
const OVERRIDE_FILE = path.join(__dirname, 'applications-override.json');
const LINKS_FILE = path.join(__dirname, 'steam-discord-links.json');

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw) ?? fallback;
  } catch (e) {
    console.error(`Ошибка чтения ${file}:`, e);
    return fallback;
  }
}
function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`Ошибка записи ${file}:`, e);
  }
}

function loadRequests() {
  const data = loadJson(REQUESTS_FILE, { changes: [], deletes: [] });
  return { changes: data.changes || [], deletes: data.deletes || [] };
}
function saveRequests(data) { saveJson(REQUESTS_FILE, data); }
function loadHistory() { return loadJson(HISTORY_FILE, []); }
function appendHistory(entry) {
  const list = loadHistory();
  list.unshift(entry);
  if (list.length > 500) list.length = 500;
  saveJson(HISTORY_FILE, list);
}
function loadOverrides() { return loadJson(OVERRIDE_FILE, {}); }
function setOverride(messageId, status) {
  const map = loadOverrides();
  if (status === null || status === undefined) delete map[messageId];
  else map[messageId] = status;
  saveJson(OVERRIDE_FILE, map);
}
function getOverride(messageId) {
  const map = loadOverrides();
  return map[messageId] || null;
}
function loadLinks() { return loadJson(LINKS_FILE, {}); }
function getDiscordIdBySteam(steamId) {
  const links = loadLinks();
  return links[steamId] || null;
}

/* ============ Утилиты ============ */
function getUserFromToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}
function requireAuth(req, res, next) {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  req.user = user; next();
}
function requireAdmin(req, res, next) {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  if (!user.isAdmin) return res.status(403).json({ error: 'forbidden' });
  req.user = user; next();
}
function requireOwner(req, res, next) {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  if (!user.isOwner) return res.status(403).json({ error: 'owner_only' });
  req.user = user; next();
}
function requireHeadAdmin(req, res, next) {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  if (!user.isHeadAdmin && !user.isOwner) return res.status(403).json({ error: 'head_admin_only' });
  req.user = user; next();
}

function isWatcherOrAbove(user) {
  if (!user) return false;
  if (user.isHeadAdmin || user.isOwner) return true;
  return (user.roles || []).some(r => r === 'Следящий');
}
function isHeadAdminOrOwner(user) {
  return !!(user && (user.isHeadAdmin || user.isOwner));
}
function isCurator(user) {
  return !!(user && (user.roles || []).some(r => r === 'Куратор'));
}
function canApproveRequests(u) { return isWatcherOrAbove(u); }
function canChangeDirectly(u) { return isWatcherOrAbove(u); }
function canDeleteDirectly(u) { return isWatcherOrAbove(u); }
function canCreateRequest(u) { return isCurator(u) || isWatcherOrAbove(u); }

/* ============ DISCORD SYNC ============ */
async function applyStatusToDiscord(messageId, newStatus) {
  const channelId = DISCORD_APPLY_CHANNEL_ID;
  const botToken = DISCORD_BOT_TOKEN;
  if (!channelId || !botToken) throw new Error('discord_not_configured');
  setOverride(messageId, newStatus);
  for (const emoji of ['✅', '❌']) {
    try {
      await fetch(
        `https://discord.com/api/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
        { method: 'DELETE', headers: { Authorization: `Bot ${botToken}` } }
      );
    } catch (e) { console.error('[sync]', e); }
  }
  if (newStatus === 'approved' || newStatus === 'rejected') {
    const emoji = newStatus === 'approved' ? '✅' : '❌';
    try {
      await fetch(
        `https://discord.com/api/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
        { method: 'PUT', headers: { Authorization: `Bot ${botToken}` } }
      );
    } catch (e) { console.error('[sync]', e); }
  }
}

async function deleteMessageFromDiscord(messageId) {
  const r = await fetch(
    `https://discord.com/api/channels/${DISCORD_APPLY_CHANNEL_ID}/messages/${messageId}`,
    { method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
  );
  if (!r.ok && r.status !== 204 && r.status !== 404) {
    const t = await r.text().catch(() => '');
    throw new Error(`Не удалось удалить сообщение (${r.status}): ${t}`);
  }
  setOverride(messageId, null);
}

async function getApplicationOwner(messageId) {
  if (!DISCORD_APPLY_CHANNEL_ID) return '—';
  try {
    const r = await fetch(
      `https://discord.com/api/channels/${DISCORD_APPLY_CHANNEL_ID}/messages/${messageId}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!r.ok) return '—';
    const m = await r.json();
    const embed = m.embeds?.[0] || null;
    if (!embed) return '—';
    const f = (embed.fields || []).find(x => x.name === 'Discord');
    return f ? f.value : '—';
  } catch { return '—'; }
}

async function getApplicationStatus(messageId) {
  const override = getOverride(messageId);
  if (override) return override;
  if (!DISCORD_APPLY_CHANNEL_ID) return 'unknown';
  try {
    const r = await fetch(
      `https://discord.com/api/channels/${DISCORD_APPLY_CHANNEL_ID}/messages/${messageId}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!r.ok) return 'unknown';
    const m = await r.json();
    if (m.reactions?.some(x => x.emoji.name === '✅')) return 'approved';
    if (m.reactions?.some(x => x.emoji.name === '❌')) return 'rejected';
    return 'pending';
  } catch { return 'unknown'; }
}

/* ================================================================
   STEAM OPENID 2.0 — БЕЗ БИБЛИОТЕК
   ================================================================ */

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

app.get('/auth/steam', (req, res) => {
  console.log('[steam auth] Старт авторизации');
  console.log('[steam auth] STEAM_API_KEY:', STEAM_API_KEY ? 'задан' : 'НЕ ЗАДАН');
  console.log('[steam auth] STEAM_REALM:', STEAM_REALM);
  console.log('[steam auth] STEAM_RETURN_URL:', STEAM_RETURN_URL);

  if (!STEAM_API_KEY) {
    console.error('[steam auth] ❌ STEAM_API_KEY не задан!');
    return res.redirect(`${FRONTEND_URL}/?error=steam_no_key`);
  }

  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': STEAM_RETURN_URL,
    'openid.realm': STEAM_REALM,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });

  const redirectUrl = `${STEAM_OPENID_URL}?${params.toString()}`;
  console.log('[steam auth] ✅ Редирект на Steam:', redirectUrl);
  res.redirect(redirectUrl);
});

app.get('/auth/steam/callback', async (req, res) => {
  console.log('[steam callback] Получен callback');
  console.log('[steam callback] Query keys:', Object.keys(req.query).join(', '));

  try {
    const claimedId = req.query['openid.claimed_id'];
    if (!claimedId) {
      console.error('[steam callback] ❌ Нет openid.claimed_id');
      return res.redirect(`${FRONTEND_URL}/?error=steam_no_claimed_id`);
    }

    const match = String(claimedId).match(/\/id\/(\d+)$/);
    if (!match) {
      console.error('[steam callback] ❌ Не удалось извлечь Steam ID из', claimedId);
      return res.redirect(`${FRONTEND_URL}/?error=steam_bad_claimed_id`);
    }

    const steamId = match[1];
    console.log('[steam callback] ✅ Steam ID:', steamId);

    /* Валидация подписи */
    const validationParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      validationParams.append(key, value);
    }
    validationParams.set('openid.mode', 'check_authentication');

    const validationRes = await fetch(STEAM_OPENID_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: validationParams.toString(),
    });
    const validationText = await validationRes.text();

    if (!validationText.includes('is_valid:true')) {
      console.error('[steam callback] ❌ Подпись невалидна:', validationText);
      return res.redirect(`${FRONTEND_URL}/?error=steam_invalid_signature`);
    }
    console.log('[steam callback] ✅ Подпись валидна');

    /* Профиль */
    let profile = { steamid: steamId, personaname: 'Steam User', avatar: '' };
    try {
      const r = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`
      );
      const data = await r.json();
      const p = data.response?.players?.[0];
      if (p) {
        profile = {
          steamid: p.steamid,
          personaname: p.personaname,
          avatar: p.avatarfull || p.avatarmedium || p.avatar,
          profileurl: p.profileurl,
          realname: p.realname || '',
        };
      }
      console.log('[steam callback] ✅ Профиль:', profile.personaname);
    } catch (e) {
      console.error('[steam profile]', e);
    }

    /* Права */
    const isOwner = profile.steamid === OWNER_STEAM_ID;
    const isAdmin = isOwner || ADMIN_STEAM_LIST.includes(profile.steamid);
    let isHeadAdmin = isOwner;
    let roleNames = [];

    const linkedDiscordId = getDiscordIdBySteam(profile.steamid);
    if (linkedDiscordId && DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
      try {
        const memberRes = await fetch(
          `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${linkedDiscordId}`,
          { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
        );
        if (memberRes.ok) {
          const member = await memberRes.json();
          const userRoles = member.roles || [];
          isAdmin = isAdmin || userRoles.some(r => ADMIN_ROLES.includes(r));
          isHeadAdmin = isHeadAdmin || userRoles.includes(ROLE_HEADADMIN);
          const rolesRes = await fetch(
            `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/roles`,
            { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
          );
          if (rolesRes.ok) {
            const allRoles = await rolesRes.json();
            roleNames = allRoles.filter(r => userRoles.includes(r.id)).map(r => r.name);
          }
        }
      } catch (e) {
        console.error('[steam discord link]', e);
      }
    }

    const jwtToken = jwt.sign({
      id: profile.steamid,
      username: profile.personaname,
      global_name: profile.personaname,
      avatar: profile.avatar,
      steamId: profile.steamid,
      profileUrl: profile.profileurl,
      discordId: linkedDiscordId || null,
      isAdmin, isOwner, isHeadAdmin,
      roles: roleNames,
      provider: 'steam',
    }, JWT_SECRET, { expiresIn: '7d' });

    console.log('[steam callback] ✅ Редирект на фронт с токеном');
    res.redirect(`${FRONTEND_URL}/?token=${encodeURIComponent(jwtToken)}`);
  } catch (e) {
    console.error('[steam callback] ❌ Ошибка:', e.message);
    console.error('[steam callback] Stack:', e.stack);
    res.redirect(`${FRONTEND_URL}/?error=steam_callback`);
  }
});

/* ============ /api/me ============ */
app.get('/api/me', (req, res) => {
  const p = getUserFromToken(req);
  if (!p) return res.json({ user: null });
  res.json({
    user: {
      id: p.id,
      username: p.username,
      global_name: p.global_name,
      avatar: p.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
      steamId: p.steamId,
      profileUrl: p.profileUrl,
      discordId: p.discordId || null,
      isAdmin: !!p.isAdmin,
      isOwner: !!p.isOwner,
      isHeadAdmin: !!p.isHeadAdmin,
      roles: p.roles || [],
      provider: 'steam',
    }
  });
});

/* ============ ПРИВЯЗКА ============ */
app.post('/api/link-discord', requireAuth, async (req, res) => {
  const { discordId } = req.body || {};
  if (!discordId) return res.status(400).json({ error: 'missing_discord_id' });
  const links = loadLinks();
  links[req.user.steamId] = discordId;
  saveJson(LINKS_FILE, links);
  res.json({ ok: true });
});
app.get('/api/link-discord', requireAuth, (req, res) => {
  res.json({ discordId: loadLinks()[req.user.steamId] || null });
});

/* ============ PRESENCE API ============ */
app.get('/api/presence', requireAdmin, async (req, res) => {
  res.json(await getPresenceStats());
});
app.get('/api/presence/:id', requireAdmin, async (req, res) => {
  res.json(await getPresence(req.params.id));
});
app.get('/api/presence-all', requireAdmin, async (req, res) => {
  res.json({ presence: await getAllPresence() });
});

/* ============ ПРОФИЛЬ ============ */
app.get('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (DISCORD_GUILD_ID && DISCORD_BOT_TOKEN && /^\d{17,20}$/.test(id)) {
      const memberRes = await fetch(
        `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${id}`,
        { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
      );
      if (memberRes.ok) {
        const m = await memberRes.json();
        const rolesRes = await fetch(
          `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/roles`,
          { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
        );
        const allRoles = rolesRes.ok ? await rolesRes.json() : [];
        const roleMap = {};
        allRoles.forEach(r => { roleMap[r.id] = r; });
        const roles = m.roles.map(rid => roleMap[rid]).filter(Boolean)
          .filter(r => r.name !== '@everyone').sort((a, b) => b.position - a.position);
        const topRole = roles[0] || { name: 'Участник', color: 0 };
        return res.json({
          user: {
            id: m.user.id,
            username: m.user.username,
            global_name: m.user.global_name,
            nickname: m.nick,
            avatar: m.user.avatar
              ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`
              : `https://cdn.discordapp.com/embed/avatars/0.png`,
            joinedAt: m.joined_at,
            roles: roles.map(r => r.name),
            topRole: topRole.name,
            topRoleColor: topRole.color ? '#' + topRole.color.toString(16).padStart(6, '0') : '#ffffff',
            presence: await getPresence(m.user.id),
            provider: 'discord',
          }
        });
      }
    }

    let profile = { steamid: id, personaname: 'Steam User', avatar: '' };
    const r = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${id}`
    );
    const data = await r.json();
    const p = data.response?.players?.[0];
    if (p) {
      profile = {
        steamid: p.steamid,
        personaname: p.personaname,
        avatar: p.avatarfull || p.avatarmedium || p.avatar,
        profileurl: p.profileurl,
      };
    }
    res.json({
      user: {
        id: profile.steamid,
        username: profile.personaname,
        global_name: profile.personaname,
        nickname: profile.personaname,
        avatar: profile.avatar,
        profileUrl: profile.profileurl,
        roles: [],
        topRole: 'Участник',
        topRoleColor: '#ffffff',
        presence: { status: 'offline', activities: [] },
        provider: 'steam',
      }
    });
  } catch (e) {
    console.error('[users/:id]', e);
    res.status(500).json({ error: 'server_error', details: String(e) });
  }
});

/* ============ ОТПРАВКА ЗАЯВКИ ============ */
app.post('/api/apply', async (req, res) => {
  const payload = getUserFromToken(req);
  if (!payload) return res.status(401).json({ error: 'not_authenticated' });
  const { age, experience, online, motivation } = req.body || {};
  if (!age || !experience || !online || !motivation)
    return res.status(400).json({ error: 'missing_fields' });
  if (!DISCORD_WEBHOOK_URL) return res.status(500).json({ error: 'webhook_not_configured' });

  const discordMention = payload.discordId ? `<@${payload.discordId}>` : '—';
  const steamLink = payload.profileUrl || `https://steamcommunity.com/profiles/${payload.steamId}`;

  const body = {
    username: 'Fernodd • Заявки',
    embeds: [{
      title: 'Новая заявка',
      color: 0xe10600,
      thumbnail: { url: payload.avatar },
      fields: [
        { name: 'Steam', value: `[${payload.username}](${steamLink})`, inline: true },
        { name: 'Discord', value: discordMention, inline: true },
        { name: 'Возраст', value: `\`${age}\``, inline: true },
        { name: 'Онлайн в день', value: `\`${online}\``, inline: true },
        { name: 'Опыт модерации', value: `\`${experience}\``, inline: false },
        { name: 'Мотивация', value: String(motivation).slice(0, 1000) }
      ],
      footer: { text: 'Fernodd • Система заявок' },
      timestamp: new Date().toISOString()
    }]
  };

  try {
    const r = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('webhook_failed');
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'send_failed' });
  }
});

/* ============ СПИСОК ЗАЯВОК ============ */
async function fetchApplicationsRaw() {
  if (!DISCORD_APPLY_CHANNEL_ID) return [];
  const r = await fetch(
    `https://discord.com/api/channels/${DISCORD_APPLY_CHANNEL_ID}/messages?limit=50`,
    { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
  );
  if (!r.ok) {
    const err = await r.text();
    throw new Error('discord_error: ' + err);
  }
  const messages = await r.json();
  const overrides = loadOverrides();

  return messages
    .filter(m => m.embeds && m.embeds.length)
    .map(m => {
      const e = m.embeds[0];
      const fields = {};
      (e.fields || []).forEach(f => { fields[f.name] = f.value; });
      let status;
      if (overrides[m.id]) status = overrides[m.id];
      else if (m.reactions?.some(x => x.emoji.name === '✅')) status = 'approved';
      else if (m.reactions?.some(x => x.emoji.name === '❌')) status = 'rejected';
      else status = 'pending';
      return {
        id: m.id, date: m.timestamp, authorId: m.author.id, authorName: m.author.username,
        avatar: e.thumbnail?.url || `https://cdn.discordapp.com/embed/avatars/0.png`,
        age: fields['Возраст'] || '', online: fields['Онлайн в день'] || '',
        experience: fields['Опыт модерации'] || '', motivation: fields['Мотивация'] || '',
        discord: fields['Discord'] || '',
        discordId: ((fields['Discord'] || '').match(/<@(\d+)>/) || [])[1] || '',
        discordUsername: ((fields['Discord'] || '').match(/`([^`]+)`/) || [])[1] || '',
        steam: fields['Steam'] || '',
        status
      };
    });
}

app.get('/api/applications', requireAdmin, async (req, res) => {
  try {
    const applications = await fetchApplicationsRaw();
    const reqs = loadRequests();
    const changesByApp = {};
    reqs.changes.filter(r => r.status === 'pending').forEach(r => { changesByApp[r.applicationId] = r; });
    const deletesByApp = {};
    reqs.deletes.filter(r => r.status === 'pending').forEach(r => { deletesByApp[r.applicationId] = r; });
    applications.forEach(a => {
      a.hasChangeRequest = !!changesByApp[a.id];
      a.hasDeleteRequest = !!deletesByApp[a.id];
    });
    res.json({ applications });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error', details: String(e) }); }
});

app.get('/api/my-applications', requireAuth, async (req, res) => {
  const mySteamId = req.user.steamId;
  const myDiscordId = req.user.discordId;
  try {
    const all = await fetchApplicationsRaw();
    const applications = all.filter(a =>
      (myDiscordId && a.discordId === myDiscordId) ||
      (mySteamId && a.steam && a.steam.includes(mySteamId))
    );
    res.json({ applications });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error', details: String(e) }); }
});

/* ============ ИЗМЕНИТЬ СТАТУС ============ */
app.post('/api/applications/:id/change', requireAdmin, async (req, res) => {
  if (!canChangeDirectly(req.user)) return res.status(403).json({ error: 'not_allowed_directly' });
  const { newStatus } = req.body || {};
  if (!['approved', 'rejected', 'pending'].includes(newStatus))
    return res.status(400).json({ error: 'bad_status' });
  try {
    const oldStatus = await getApplicationStatus(req.params.id);
    const owner = await getApplicationOwner(req.params.id);
    await applyStatusToDiscord(req.params.id, newStatus);
    appendHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      action: 'change',
      applicationId: req.params.id,
      applicationOwner: owner,
      oldStatus, newStatus,
      performedBy: req.user.id,
      performedByName: req.user.global_name || req.user.username,
      performedByAvatar: req.user.avatar,
      performedAt: new Date().toISOString(),
      method: 'direct'
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'discord_error', details: String(e) }); }
});

app.delete('/api/applications/:id', requireAdmin, async (req, res) => {
  if (!canDeleteDirectly(req.user)) return res.status(403).json({ error: 'not_allowed_directly' });
  try {
    const owner = await getApplicationOwner(req.params.id);
    const oldStatus = await getApplicationStatus(req.params.id);
    await deleteMessageFromDiscord(req.params.id);
    appendHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      action: 'delete',
      applicationId: req.params.id,
      applicationOwner: owner,
      oldStatus,
      performedBy: req.user.id,
      performedByName: req.user.global_name || req.user.username,
      performedByAvatar: req.user.avatar,
      performedAt: new Date().toISOString(),
      method: 'direct'
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'discord_error', details: String(e) }); }
});

app.post('/api/applications/:id/:action', requireAdmin, async (req, res) => {
  const { id, action } = req.params;
  if (action !== 'approve' && action !== 'reject') return res.status(400).json({ error: 'bad_action' });
  if (!canChangeDirectly(req.user)) return res.status(403).json({ error: 'not_allowed_directly' });
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  try {
    const oldStatus = await getApplicationStatus(id);
    const owner = await getApplicationOwner(id);
    await applyStatusToDiscord(id, newStatus);
    appendHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      action: 'change',
      applicationId: id,
      applicationOwner: owner,
      oldStatus, newStatus,
      performedBy: req.user.id,
      performedByName: req.user.global_name || req.user.username,
      performedByAvatar: req.user.avatar,
      performedAt: new Date().toISOString(),
      method: 'direct'
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'discord_error', details: String(e) }); }
});

/* ============ ЗАПРОСЫ НА ИЗМЕНЕНИЕ ============ */
app.get('/api/change-requests', requireAdmin, async (req, res) => {
  if (!canApproveRequests(req.user)) return res.status(403).json({ error: 'forbidden' });
  const reqs = loadRequests();
  const apps = await getApplicationsMap();
  const list = reqs.changes.filter(r => r.status === 'pending')
    .map(r => ({ ...r, application: apps[r.applicationId] || null }));
  res.json({ requests: list });
});
app.post('/api/change-requests', requireAdmin, async (req, res) => {
  const user = req.user;
  if (!canCreateRequest(user)) return res.status(403).json({ error: 'forbidden' });
  const { applicationId, newStatus, comment } = req.body || {};
  if (!applicationId || !['approved', 'rejected', 'pending'].includes(newStatus))
    return res.status(400).json({ error: 'bad_data' });
  const reqs = loadRequests();
  reqs.changes = reqs.changes.filter(r => !(r.applicationId === applicationId && r.status === 'pending'));
  reqs.changes.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    applicationId, newStatus, comment: comment || '',
    requestedBy: user.id,
    requestedByName: user.global_name || user.username,
    requestedByAvatar: user.avatar,
    createdAt: new Date().toISOString(),
    status: 'pending'
  });
  saveRequests(reqs);
  res.json({ ok: true });
});
app.post('/api/change-requests/:id/approve', requireAdmin, async (req, res) => {
  const user = req.user;
  if (!canApproveRequests(user)) return res.status(403).json({ error: 'forbidden' });
  const reqs = loadRequests();
  const request = reqs.changes.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'not_found' });
  try {
    const oldStatus = await getApplicationStatus(request.applicationId);
    const owner = await getApplicationOwner(request.applicationId);
    await applyStatusToDiscord(request.applicationId, request.newStatus);
    request.status = 'approved';
    request.resolvedBy = user.id;
    request.resolvedByName = user.global_name || user.username;
    request.resolvedAt = new Date().toISOString();
    saveRequests(reqs);
    appendHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      action: 'change',
      applicationId: request.applicationId,
      applicationOwner: owner,
      oldStatus,
      newStatus: request.newStatus,
      performedBy: user.id,
      performedByName: user.global_name || user.username,
      performedByAvatar: user.avatar,
      performedAt: new Date().toISOString(),
      method: 'approved_request',
      requestedBy: request.requestedBy,
      requestedByName: request.requestedByName
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'discord_error', details: String(e) }); }
});
app.post('/api/change-requests/:id/reject', requireAdmin, async (req, res) => {
  const user = req.user;
  if (!canApproveRequests(user)) return res.status(403).json({ error: 'forbidden' });
  const reqs = loadRequests();
  const request = reqs.changes.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'not_found' });
  request.status = 'rejected';
  request.resolvedBy = user.id;
  request.resolvedByName = user.global_name || user.username;
  request.resolvedAt = new Date().toISOString();
  saveRequests(reqs);
  res.json({ ok: true });
});

/* ============ ЗАПРОСЫ НА УДАЛЕНИЕ ============ */
app.get('/api/delete-requests', requireAdmin, async (req, res) => {
  if (!canApproveRequests(req.user)) return res.status(403).json({ error: 'forbidden' });
  const reqs = loadRequests();
  const apps = await getApplicationsMap();
  const list = reqs.deletes.filter(r => r.status === 'pending')
    .map(r => ({ ...r, application: apps[r.applicationId] || null }));
  res.json({ requests: list });
});
app.post('/api/delete-requests', requireAdmin, async (req, res) => {
  const user = req.user;
  if (!canCreateRequest(user)) return res.status(403).json({ error: 'forbidden' });
  const { applicationId, comment } = req.body || {};
  if (!applicationId) return res.status(400).json({ error: 'bad_data' });
  const reqs = loadRequests();
  reqs.deletes = reqs.deletes.filter(r => !(r.applicationId === applicationId && r.status === 'pending'));
  reqs.deletes.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    applicationId, comment: comment || '',
    requestedBy: user.id,
    requestedByName: user.global_name || user.username,
    requestedByAvatar: user.avatar,
    createdAt: new Date().toISOString(),
    status: 'pending'
  });
  saveRequests(reqs);
  res.json({ ok: true });
});
app.post('/api/delete-requests/:id/approve', requireAdmin, async (req, res) => {
  const user = req.user;
  if (!canApproveRequests(user)) return res.status(403).json({ error: 'forbidden' });
  const reqs = loadRequests();
  const request = reqs.deletes.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'not_found' });
  try {
    const owner = await getApplicationOwner(request.applicationId);
    const oldStatus = await getApplicationStatus(request.applicationId);
    await deleteMessageFromDiscord(request.applicationId);
    request.status = 'approved';
    request.resolvedBy = user.id;
    request.resolvedByName = user.global_name || user.username;
    request.resolvedAt = new Date().toISOString();
    saveRequests(reqs);
    appendHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      action: 'delete',
      applicationId: request.applicationId,
      applicationOwner: owner,
      oldStatus,
      performedBy: user.id,
      performedByName: user.global_name || user.username,
      performedByAvatar: user.avatar,
      performedAt: new Date().toISOString(),
      method: 'approved_request',
      requestedBy: request.requestedBy,
      requestedByName: request.requestedByName
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'discord_error', details: String(e) }); }
});
app.post('/api/delete-requests/:id/reject', requireAdmin, async (req, res) => {
  const user = req.user;
  if (!canApproveRequests(user)) return res.status(403).json({ error: 'forbidden' });
  const reqs = loadRequests();
  const request = reqs.deletes.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'not_found' });
  request.status = 'rejected';
  request.resolvedBy = user.id;
  request.resolvedByName = user.global_name || user.username;
  request.resolvedAt = new Date().toISOString();
  saveRequests(reqs);
  res.json({ ok: true });
});

/* ============ ИСТОРИЯ ============ */
app.get('/api/applications-history', requireAdmin, (req, res) => {
  if (!isWatcherOrAbove(req.user)) return res.status(403).json({ error: 'forbidden' });
  res.json({ history: loadHistory() });
});

async function getApplicationsMap() {
  try {
    const all = await fetchApplicationsRaw();
    const map = {};
    all.forEach(a => { map[a.id] = a; });
    return map;
  } catch { return {}; }
}

/* ============ DEBUG ============ */
app.get('/api/debug-presence', async (req, res) => {
  const all = await getAllPresence();
  const stats = await getPresenceStats();
  const entries = Object.entries(all).slice(0, 5);
  res.json({
    stats,
    cacheSize: Object.keys(all).length,
    sample: entries.map(([id, p]) => ({ id, status: p.status, activities: p.activities?.length || 0 }))
  });
});

/* ============ ПЕРСОНАЛ ============ */
app.get('/api/staff', requireAdmin, async (req, res) => {
  if (!DISCORD_GUILD_ID) return res.status(500).json({ error: 'guild_not_configured' });
  try {
    const membersRes = await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members?limit=1000`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!membersRes.ok) {
      const err = await membersRes.text();
      return res.status(500).json({ error: 'discord_error', status: membersRes.status, details: err });
    }
    const members = await membersRes.json();
    const rolesRes = await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/roles`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    const allRoles = rolesRes.ok ? await rolesRes.json() : [];
    const roleMap = {};
    allRoles.forEach(r => { roleMap[r.id] = { name: r.name, color: r.color, position: r.position }; });

    const staffMembers = members.filter(m => m.roles.some(r => ALL_STAFF_ROLES.includes(r)));
    const administrators = [];
    const moderators = [];

    for (const m of staffMembers) {
      const isAdmin = m.roles.some(r => ADMIN_ROLES.includes(r));
      const roles = m.roles.map(id => roleMap[id]).filter(Boolean)
        .filter(r => r.name !== '@everyone').sort((a, b) => b.position - a.position);
      const topRole = roles[0] || { name: 'Участник', color: 0 };
      const memberData = {
        id: m.user.id, username: m.user.username, global_name: m.user.global_name,
        nickname: m.nick,
        avatar: m.user.avatar
          ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/0.png`,
        joinedAt: m.joined_at, topRole: topRole.name,
        topRoleColor: topRole.color ? '#' + topRole.color.toString(16).padStart(6, '0') : '#ffffff',
        roles: roles.map(r => r.name), isAdmin,
        presence: await getPresence(m.user.id)
      };
      if (isAdmin) administrators.push(memberData); else moderators.push(memberData);
    }
    administrators.sort((a, b) => b.roles.length - a.roles.length);
    moderators.sort((a, b) => b.roles.length - a.roles.length);
    res.json({ administrators, moderators });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

/* ============ ЖАЛОБЫ ============ */
app.get('/api/tickets', requireAdmin, async (req, res) => {
  if (!DISCORD_OPEN_TICKETS_CATEGORY_ID && !DISCORD_CLOSED_TICKETS_CATEGORY_ID) {
    return res.status(500).json({ error: 'category_not_configured' });
  }
  try {
    const r = await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/channels`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: 'discord_error', status: r.status, details: err });
    }
    const channels = await r.json();

    async function buildTicket(c) {
      let preview = '', lastAuthor = '', lastDate = null;
      try {
        const mRes = await fetch(
          `https://discord.com/api/channels/${c.id}/messages?limit=1`,
          { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
        );
        if (mRes.ok) {
          const msgs = await mRes.json();
          if (msgs.length) {
            const last = msgs[0];
            preview = (last.content || (last.embeds?.[0]?.description || '')).slice(0, 120);
            lastAuthor = last.author.global_name || last.author.username;
            lastDate = last.timestamp;
          }
        }
      } catch {}
      return { id: c.id, name: c.name, preview, lastAuthor, lastDate };
    }

    const openChannels = DISCORD_OPEN_TICKETS_CATEGORY_ID
      ? channels.filter(c => c.parent_id === DISCORD_OPEN_TICKETS_CATEGORY_ID && c.type === 0) : [];
    const closedChannels = DISCORD_CLOSED_TICKETS_CATEGORY_ID
      ? channels.filter(c => c.parent_id === DISCORD_CLOSED_TICKETS_CATEGORY_ID && c.type === 0) : [];

    const [openTickets, closedTickets] = await Promise.all([
      Promise.all(openChannels.map(buildTicket)),
      Promise.all(closedChannels.map(buildTicket))
    ]);
    const sortNewest = (a, b) => Number(BigInt(b.id) >> 22n) - Number(BigInt(a.id) >> 22n);
    openTickets.sort(sortNewest);
    closedTickets.sort(sortNewest);
    res.json({ open: openTickets, closed: closedTickets });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

app.get('/api/tickets/:id/messages', requireAdmin, async (req, res) => {
  try {
    const r = await fetch(
      `https://discord.com/api/channels/${req.params.id}/messages?limit=100`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: 'discord_error', status: r.status, details: err });
    }
    const messages = await r.json();
    messages.reverse();
    const formatted = messages.map(m => ({
      id: m.id,
      authorId: m.author.id,
      authorName: m.author.global_name || m.author.username,
      authorBot: m.author.bot,
      avatar: m.author.avatar
        ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
      content: m.content || '',
      embedTitle: m.embeds?.[0]?.title || '',
      embedDescription: m.embeds?.[0]?.description || '',
      attachments: (m.attachments || []).map(a => ({ url: a.url, type: a.content_type || '' })),
      date: m.timestamp
    }));
    res.json({ messages: formatted });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

/* ============ ЛОГИ ============ */
app.get('/api/logs', requireHeadAdmin, async (req, res) => {
  if (!DISCORD_LOGS_CHANNEL_ID) return res.status(500).json({ error: 'channel_not_configured' });
  try {
    const r = await fetch(
      `https://discord.com/api/channels/${DISCORD_LOGS_CHANNEL_ID}/messages?limit=50`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: 'discord_error', status: r.status, details: err });
    }
    const messages = await r.json();
    const logs = messages.map(m => {
      const embed = m.embeds?.[0] || null;
      return {
        id: m.id, date: m.timestamp,
        authorName: m.author.global_name || m.author.username,
        avatar: m.author.avatar
          ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/0.png`,
        content: m.content || '',
        embedTitle: embed?.title || '',
        embedDescription: embed?.description || '',
        embedFields: (embed?.fields || []).map(f => ({ name: f.name, value: f.value, inline: !!f.inline })),
        embedColor: embed?.color || null,
        embedImage: embed?.image?.url || '',
        attachments: (m.attachments || []).map(a => ({ url: a.url, type: a.content_type || '', name: a.filename || '' }))
      };
    });
    res.json({ logs });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

/* ============ НАСТРОЙКИ ============ */
app.get('/api/settings', requireOwner, (req, res) => {
  res.json({
    settings: {
      guildId: DISCORD_GUILD_ID || '—',
      applyChannel: DISCORD_APPLY_CHANNEL_ID || '—',
      logsChannel: DISCORD_LOGS_CHANNEL_ID || '—',
      openTicketsCategory: DISCORD_OPEN_TICKETS_CATEGORY_ID || '—',
      closedTicketsCategory: DISCORD_CLOSED_TICKETS_CATEGORY_ID || '—',
      adminRoles: ADMIN_ROLES,
      moderatorRoles: MODERATOR_ROLES,
      botConnected: !!DISCORD_BOT_TOKEN,
      ownerSteamId: OWNER_STEAM_ID || '—',
      adminSteamIds: ADMIN_STEAM_LIST,
      frontendUrl: FRONTEND_URL
    }
  });
});

/* ============ HEALTH ============ */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

/* ============ INIT ============ */
initPresence();

app.listen(PORT, () => {
  console.log(`\n✅ Fernodd API запущен: http://localhost:${PORT}`);
  console.log(`✅ Steam auth:      ${STEAM_REALM}/auth/steam`);
  console.log(`✅ Steam callback:  ${STEAM_RETURN_URL}\n`);
});
