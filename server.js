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
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_OAUTH_REDIRECT = 'http://localhost:3000/auth/discord/callback',
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

console.log('========================================');
console.log('  FERNODD API STARTUP');
console.log('========================================');
console.log('PORT:                     ', PORT);
console.log('STEAM_API_KEY:            ', STEAM_API_KEY ? '✅' : '❌');
console.log('JWT_SECRET:               ', JWT_SECRET ? '✅' : '❌');
console.log('DISCORD_BOT_TOKEN:        ', DISCORD_BOT_TOKEN ? '✅' : '❌');
console.log('DISCORD_GUILD_ID:         ', DISCORD_GUILD_ID || '❌');
console.log('DISCORD_CLIENT_ID:        ', DISCORD_CLIENT_ID ? '✅' : '❌ (OAuth не работает)');
console.log('DISCORD_CLIENT_SECRET:    ', DISCORD_CLIENT_SECRET ? '✅' : '❌ (OAuth не работает)');
console.log('DISCORD_OAUTH_REDIRECT:   ', DISCORD_OAUTH_REDIRECT);
console.log('========================================\n');

const ADMIN_ROLES = [ROLE_CURATOR, ROLE_WATCHER, ROLE_HEADADMIN].filter(Boolean);
const MODERATOR_ROLES = [ROLE_MODERATOR, ROLE_SENIOR_MODERATOR, ROLE_CHIEF_MODERATOR].filter(Boolean);
const ALL_STAFF_ROLES = [...ADMIN_ROLES, ...MODERATOR_ROLES];
const ADMIN_STEAM_LIST = ADMIN_STEAM_IDS.split(',').map(s => s.trim()).filter(Boolean);

const ASSIGNABLE_ROLE_NAMES_STAFF = ['модератор', 'старший модератор', 'главный модератор'];
const ASSIGNABLE_ROLE_NAMES_OWNER = ['куратор', 'следящий', 'главная администрация'];
const STAFF_ROLE_NAMES_ALL = [
  'модератор', 'старший модератор', 'главный модератор',
  'куратор', 'следящий', 'главная администрация',
];

/* ============ Файлы ============ */
const REQUESTS_FILE = path.join(__dirname, 'requests.json');
const HISTORY_FILE = path.join(__dirname, 'requests-history.json');
const OVERRIDE_FILE = path.join(__dirname, 'applications-override.json');
const LINKS_FILE = path.join(__dirname, 'steam-discord-links.json');
const BALANCES_FILE = path.join(__dirname, 'balances.json');
const PROMOS_FILE = path.join(__dirname, 'promocodes.json');
const PROMO_USES_FILE = path.join(__dirname, 'promo-uses.json');

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8')) ?? fallback;
  } catch (e) { console.error(`Чтение ${file}:`, e); return fallback; }
}
function saveJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { console.error(`Запись ${file}:`, e); }
}

function loadRequests() {
  const d = loadJson(REQUESTS_FILE, { changes: [], deletes: [] });
  return { changes: d.changes || [], deletes: d.deletes || [] };
}
function saveRequests(d) { saveJson(REQUESTS_FILE, d); }
function loadHistory() { return loadJson(HISTORY_FILE, []); }
function appendHistory(entry) {
  const list = loadHistory();
  list.unshift(entry);
  if (list.length > 500) list.length = 500;
  saveJson(HISTORY_FILE, list);
}
function loadOverrides() { return loadJson(OVERRIDE_FILE, {}); }
function setOverride(id, status) {
  const m = loadOverrides();
  if (status === null || status === undefined) delete m[id];
  else m[id] = status;
  saveJson(OVERRIDE_FILE, m);
}
function getOverride(id) { return loadOverrides()[id] || null; }
function loadLinks() { return loadJson(LINKS_FILE, {}); }
function saveLinks(d) { saveJson(LINKS_FILE, d); }
function getDiscordIdBySteam(sid) { return loadLinks()[sid] || null; }

function loadBalances() { return loadJson(BALANCES_FILE, {}); }
function saveBalances(d) { saveJson(BALANCES_FILE, d); }
function loadPromos() { return loadJson(PROMOS_FILE, {}); }
function savePromos(d) { saveJson(PROMOS_FILE, d); }
function loadPromoUses() { return loadJson(PROMO_USES_FILE, []); }
function savePromoUses(d) { saveJson(PROMO_USES_FILE, d); }

/* ============ Утилиты ============ */
function getUserFromToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}
function requireAuth(req, res, next) {
  const u = getUserFromToken(req);
  if (!u) return res.status(401).json({ error: 'not_authenticated' });
  req.user = u; next();
}
function requireAdmin(req, res, next) {
  const u = getUserFromToken(req);
  if (!u) return res.status(401).json({ error: 'not_authenticated' });
  if (!u.isAdmin) return res.status(403).json({ error: 'forbidden' });
  req.user = u; next();
}
function requireOwner(req, res, next) {
  const u = getUserFromToken(req);
  if (!u) return res.status(401).json({ error: 'not_authenticated' });
  if (!u.isOwner) return res.status(403).json({ error: 'owner_only' });
  req.user = u; next();
}
function requireHeadAdmin(req, res, next) {
  const u = getUserFromToken(req);
  if (!u) return res.status(401).json({ error: 'not_authenticated' });
  if (!u.isHeadAdmin && !u.isOwner) return res.status(403).json({ error: 'head_admin_only' });
  req.user = u; next();
}

function isWatcherOrAbove(u) {
  if (!u) return false;
  if (u.isHeadAdmin || u.isOwner) return true;
  return (u.roles || []).some(r => r === 'Следящий');
}
function isHeadAdminOrOwner(u) { return !!(u && (u.isHeadAdmin || u.isOwner)); }
function isCurator(u) { return !!(u && (u.roles || []).some(r => r === 'Куратор')); }
function canApproveRequests(u) { return isWatcherOrAbove(u); }
function canChangeDirectly(u) { return isWatcherOrAbove(u); }
function canDeleteDirectly(u) { return isWatcherOrAbove(u); }
function canCreateRequest(u) { return isCurator(u) || isWatcherOrAbove(u); }

function getAssignableRolesFor(user) {
  if (!user) return [];
  if (user.isOwner) return [...ASSIGNABLE_ROLE_NAMES_STAFF, ...ASSIGNABLE_ROLE_NAMES_OWNER];
  if (isWatcherOrAbove(user)) return [...ASSIGNABLE_ROLE_NAMES_STAFF];
  return [];
}

/* ============ Discord API ============ */
async function discordGet(path) {
  const r = await fetch(`https://discord.com/api${path}`, {
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`discord_error: ${r.status} — ${err}`);
  }
  return r.json();
}

async function discordPut(path) {
  const r = await fetch(`https://discord.com/api${path}`, {
    method: 'PUT', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
  });
  if (!r.ok && r.status !== 204) throw new Error('discord_error');
  return true;
}

async function discordDelete(path) {
  const r = await fetch(`https://discord.com/api${path}`, {
    method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
  });
  if (!r.ok && r.status !== 204 && r.status !== 404) throw new Error('discord_error');
  return true;
}

let rolesCache = { data: null, time: 0 };
async function getGuildRoles() {
  if (rolesCache.data && Date.now() - rolesCache.time < 300000) return rolesCache.data;
  const roles = await discordGet(`/guilds/${DISCORD_GUILD_ID}/roles`);
  rolesCache = { data: roles, time: Date.now() };
  return roles;
}

async function getGuildMember(discordId) {
  return discordGet(`/guilds/${DISCORD_GUILD_ID}/members/${discordId}`);
}

async function getUserStaffRoles(discordId) {
  try {
    const member = await getGuildMember(discordId);
    const allRoles = await getGuildRoles();
    const roleMap = {};
    allRoles.forEach(r => { roleMap[r.id] = r.name; });
    return (member.roles || [])
      .map(id => roleMap[id])
      .filter(name => name && STAFF_ROLE_NAMES_ALL.includes(name.toLowerCase()));
  } catch { return []; }
}

async function removeAllStaffRoles(discordId, keepRoleNames = []) {
  const member = await getGuildMember(discordId);
  const allRoles = await getGuildRoles();
  const keepLower = keepRoleNames.map(n => n.toLowerCase());
  const staffRoleIdsToRemove = allRoles
    .filter(r => {
      const n = r.name.toLowerCase();
      return STAFF_ROLE_NAMES_ALL.includes(n) && !keepLower.includes(n);
    })
    .map(r => r.id);
  const userRoleSet = new Set(member.roles || []);
  const toRemove = staffRoleIdsToRemove.filter(id => userRoleSet.has(id));
  for (const roleId of toRemove) {
    try { await discordDelete(`/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`); }
    catch (e) {}
  }
  return toRemove;
}

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
    } catch (e) {}
  }
  if (newStatus === 'approved' || newStatus === 'rejected') {
    const emoji = newStatus === 'approved' ? '✅' : '❌';
    try {
      await fetch(
        `https://discord.com/api/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
        { method: 'PUT', headers: { Authorization: `Bot ${botToken}` } }
      );
    } catch (e) {}
  }
}

async function deleteMessageFromDiscord(messageId) {
  const r = await fetch(
    `https://discord.com/api/channels/${DISCORD_APPLY_CHANNEL_ID}/messages/${messageId}`,
    { method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
  );
  if (!r.ok && r.status !== 204 && r.status !== 404) {
    throw new Error(`Не удалось удалить (${r.status})`);
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
    const embed = m.embeds?.[0];
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
   STEAM OPENID
   ================================================================ */
const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

app.get('/auth/steam', (req, res) => {
  if (!STEAM_API_KEY) return res.redirect(`${FRONTEND_URL}/?error=steam_no_key`);
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': STEAM_RETURN_URL,
    'openid.realm': STEAM_REALM,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  res.redirect(`${STEAM_OPENID_URL}?${params.toString()}`);
});

app.get('/auth/steam/callback', async (req, res) => {
  try {
    const claimedId = req.query['openid.claimed_id'];
    if (!claimedId) return res.redirect(`${FRONTEND_URL}/?error=steam_no_claimed_id`);
    const match = String(claimedId).match(/\/id\/(\d+)$/);
    if (!match) return res.redirect(`${FRONTEND_URL}/?error=steam_bad_claimed_id`);
    const steamId = match[1];

    const vp = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) vp.append(k, v);
    vp.set('openid.mode', 'check_authentication');
    const vr = await fetch(STEAM_OPENID_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: vp.toString(),
    });
    const vt = await vr.text();
    if (!vt.includes('is_valid:true')) return res.redirect(`${FRONTEND_URL}/?error=steam_invalid_signature`);

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
        };
      }
    } catch (e) {}

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
      } catch (e) {}
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

    res.redirect(`${FRONTEND_URL}/?token=${encodeURIComponent(jwtToken)}`);
  } catch (e) {
    console.error('[steam callback]', e);
    res.redirect(`${FRONTEND_URL}/?error=steam_callback`);
  }
});

/* ================================================================
   DISCORD OAUTH2
   ================================================================ */

/* Шаг 1: Редирект на Discord OAuth */
app.get('/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID) {
    return res.redirect(`${FRONTEND_URL}/profile.html?discord_error=not_configured`);
  }
  const token = req.query.token || '';
  const state = Buffer.from(JSON.stringify({ token, t: Date.now() })).toString('base64');

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_OAUTH_REDIRECT,
    response_type: 'code',
    scope: 'identify',
    state: state,
    prompt: 'consent'
  });

  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

/* Шаг 2: Callback от Discord */
app.get('/auth/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.redirect(`${FRONTEND_URL}/profile.html?discord_error=no_code`);

  let userToken = null;
  try {
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    userToken = stateData.token;
  } catch {}

  if (!userToken) return res.redirect(`${FRONTEND_URL}/profile.html?discord_error=bad_state`);

  let user;
  try { user = jwt.verify(userToken, JWT_SECRET); }
  catch { return res.redirect(`${FRONTEND_URL}/profile.html?discord_error=bad_token`); }

  try {
    /* Обмен кода на access_token */
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: DISCORD_OAUTH_REDIRECT,
    });

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('[oauth token]', err);
      return res.redirect(`${FRONTEND_URL}/profile.html?discord_error=token_failed`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    /* Получаем инфу о юзере */
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) return res.redirect(`${FRONTEND_URL}/profile.html?discord_error=user_failed`);
    const discordUser = await userRes.json();

    /* Проверяем, что юзер в гильдии */
    try {
      const memberRes = await fetch(
        `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}`,
        { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
      );
      if (!memberRes.ok) {
        return res.redirect(`${FRONTEND_URL}/profile.html?discord_error=not_in_guild`);
      }
    } catch {
      return res.redirect(`${FRONTEND_URL}/profile.html?discord_error=guild_check_failed`);
    }

    /* Сохраняем привязку */
    const links = loadLinks();
    links[user.steamId] = discordUser.id;
    saveLinks(links);

    /* Выдаём роль "Игрок" */
    try {
      const allRoles = await getGuildRoles();
      const playerRole = allRoles.find(r => r.name.toLowerCase() === 'игрок');
      if (playerRole) {
        const member = await getGuildMember(discordUser.id);
        if (!member.roles.includes(playerRole.id)) {
          await discordPut(`/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}/roles/${playerRole.id}`);
        }
      }
    } catch (e) { console.error('[auto-role]', e.message); }

    return res.redirect(`${FRONTEND_URL}/profile.html?discord_linked=1`);
  } catch (e) {
    console.error('[discord callback]', e);
    return res.redirect(`${FRONTEND_URL}/profile.html?discord_error=unknown`);
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
      discordId: getDiscordIdBySteam(p.steamId) || p.discordId || null,
      isAdmin: !!p.isAdmin,
      isOwner: !!p.isOwner,
      isHeadAdmin: !!p.isHeadAdmin,
      roles: p.roles || [],
      provider: 'steam',
    }
  });
});

/* ============ БАЛАНС ============ */
app.get('/api/balance', requireAuth, (req, res) => {
  res.json({ balance: loadBalances()[req.user.steamId] || 0 });
});

/* ============ ПРИВЯЗКА — проверка и отвязка ============ */
app.post('/api/unlink-discord', requireAuth, (req, res) => {
  const links = loadLinks();
  delete links[req.user.steamId];
  saveLinks(links);
  res.json({ ok: true });
});

/* Информация о Discord-профиле (для отображения ника и аватарки) */
app.get('/api/discord-info/:discordId', requireAuth, async (req, res) => {
  const { discordId } = req.params;
  if (!/^\d{17,20}$/.test(discordId)) return res.status(400).json({ error: 'bad_id' });
  try {
    const member = await discordGet(`/guilds/${DISCORD_GUILD_ID}/members/${discordId}`);
    res.json({
      id: member.user.id,
      username: member.user.username,
      global_name: member.user.global_name,
      nickname: member.nick,
      avatar: member.user.avatar
        ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
    });
  } catch (e) {
    res.status(404).json({ error: 'not_found' });
  }
});

/* Список привязок для профиля (кто с кем связан) */
app.get('/api/steam-discord-links', requireAdmin, (req, res) => {
  res.json({ links: loadLinks() });
});

/* ============ PROMOCODES ============ */
app.get('/api/promocodes', requireOwner, (req, res) => {
  const promos = loadPromos();
  const uses = loadPromoUses();
  res.json({
    promocodes: Object.entries(promos).map(([code, data]) => ({
      code, ...data,
      usedCount: uses.filter(u => u.code === code).length,
    }))
  });
});

app.post('/api/promocodes', requireOwner, (req, res) => {
  const { code, amount, maxUses } = req.body || {};
  if (!code || !amount) return res.status(400).json({ error: 'missing_fields' });
  const cleanCode = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(cleanCode)) return res.status(400).json({ error: 'bad_code_format' });
  const promos = loadPromos();
  if (promos[cleanCode]) return res.status(400).json({ error: 'already_exists' });
  promos[cleanCode] = {
    amount: Number(amount),
    maxUses: Number(maxUses) || 0,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.global_name || req.user.username,
    active: true,
  };
  savePromos(promos);
  res.json({ ok: true, code: cleanCode });
});

app.delete('/api/promocodes/:code', requireOwner, (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const promos = loadPromos();
  if (!promos[code]) return res.status(404).json({ error: 'not_found' });
  delete promos[code];
  savePromos(promos);
  res.json({ ok: true });
});

app.post('/api/promocodes/activate', requireAuth, (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_code' });
  const cleanCode = String(code).trim().toUpperCase();
  const promos = loadPromos();
  const uses = loadPromoUses();
  const promo = promos[cleanCode];
  if (!promo) return res.status(404).json({ error: 'not_found' });
  if (!promo.active) return res.status(400).json({ error: 'inactive' });
  if (uses.filter(u => u.code === cleanCode && u.userId === req.user.steamId).length > 0) {
    return res.status(400).json({ error: 'already_used_by_you' });
  }
  const totalUses = uses.filter(u => u.code === cleanCode).length;
  if (promo.maxUses > 0 && totalUses >= promo.maxUses) return res.status(400).json({ error: 'limit_reached' });
  const balances = loadBalances();
  balances[req.user.steamId] = (balances[req.user.steamId] || 0) + promo.amount;
  saveBalances(balances);
  uses.push({
    code: cleanCode,
    userId: req.user.steamId,
    userName: req.user.global_name || req.user.username,
    amount: promo.amount,
    usedAt: new Date().toISOString(),
  });
  savePromoUses(uses);
  res.json({ ok: true, amount: promo.amount, newBalance: balances[req.user.steamId] });
});

/* ============ ВЫДАЧА РОЛЕЙ ============ */
app.get('/api/roles-list', requireAdmin, async (req, res) => {
  const allowed = getAssignableRolesFor(req.user);
  if (!allowed.length) return res.status(403).json({ error: 'forbidden' });
  try {
    const allRoles = await getGuildRoles();
    const allowedLower = allowed.map(n => n.toLowerCase());
    const filtered = allRoles
      .filter(r => allowedLower.includes(r.name.toLowerCase()))
      .map(r => ({
        id: r.id,
        name: r.name,
        color: r.color ? '#' + r.color.toString(16).padStart(6, '0') : '#ffffff',
      }));
    res.json({ roles: filtered });
  } catch (e) {
    res.status(500).json({ error: 'server_error', details: String(e) });
  }
});

app.get('/api/steam-search', requireAdmin, async (req, res) => {
  if (!isWatcherOrAbove(req.user)) return res.status(403).json({ error: 'forbidden' });
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 3) return res.json({ users: [] });

  const results = [];

  if (/^\d{17}$/.test(q)) {
    try {
      const r = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${q}`
      );
      const data = await r.json();
      const p = data.response?.players?.[0];
      if (p) {
        const discordId = getDiscordIdBySteam(p.steamid);
        let currentRole = null;
        if (discordId) {
          const roles = await getUserStaffRoles(discordId);
          if (roles.length) currentRole = roles[0];
        }
        results.push({
          steamId: p.steamid,
          personaName: p.personaname,
          avatar: p.avatarfull || p.avatarmedium || p.avatar,
          profileUrl: p.profileurl,
          discordId: discordId || null,
          currentRole: currentRole,
        });
      }
    } catch (e) {}
  } else {
    const links = loadLinks();
    for (const [steamId, discordId] of Object.entries(links)) {
      try {
        const r = await fetch(
          `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`
        );
        const data = await r.json();
        const p = data.response?.players?.[0];
        if (p && p.personaname.toLowerCase().includes(q.toLowerCase())) {
          const roles = await getUserStaffRoles(discordId);
          results.push({
            steamId: p.steamid,
            personaName: p.personaname,
            avatar: p.avatarfull || p.avatarmedium || p.avatar,
            profileUrl: p.profileurl,
            discordId: discordId,
            currentRole: roles.length ? roles[0] : null,
          });
        }
      } catch (e) {}
      if (results.length >= 20) break;
    }
  }

  res.json({ users: results });
});

app.get('/api/user-current-role/:discordId', requireAdmin, async (req, res) => {
  if (!isWatcherOrAbove(req.user)) return res.status(403).json({ error: 'forbidden' });
  const { discordId } = req.params;
  if (!/^\d{17,20}$/.test(discordId)) return res.json({ currentRole: null });
  try {
    const roles = await getUserStaffRoles(discordId);
    res.json({ currentRole: roles[0] || null, allRoles: roles });
  } catch (e) {
    res.status(500).json({ error: 'server_error', details: String(e) });
  }
});

app.post('/api/give-role', requireAdmin, async (req, res) => {
  const allowed = getAssignableRolesFor(req.user);
  if (!allowed.length) return res.status(403).json({ error: 'forbidden' });
  const { discordId, roleId } = req.body || {};
  if (!discordId || !roleId) return res.status(400).json({ error: 'missing_fields' });
  try {
    const allRoles = await getGuildRoles();
    const role = allRoles.find(r => r.id === roleId);
    if (!role) return res.status(400).json({ error: 'role_not_found' });
    const allowedLower = allowed.map(n => n.toLowerCase());
    if (!allowedLower.includes(role.name.toLowerCase())) {
      return res.status(403).json({ error: 'role_not_assignable' });
    }
    await removeAllStaffRoles(discordId, [role.name.toLowerCase()]);
    await discordPut(`/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`);

    appendHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      action: 'give_role',
      targetDiscordId: discordId,
      roleName: role.name,
      performedBy: req.user.id,
      performedByName: req.user.global_name || req.user.username,
      performedByAvatar: req.user.avatar,
      performedAt: new Date().toISOString(),
    });
    res.json({ ok: true, role: role.name });
  } catch (e) {
    res.status(500).json({ error: 'server_error', details: String(e) });
  }
});

/* ============ PRESENCE ============ */
app.get('/api/presence', requireAdmin, async (req, res) => res.json(await getPresenceStats()));
app.get('/api/presence/:id', requireAdmin, async (req, res) => res.json(await getPresence(req.params.id)));
app.get('/api/presence-all', requireAdmin, async (req, res) => res.json({ presence: await getAllPresence() }));

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
        const allRoles = await getGuildRoles();
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

    /* Ищем Discord-привязку */
    const discordId = getDiscordIdBySteam(profile.steamid);
    let discordInfo = null;
    if (discordId && DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
      try {
        const m = await getGuildMember(discordId);
        const allRoles = await getGuildRoles();
        const roleMap = {};
        allRoles.forEach(r => { roleMap[r.id] = r; });
        const roles = m.roles.map(rid => roleMap[rid]).filter(Boolean)
          .filter(r => r.name !== '@everyone').sort((a, b) => b.position - a.position);
        const topRole = roles[0] || { name: 'Участник', color: 0 };
        discordInfo = {
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
        };
      } catch (e) {}
    }

    res.json({
      user: {
        id: profile.steamid,
        username: profile.personaname,
        global_name: profile.personaname,
        nickname: profile.personaname,
        avatar: profile.avatar,
        profileUrl: profile.profileurl,
        discordId: discordId || null,
        discord: discordInfo,
        roles: discordInfo ? discordInfo.roles : [],
        topRole: discordInfo ? discordInfo.topRole : 'Участник',
        topRoleColor: discordInfo ? discordInfo.topRoleColor : '#ffffff',
        presence: discordInfo ? await getPresence(discordInfo.id) : { status: 'offline', activities: [] },
        provider: 'steam',
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error', details: String(e) });
  }
});

/* ============ ЗАЯВКА ============ */
app.post('/api/apply', async (req, res) => {
  const payload = getUserFromToken(req);
  if (!payload) return res.status(401).json({ error: 'not_authenticated' });
  const { age, experience, online, motivation } = req.body || {};
  if (!age || !experience || !online || !motivation) return res.status(400).json({ error: 'missing_fields' });
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
        { name: 'Steam ID', value: `\`${payload.steamId}\``, inline: true },
        { name: 'Discord', value: discordMention, inline: false },
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
  if (!r.ok) throw new Error('discord_error: ' + await r.text());
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
      const steamIdMatch = (fields['Steam ID'] || '').match(/`(\d{17})`/);
      return {
        id: m.id, date: m.timestamp, authorId: m.author.id, authorName: m.author.username,
        avatar: e.thumbnail?.url || `https://cdn.discordapp.com/embed/avatars/0.png`,
        age: fields['Возраст'] || '', online: fields['Онлайн в день'] || '',
        experience: fields['Опыт модерации'] || '', motivation: fields['Мотивация'] || '',
        discord: fields['Discord'] || '',
        discordId: ((fields['Discord'] || '').match(/<@(\d+)>/) || [])[1] || '',
        steam: fields['Steam'] || '',
        steamId: steamIdMatch ? steamIdMatch[1] : '',
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
  } catch (e) { res.status(500).json({ error: 'server_error', details: String(e) }); }
});

app.get('/api/my-applications', requireAuth, async (req, res) => {
  try {
    const all = await fetchApplicationsRaw();
    const applications = all.filter(a =>
      (req.user.discordId && a.discordId === req.user.discordId) ||
      (req.user.steamId && a.steamId === req.user.steamId) ||
      (req.user.steamId && a.steam && a.steam.includes(req.user.steamId))
    );
    res.json({ applications });
  } catch (e) { res.status(500).json({ error: 'server_error', details: String(e) }); }
});

/* ============ ИЗМЕНЕНИЕ ============ */
app.post('/api/applications/:id/change', requireAdmin, async (req, res) => {
  if (!canChangeDirectly(req.user)) return res.status(403).json({ error: 'not_allowed_directly' });
  const { newStatus } = req.body || {};
  if (!['approved', 'rejected', 'pending'].includes(newStatus)) return res.status(400).json({ error: 'bad_status' });
  try {
    const oldStatus = await getApplicationStatus(req.params.id);
    const owner = await getApplicationOwner(req.params.id);
    await applyStatusToDiscord(req.params.id, newStatus);
    appendHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      action: 'change', applicationId: req.params.id, applicationOwner: owner,
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
      action: 'delete', applicationId: req.params.id, applicationOwner: owner, oldStatus,
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
      action: 'change', applicationId: id, applicationOwner: owner,
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

/* ============ ЗАПРОСЫ ============ */
app.get('/api/change-requests', requireAdmin, async (req, res) => {
  if (!canApproveRequests(req.user)) return res.status(403).json({ error: 'forbidden' });
  const reqs = loadRequests();
  const apps = await getApplicationsMap();
  res.json({ requests: reqs.changes.filter(r => r.status === 'pending').map(r => ({ ...r, application: apps[r.applicationId] || null })) });
});
app.post('/api/change-requests', requireAdmin, async (req, res) => {
  const user = req.user;
  if (!canCreateRequest(user)) return res.status(403).json({ error: 'forbidden' });
  const { applicationId, newStatus, comment } = req.body || {};
  if (!applicationId || !['approved', 'rejected', 'pending'].includes(newStatus)) return res.status(400).json({ error: 'bad_data' });
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
      action: 'change', applicationId: request.applicationId, applicationOwner: owner,
      oldStatus, newStatus: request.newStatus,
      performedBy: user.id,
      performedByName: user.global_name || user.username,
      performedByAvatar: user.avatar,
      performedAt: new Date().toISOString(),
      method: 'approved_request'
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

app.get('/api/delete-requests', requireAdmin, async (req, res) => {
  if (!canApproveRequests(req.user)) return res.status(403).json({ error: 'forbidden' });
  const reqs = loadRequests();
  const apps = await getApplicationsMap();
  res.json({ requests: reqs.deletes.filter(r => r.status === 'pending').map(r => ({ ...r, application: apps[r.applicationId] || null })) });
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
      action: 'delete', applicationId: request.applicationId, applicationOwner: owner, oldStatus,
      performedBy: user.id,
      performedByName: user.global_name || user.username,
      performedByAvatar: user.avatar,
      performedAt: new Date().toISOString(),
      method: 'approved_request'
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

/* ============ ПЕРСОНАЛ ============ */
app.get('/api/staff', requireAdmin, async (req, res) => {
  if (!DISCORD_GUILD_ID) return res.status(500).json({ error: 'guild_not_configured' });
  try {
    const members = await discordGet(`/guilds/${DISCORD_GUILD_ID}/members?limit=1000`);
    const allRoles = await getGuildRoles();
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
  } catch (e) { res.status(500).json({ error: 'server_error', details: String(e) }); }
});

/* ============ ЖАЛОБЫ ============ */
app.get('/api/tickets', requireAdmin, async (req, res) => {
  if (!DISCORD_OPEN_TICKETS_CATEGORY_ID && !DISCORD_CLOSED_TICKETS_CATEGORY_ID) {
    return res.status(500).json({ error: 'category_not_configured' });
  }
  try {
    const channels = await discordGet(`/guilds/${DISCORD_GUILD_ID}/channels`);

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
  } catch (e) { res.status(500).json({ error: 'server_error', details: String(e) }); }
});

app.get('/api/tickets/:id/messages', requireAdmin, async (req, res) => {
  try {
    const r = await fetch(
      `https://discord.com/api/channels/${req.params.id}/messages?limit=100`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!r.ok) return res.status(500).json({ error: 'discord_error', details: await r.text() });
    const messages = await r.json();
    messages.reverse();
    res.json({
      messages: messages.map(m => ({
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
      }))
    });
  } catch (e) { res.status(500).json({ error: 'server_error', details: String(e) }); }
});

/* ============ ЛОГИ ============ */
app.get('/api/logs', requireHeadAdmin, async (req, res) => {
  if (!DISCORD_LOGS_CHANNEL_ID) return res.status(500).json({ error: 'channel_not_configured' });
  try {
    const r = await fetch(
      `https://discord.com/api/channels/${DISCORD_LOGS_CHANNEL_ID}/messages?limit=50`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!r.ok) return res.status(500).json({ error: 'discord_error', details: await r.text() });
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
  } catch (e) { res.status(500).json({ error: 'server_error', details: String(e) }); }
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
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString(), version: '1.0.0' });
});

/* ============ INIT ============ */
initPresence();

app.listen(PORT, () => {
  console.log(`\n✅ Fernodd API: http://localhost:${PORT}\n`);
});