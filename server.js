import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import { initPresence, getPresence, getAllPresence, getPresenceStats } from './presence.js';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

/* ============ ВАЛИДАЦИЯ ENV ============ */
if (!process.env.JWT_SECRET) {
  console.error('[env] ❌ Отсутствует обязательная переменная: JWT_SECRET');
  process.exit(1);
}
if (!process.env.MONGO_URL) console.warn('[env] ⚠️ MONGO_URL не задан — БД работать не будет');

const IS_RENDER = !!process.env.RENDER;
if (!IS_RENDER) app.use(express.static(__dirname));

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
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* ============ RATE LIMITER ============ */
const rateBuckets = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = (req.ip || req.connection?.remoteAddress || 'unknown') + ':' + req.path;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'rate_limit_exceeded', retryAfter: Math.ceil((bucket.reset - now) / 1000) });
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (now > v.reset) rateBuckets.delete(k);
}, 60000).unref?.();

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
  DISCORD_WEBHOOK_URL,
  MONGO_URL
} = process.env;

console.log('========================================');
console.log('  FERNODD API STARTUP');
console.log('========================================');
console.log('PORT:              ', PORT);
console.log('MONGO_URL:         ', MONGO_URL ? '✅' : '❌');
console.log('STEAM_API_KEY:     ', STEAM_API_KEY ? '✅' : '❌');
console.log('JWT_SECRET:        ', JWT_SECRET ? '✅' : '❌');
console.log('DISCORD_BOT_TOKEN: ', DISCORD_BOT_TOKEN ? '✅' : '❌');
console.log('DISCORD_CLIENT_ID: ', DISCORD_CLIENT_ID ? '✅' : '❌');
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

/* ============ ТОВАРЫ МАГАЗИНА ============ */
const SHOP_ITEMS = [
  {
    id: 'fernodd_plus',
    name: 'FERNODD+',
    description: 'Премиум-подписка с уникальными возможностями',
    color: '#fbbf24',
    roleName: 'fernodd+',
    tariffs: [
      { id: 'month',   label: '1 месяц',   price: 249,   days: 30  },
      { id: 'q3',      label: '3 месяца',  price: 499,   days: 90  },
      { id: 'q6',      label: '6 месяцев', price: 1199,  days: 180 },
      { id: 'year',    label: '1 год',     price: 2399,  days: 365 },
      { id: 'forever', label: 'Навсегда',  price: 24999, days: 0   },
    ]
  },
];

/* ============ MongoDB ============ */
let mongoDb = null;

async function initMongo() {
  if (!MONGO_URL) { console.warn('[mongo] MONGO_URL не задан'); return; }
  try {
    const client = new MongoClient(MONGO_URL);
    await client.connect();
    mongoDb = client.db('fernodd');
    console.log('[mongo] ✅ Подключено');
    await ensureIndexes();
  } catch (e) { console.error('[mongo] ❌', e.message); }
}

async function ensureIndexes() {
  if (!mongoDb) return;
  try {
    await mongoDb.collection('links').createIndex({ steamId: 1 }, { unique: true });
    await mongoDb.collection('balances').createIndex({ steamId: 1 }, { unique: true });
    await mongoDb.collection('promocodes').createIndex({ code: 1 }, { unique: true });
    await mongoDb.collection('promoUses').createIndex({ code: 1, userId: 1 });
    await mongoDb.collection('history').createIndex({ performedAt: -1 });
    await mongoDb.collection('orders').createIndex({ userId: 1, createdAt: -1 });
    await mongoDb.collection('transactions').createIndex({ userId: 1, createdAt: -1 });
    await mongoDb.collection('referrals').createIndex({ referrerId: 1 });
    await mongoDb.collection('referrals').createIndex({ invitedId: 1 });
    await mongoDb.collection('pendingRoles').createIndex({ userId: 1 }, { unique: true });
    await mongoDb.collection('referralCodes').createIndex({ steamId: 1 }, { unique: true });
    await mongoDb.collection('referralCodes').createIndex({ code: 1 }, { unique: true });
    await mongoDb.collection('subscriptions').createIndex({ steamId: 1 }, { unique: true });
    await mongoDb.collection('presence').createIndex({ steamId: 1 }, { unique: true });
    await mongoDb.collection('siteRoles').createIndex({ steamId: 1 });
    await mongoDb.collection('siteRoles').createIndex({ steamId: 1, roleName: 1 }, { unique: true });
    await mongoDb.collection('profiles').createIndex({ profileLink: 1 }, { unique: true, sparse: true });
    console.log('[mongo] ✅ Индексы готовы');
  } catch (e) { console.error('[mongo]', e.message); }
}

/* ============ ТРЕКИНГ ОНЛАЙНА ============ */
const lastPresenceUpdate = new Map();
app.use(async (req, res, next) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token && mongoDb) {
      const p = jwt.verify(token, JWT_SECRET);
      if (p?.steamId) {
        const last = lastPresenceUpdate.get(p.steamId) || 0;
        if (Date.now() - last > 60000) {
          lastPresenceUpdate.set(p.steamId, Date.now());
          mongoDb.collection('presence').updateOne(
            { steamId: p.steamId },
            { $set: { lastSeen: new Date().toISOString() } },
            { upsert: true }
          ).catch(() => {});
        }
      }
    }
  } catch {}
  next();
});

/* ============ Утилиты БД ============ */
async function getBalance(steamId) {
  if (!mongoDb) return 0;
  const doc = await mongoDb.collection('balances').findOne({ steamId });
  return doc?.amount || 0;
}
async function setBalance(steamId, amount) {
  if (!mongoDb) return;
  await mongoDb.collection('balances').updateOne(
    { steamId },
    { $set: { amount, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}
async function addBalance(steamId, delta) {
  if (!mongoDb) return delta;
  const result = await mongoDb.collection('balances').findOneAndUpdate(
    { steamId },
    { $inc: { amount: delta }, $set: { updatedAt: new Date().toISOString() } },
    { upsert: true, returnDocument: 'after' }
  );
  return result.value?.amount || delta;
}
async function getLink(steamId) {
  if (!mongoDb) return null;
  const doc = await mongoDb.collection('links').findOne({ steamId });
  return doc?.discordId || null;
}
async function setLink(steamId, discordId) {
  if (!mongoDb) return;
  await mongoDb.collection('links').updateOne(
    { steamId },
    { $set: { discordId, linkedAt: new Date().toISOString() } },
    { upsert: true }
  );
}
async function delLink(steamId) {
  if (!mongoDb) return;
  await mongoDb.collection('links').deleteOne({ steamId });
}
async function setPendingRole(userId, roleName) {
  if (!mongoDb) return;
  await mongoDb.collection('pendingRoles').updateOne(
    { userId },
    { $set: { roleName, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}
async function getPendingRole(userId) {
  if (!mongoDb) return null;
  const doc = await mongoDb.collection('pendingRoles').findOne({ userId });
  return doc?.roleName || null;
}
async function clearPendingRole(userId) {
  if (!mongoDb) return;
  await mongoDb.collection('pendingRoles').deleteOne({ userId });
}
async function addSiteRole(steamId, roleName, grantedBy, grantedByName) {
  if (!mongoDb) return;
  await mongoDb.collection('siteRoles').updateOne(
    { steamId, roleName },
    { $set: { steamId, roleName, grantedBy, grantedByName, grantedAt: new Date().toISOString() } },
    { upsert: true }
  );
}
async function getSiteRoles(steamId) {
  if (!mongoDb) return [];
  const docs = await mongoDb.collection('siteRoles').find({ steamId }).sort({ grantedAt: -1 }).toArray();
  return docs.map(d => d.roleName);
}
async function loadHistory() {
  if (!mongoDb) return [];
  const items = await mongoDb.collection('history').find({}).sort({ performedAt: -1 }).limit(500).toArray();
  return items.map(i => { delete i._id; return i; });
}
async function appendHistory(entry) {
  if (!mongoDb) return;
  await mongoDb.collection('history').insertOne({ ...entry });
}
async function logTransaction(steamId, userName, type, amount, currency, description) {
  if (!mongoDb) return;
  await mongoDb.collection('transactions').insertOne({
    userId: steamId, userName, type, amount, currency, description,
    createdAt: new Date().toISOString(),
  });
}
async function getProfileExtra(steamId) {
  if (!mongoDb) return {};
  const doc = await mongoDb.collection('profiles').findOne({ steamId });
  return doc || {};
}

/* ============ Discord helpers ============ */
async function discordGet(p) {
  const r = await fetch(`https://discord.com/api${p}`, {
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
  });
  if (!r.ok) throw new Error(`discord_error: ${r.status}`);
  return r.json();
}
async function discordPut(p) {
  const r = await fetch(`https://discord.com/api${p}`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
  });
  if (!r.ok && r.status !== 204) throw new Error('discord_error');
  return true;
}
async function discordDelete(p) {
  const r = await fetch(`https://discord.com/api${p}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
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
async function getGuildMember(id) {
  return discordGet(`/guilds/${DISCORD_GUILD_ID}/members/${id}`);
}
async function getUserStaffRoles(id) {
  try {
    const member = await getGuildMember(id);
    const allRoles = await getGuildRoles();
    const roleMap = {};
    allRoles.forEach(r => { roleMap[r.id] = r.name; });
    return (member.roles || [])
      .map(rid => roleMap[rid])
      .filter(name => name && STAFF_ROLE_NAMES_ALL.includes(name.toLowerCase()));
  } catch { return []; }
}
async function removeAllStaffRoles(id, keep = []) {
  try {
    const member = await getGuildMember(id);
    const allRoles = await getGuildRoles();
    const keepLower = keep.map(n => n.toLowerCase());
    const removeIds = allRoles
      .filter(r => {
        const n = r.name.toLowerCase();
        return STAFF_ROLE_NAMES_ALL.includes(n) && !keepLower.includes(n);
      })
      .map(r => r.id);
    const userSet = new Set(member.roles || []);
    for (const rid of removeIds.filter(x => userSet.has(x))) {
      try { await discordDelete(`/guilds/${DISCORD_GUILD_ID}/members/${id}/roles/${rid}`); } catch (e) {}
    }
  } catch (e) {}
}

/* ============ Права ============ */
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
function isHeadAdminOrOwner(u) {
  return !!(u && (u.isHeadAdmin || u.isOwner));
}
function isCurator(u) {
  return !!(u && (u.roles || []).some(r => r === 'Куратор'));
}
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

/* ============ STEAM OPENID ============ */
const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

app.get('/auth/steam', rateLimit(20, 60000), (req, res) => {
  if (!STEAM_API_KEY) return res.redirect(`${FRONTEND_URL}/?error=steam_no_key`);
  const ref = req.query.ref || '';
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': STEAM_RETURN_URL + (ref ? `?ref=${encodeURIComponent(ref)}` : ''),
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
    const refCode = req.query.ref || null;

    const vp = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (k === 'ref') continue;
      vp.append(k, v);
    }
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
      if (p) profile = {
        steamid: p.steamid,
        personaname: p.personaname,
        avatar: p.avatarfull || p.avatarmedium || p.avatar,
        profileurl: p.profileurl,
      };
    } catch {}

    if (refCode && mongoDb) {
      try {
        const refDoc = await mongoDb.collection('referralCodes').findOne({ code: refCode.toLowerCase() });
        if (refDoc && refDoc.steamId !== steamId) {
          const existing = await mongoDb.collection('referrals').findOne({ invitedId: steamId });
          if (!existing) {
            await mongoDb.collection('referrals').insertOne({
              referrerId: refDoc.steamId,
              invitedId: steamId,
              invitedName: profile.personaname,
              createdAt: new Date().toISOString(),
            });
            await addBalance(refDoc.steamId, 100);
          }
        }
      } catch (e) { console.error('[ref]', e); }
    }

    const isOwner = !!(OWNER_STEAM_ID && profile.steamid === OWNER_STEAM_ID);
    const isAdmin = isOwner || ADMIN_STEAM_LIST.includes(profile.steamid);
    let isHeadAdmin = isOwner;
    let roleNames = [];

    const linkedDiscordId = await getLink(profile.steamid);
    if (linkedDiscordId && DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
      try {
        const member = await getGuildMember(linkedDiscordId);
        const userRoles = member.roles || [];
        isAdmin = isAdmin || userRoles.some(r => ADMIN_ROLES.includes(r));
        isHeadAdmin = isHeadAdmin || userRoles.includes(ROLE_HEADADMIN);
        const allRoles = await getGuildRoles();
        roleNames = allRoles.filter(r => userRoles.includes(r.id)).map(r => r.name);
      } catch {}
    }

    const siteRoles = await getSiteRoles(profile.steamid);
    const allRoles = [...new Set([...roleNames, ...siteRoles])];
    const finalIsHeadAdmin = isHeadAdmin || siteRoles.includes('Главная администрация');
    const finalIsAdmin = isAdmin || ADMIN_ROLES.some(r => allRoles.includes(r)) || ADMIN_STEAM_LIST.includes(profile.steamid);

    const jwtToken = jwt.sign({
      id: profile.steamid,
      username: profile.personaname,
      global_name: profile.personaname,
      avatar: profile.avatar,
      steamId: profile.steamid,
      profileUrl: profile.profileurl,
      discordId: linkedDiscordId || null,
      isAdmin: finalIsAdmin, isOwner, isHeadAdmin: finalIsHeadAdmin,
      roles: allRoles,
      provider: 'steam',
    }, JWT_SECRET, { expiresIn: '7d' });

    res.redirect(`${FRONTEND_URL}/?token=${encodeURIComponent(jwtToken)}`);
  } catch (e) {
    console.error('[steam callback]', e);
    res.redirect(`${FRONTEND_URL}/?error=steam_callback`);
  }
});

/* ============ DISCORD OAUTH ============ */
app.get('/auth/discord', rateLimit(20, 60000), (req, res) => {
  if (!DISCORD_CLIENT_ID) return res.redirect(`${FRONTEND_URL}/profile?discord_error=not_configured`);
  const token = req.query.token || '';
  const state = Buffer.from(JSON.stringify({ token, t: Date.now() })).toString('base64');
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_OAUTH_REDIRECT,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'consent'
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.redirect(`${FRONTEND_URL}/profile?discord_error=no_code`);
  let userToken = null;
  try { userToken = JSON.parse(Buffer.from(state, 'base64').toString()).token; } catch {}
  if (!userToken) return res.redirect(`${FRONTEND_URL}/profile?discord_error=bad_state`);
  let user;
  try { user = jwt.verify(userToken, JWT_SECRET); }
  catch { return res.redirect(`${FRONTEND_URL}/profile?discord_error=bad_token`); }

  try {
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: DISCORD_OAUTH_REDIRECT,
    });
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if (!tokenRes.ok) return res.redirect(`${FRONTEND_URL}/profile?discord_error=token_failed`);
    const tokenData = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!userRes.ok) return res.redirect(`${FRONTEND_URL}/profile?discord_error=user_failed`);
    const discordUser = await userRes.json();

    try {
      const memberRes = await fetch(
        `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}`,
        { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
      );
      if (!memberRes.ok) return res.redirect(`${FRONTEND_URL}/profile?discord_error=not_in_guild`);
    } catch {
      return res.redirect(`${FRONTEND_URL}/profile?discord_error=guild_check_failed`);
    }

    await setLink(user.steamId, discordUser.id);

    try {
      const roles = await getGuildRoles();
      const siteRoles = await getSiteRoles(user.steamId);
      const pending1 = await getPendingRole(user.steamId);
      const pending2 = await getPendingRole(discordUser.id);
      const allRolesToApply = new Set([...siteRoles]);
      if (pending1) allRolesToApply.add(pending1);
      if (pending2) allRolesToApply.add(pending2);

      for (const roleName of allRolesToApply) {
        if (!roleName) continue;
        const role = roles.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        if (!role) { console.warn(`[role sync] Роль "${roleName}" не найдена`); continue; }
        try {
          await discordPut(`/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}/roles/${role.id}`);
        } catch (e) { console.error(`[role sync] Ошибка: ${role.name}`, e.message); }
      }

      await clearPendingRole(user.steamId);
      await clearPendingRole(discordUser.id);
    } catch (e) { console.error('[role sync]', e); }

    try {
      const roles = await getGuildRoles();
      const playerRole = roles.find(r => r.name.toLowerCase() === 'игрок');
      if (playerRole) {
        const member = await getGuildMember(discordUser.id);
        if (!member.roles.includes(playerRole.id)) {
          await discordPut(`/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}/roles/${playerRole.id}`);
        }
      }
    } catch {}

    return res.redirect(`${FRONTEND_URL}/profile?discord_linked=1`);
  } catch (e) {
    return res.redirect(`${FRONTEND_URL}/profile?discord_error=unknown`);
  }
});

/* ============ /api/me ============ */
app.get('/api/me', async (req, res) => {
  const p = getUserFromToken(req);
  if (!p) return res.json({ user: null });
  const balance = await getBalance(p.steamId);
  const discordId = await getLink(p.steamId);
  const siteRoles = await getSiteRoles(p.steamId);
  const allRoles = [...new Set([...(p.roles || []), ...siteRoles])];
  const isOwner = !!p.isOwner || !!(OWNER_STEAM_ID && p.steamId === OWNER_STEAM_ID);
  const isHeadAdmin = !!p.isHeadAdmin || isOwner || allRoles.includes('Главная администрация');
  const isAdmin = isOwner || isHeadAdmin || ADMIN_ROLES.some(r => allRoles.includes(r)) || ADMIN_STEAM_LIST.includes(p.steamId);
  res.json({
    user: {
      id: p.id,
      username: p.username,
      global_name: p.global_name,
      avatar: p.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
      steamId: p.steamId,
      profileUrl: p.profileUrl,
      discordId: discordId || p.discordId || null,
      isAdmin: !!isAdmin,
      isOwner: !!isOwner,
      isHeadAdmin: !!isHeadAdmin,
      roles: allRoles,
      siteRoles,
      provider: 'steam',
      balance,
    }
  });
});

/* ============ БАЛАНС ============ */
app.get('/api/balance', requireAuth, async (req, res) => {
  res.json({ balance: await getBalance(req.user.steamId) });
});

/* ============ ССЫЛКИ ============ */
app.post('/api/unlink-discord', requireAuth, async (req, res) => {
  await delLink(req.user.steamId);
  res.json({ ok: true });
});

app.get('/api/discord-info/:discordId', requireAuth, async (req, res) => {
  const { discordId } = req.params;
  if (!/^\d{17,20}$/.test(discordId)) return res.status(400).json({ error: 'bad_id' });
  try {
    const m = await getGuildMember(discordId);
    res.json({
      id: m.user.id,
      username: m.user.username,
      global_name: m.user.global_name,
      nickname: m.nick,
      avatar: m.user.avatar
        ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
    });
  } catch {
    res.status(404).json({ error: 'not_found' });
  }
});

/* ============ ДРУЗЬЯ ============ */
app.get('/api/friends', requireAuth, async (req, res) => {
  const steamId = req.user.steamId;
  if (!steamId || !STEAM_API_KEY) return res.json({ friends: [] });
  try {
    const r = await fetch(
      `https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${STEAM_API_KEY}&steamid=${steamId}&relationship=friend`
    );
    if (!r.ok) return res.json({ friends: [] });
    const data = await r.json();
    const friendIds = (data.friendslist?.friends || []).map(f => f.steamid);
    if (!friendIds.length) return res.json({ friends: [] });

    const idsStr = friendIds.join(',');
    const profilesRes = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${idsStr}`
    );
    const profilesData = await profilesRes.json();
    const players = profilesData.response?.players || [];

    const links = mongoDb ? await mongoDb.collection('links').find({}).toArray() : [];
    const linkedMap = {};
    links.forEach(l => { linkedMap[l.steamId] = l.discordId; });

    const friends = players.map(p => ({
      steamId: p.steamid,
      name: p.personaname,
      avatar: p.avatarfull || p.avatarmedium || p.avatar,
      profileUrl: p.profileurl,
      status: p.personastate === 0 ? 'offline' : (p.personastate === 1 ? 'online' : 'busy'),
      registered: !!linkedMap[p.steamid],
      registeredDiscordId: linkedMap[p.steamid] || null,
    }));

    res.json({ friends });
  } catch (e) {
    res.status(500).json({ error: 'server_error', details: String(e) });
  }
});

/* ============ ИНВЕНТАРЬ ============ */
app.get('/api/inventory', requireAuth, async (req, res) => {
  if (!mongoDb) return res.json({ items: [] });
  const orders = await mongoDb.collection('orders')
    .find({ userId: req.user.steamId })
    .sort({ createdAt: -1 })
    .toArray();

  const grouped = {};
  for (const o of orders) {
    const key = o.itemId || o.itemName;
    if (!grouped[key]) {
      grouped[key] = {
        itemId: o.itemId,
        itemName: (o.itemName || '').split(' — ')[0] || o.itemName,
        count: 0,
        totalPrice: 0,
        totalDays: 0,
        forever: false,
        firstPurchase: o.createdAt,
        lastPurchase: o.createdAt,
        purchases: [],
      };
    }
    const g = grouped[key];
    g.count++;
    g.totalPrice += o.price || 0;
    if (o.days === 0) g.forever = true;
    else g.totalDays += o.days || 0;
    g.purchases.push({ price: o.price, days: o.days, itemName: o.itemName, createdAt: o.createdAt });
    if (new Date(o.createdAt) < new Date(g.firstPurchase)) g.firstPurchase = o.createdAt;
    if (new Date(o.createdAt) > new Date(g.lastPurchase)) g.lastPurchase = o.createdAt;
  }

  const subscriptions = await mongoDb.collection('subscriptions').find({ steamId: req.user.steamId }).toArray();
  const subMap = {};
  subscriptions.forEach(s => { subMap[s.itemId] = s; });

  const items = Object.values(grouped).map(g => {
    const sub = subMap[g.itemId];
    const subForever = !!(sub && (sub.forever === true || (sub.expiresAt === null && sub.active)));
    const isForever = g.forever || subForever;
    return {
      itemId: g.itemId,
      itemName: g.itemName,
      count: g.count,
      totalPrice: g.totalPrice,
      totalDays: g.totalDays,
      forever: isForever,
      expiresAt: isForever ? null : (sub?.expiresAt || null),
      active: sub ? sub.active !== false : true,
      lastPurchase: g.lastPurchase,
      firstPurchase: g.firstPurchase,
      purchases: g.purchases,
    };
  });
  res.json({ items });
});

/* ============ ТРАНЗАКЦИИ ============ */
app.get('/api/transactions', requireAuth, async (req, res) => {
  if (!mongoDb) return res.json({ transactions: [] });
  const items = await mongoDb.collection('transactions')
    .find({ userId: req.user.steamId })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
  res.json({ transactions: items.map(i => { delete i._id; return i; }) });
});

/* ============ РЕФЕРАЛЫ ============ */
app.get('/api/referrals/my', requireAuth, async (req, res) => {
  if (!mongoDb) return res.json({ code: '', invited: [], earned: 0, cashback: 0 });
  let refDoc = await mongoDb.collection('referralCodes').findOne({ steamId: req.user.steamId });
  if (!refDoc) {
    let base = (req.user.username || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'user';
    let code = base;
    let tries = 0;
    while (await mongoDb.collection('referralCodes').findOne({ code }) && tries < 20) {
      code = base + Math.floor(100 + Math.random() * 900);
      tries++;
    }
    await mongoDb.collection('referralCodes').insertOne({
      steamId: req.user.steamId,
      code,
      createdAt: new Date().toISOString(),
    });
    refDoc = { code };
  }
  const invited = await mongoDb.collection('referrals')
    .find({ referrerId: req.user.steamId })
    .sort({ createdAt: -1 })
    .toArray();
  res.json({
    code: refDoc.code,
    fullCode: req.user.steamId,
    link: `${FRONTEND_URL}/auth/steam?ref=${refDoc.code}`,
    invited: invited.map(i => ({
      steamId: i.invitedId,
      name: i.invitedName,
      at: i.createdAt,
    })),
    earned: invited.length * 100,
    cashback: 0,
  });
});

app.post('/api/referrals/set-code', requireAuth, async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_code' });
  const clean = String(code).trim().toLowerCase();
  if (!/^[a-z0-9_\-]{3,20}$/.test(clean)) {
    return res.status(400).json({ error: 'bad_code_format' });
  }
  const existing = await mongoDb.collection('referralCodes').findOne({ code: clean });
  if (existing && existing.steamId !== req.user.steamId) {
    return res.status(400).json({ error: 'code_taken' });
  }
  await mongoDb.collection('referralCodes').updateOne(
    { steamId: req.user.steamId },
    { $set: { code: clean, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  res.json({ ok: true, code: clean });
});

app.post('/api/referrals/activate', requireAuth, rateLimit(10, 60000), async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_code' });
  const clean = String(code).trim().toLowerCase();

  const refDoc = await mongoDb.collection('referralCodes').findOne({ code: clean });
  if (!refDoc) return res.status(404).json({ error: 'user_not_found' });
  if (refDoc.steamId === req.user.steamId) return res.status(400).json({ error: 'self_ref' });

  const existing = await mongoDb.collection('referrals').findOne({ invitedId: req.user.steamId });
  if (existing) return res.status(400).json({ error: 'already_activated' });

  await mongoDb.collection('referrals').insertOne({
    referrerId: refDoc.steamId,
    invitedId: req.user.steamId,
    invitedName: req.user.global_name || req.user.username,
    createdAt: new Date().toISOString(),
  });

  await addBalance(refDoc.steamId, 100);
  await addBalance(req.user.steamId, 50);

  res.json({ ok: true });
});

app.get('/api/referrals/top', requireAuth, async (req, res) => {
  if (!mongoDb) return res.json({ top: [] });
  try {
    const pipeline = [
      { $group: { _id: '$referrerId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ];
    const raw = await mongoDb.collection('referrals').aggregate(pipeline).toArray();

    const top = [];
    for (const r of raw) {
      const link = await mongoDb.collection('links').findOne({ steamId: r._id });
      let name = 'Неизвестный';
      let avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
      let discordId = null;
      if (link && link.discordId && DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
        discordId = link.discordId;
        try {
          const m = await getGuildMember(link.discordId);
          name = m.nick || m.user.global_name || m.user.username;
          avatar = m.user.avatar
            ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png';
        } catch {}
      }
      top.push({
        steamId: r._id,
        discordId,
        name,
        avatar,
        count: r.count,
        completed: r.count,
      });
    }
    res.json({ top });
  } catch (e) {
    res.status(500).json({ error: 'server_error', details: String(e) });
  }
});

/* ============ PROFILE UPDATE ============ */
app.post('/api/profile/update', requireAuth, async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  const { description, backgroundUrl, profileLink, telegram, vk } = req.body || {};

  if (profileLink && !/^[a-zA-Z0-9_\-]{3,20}$/.test(profileLink)) {
    return res.status(400).json({ error: 'bad_link_format' });
  }

  const update = {};
  if (description !== undefined) update.description = String(description).slice(0, 200);
  if (backgroundUrl !== undefined) update.backgroundUrl = String(backgroundUrl).slice(0, 500);

  if (profileLink !== undefined && profileLink !== '') {
    const clean = String(profileLink).trim().toLowerCase();
    const existing = await mongoDb.collection('profiles').findOne({
      profileLink: clean,
      steamId: { $ne: req.user.steamId },
    });
    if (existing) return res.status(400).json({ error: 'link_taken' });
    update.profileLink = clean;
  } else if (profileLink === '') {
    update.profileLink = '';
  }

  if (telegram !== undefined) update.telegram = String(telegram).slice(0, 200);
  if (vk !== undefined) update.vk = String(vk).slice(0, 200);
  update.updatedAt = new Date().toISOString();

  await mongoDb.collection('profiles').updateOne(
    { steamId: req.user.steamId },
    { $set: update },
    { upsert: true }
  );

  res.json({ ok: true });
});

app.get('/api/profile/check-link', requireAuth, async (req, res) => {
  if (!mongoDb) return res.json({ available: true });
  const link = String(req.query.link || '').trim().toLowerCase();
  if (!link) return res.json({ available: true });
  if (!/^[a-z0-9_\-]{3,20}$/.test(link)) {
    return res.json({ available: false, reason: 'bad_format' });
  }
  try {
    const existing = await mongoDb.collection('profiles').findOne({
      profileLink: link,
      steamId: { $ne: req.user.steamId },
    });
    res.json({
      available: !existing,
      reason: existing ? 'taken' : null,
    });
  } catch {
    res.status(500).json({ error: 'server_error' });
  }
});

/* ============ PROMOCODES ============ */
app.get('/api/promocodes', requireOwner, async (req, res) => {
  if (!mongoDb) return res.json({ promocodes: [] });
  const items = await mongoDb.collection('promocodes').find({}).toArray();
  const result = [];
  for (const p of items) {
    const usedCount = await mongoDb.collection('promoUses').countDocuments({ code: p.code });
    delete p._id;
    result.push({ ...p, usedCount });
  }
  res.json({ promocodes: result });
});

app.post('/api/promocodes', requireOwner, async (req, res) => {
  const { code, amount, maxUses } = req.body || {};
  if (!code || !amount) return res.status(400).json({ error: 'missing_fields' });
  const clean = String(code).trim().toUpperCase();
  if (!/^[A-ZА-ЯЁ0-9_\-]{3,32}$/.test(clean)) return res.status(400).json({ error: 'bad_code_format' });
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });

  const existing = await mongoDb.collection('promocodes').findOne({ code: clean });
  if (existing) return res.status(400).json({ error: 'already_exists' });

  await mongoDb.collection('promocodes').insertOne({
    code: clean,
    amount: Number(amount),
    maxUses: Number(maxUses) || 0,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.global_name || req.user.username,
    active: true,
  });
  res.json({ ok: true, code: clean });
});

app.delete('/api/promocodes/:code', requireOwner, async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  await mongoDb.collection('promocodes').deleteOne({ code });
  res.json({ ok: true });
});

app.post('/api/promocodes/activate', requireAuth, rateLimit(10, 60000), async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_code' });
  const clean = String(code).trim().toUpperCase();
  if (!clean || clean.length < 3) return res.status(400).json({ error: 'missing_code' });
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });

  const promo = await mongoDb.collection('promocodes').findOne({ code: clean });
  if (!promo) return res.status(404).json({ error: 'not_found' });
  if (!promo.active) return res.status(400).json({ error: 'inactive' });

  const used = await mongoDb.collection('promoUses').findOne({ code: clean, userId: req.user.steamId });
  if (used) return res.status(400).json({ error: 'already_used_by_you' });

  const totalUses = await mongoDb.collection('promoUses').countDocuments({ code: clean });
  if (promo.maxUses > 0 && totalUses >= promo.maxUses) {
    return res.status(400).json({ error: 'limit_reached' });
  }

  const newBalance = await addBalance(req.user.steamId, promo.amount);
  await mongoDb.collection('promoUses').insertOne({
    code: clean,
    userId: req.user.steamId,
    userName: req.user.global_name || req.user.username,
    amount: promo.amount,
    usedAt: new Date().toISOString(),
  });
  await logTransaction(
    req.user.steamId,
    req.user.global_name || req.user.username,
    'income',
    promo.amount,
    'RUB',
    `Активация промокода ${clean}`
  );
  res.json({ ok: true, amount: promo.amount, newBalance });
});

/* ============ SHOP ============ */
app.get('/api/shop/items', async (req, res) => {
  res.json({
    items: SHOP_ITEMS.map(i => ({
      id: i.id,
      name: i.name,
      description: i.description,
      color: i.color,
      tariffs: i.tariffs.map(t => ({
        id: t.id,
        label: t.label,
        price: t.price,
        days: t.days,
      })),
    }))
  });
});

app.post('/api/shop/buy-subscription', requireAuth, async (req, res) => {
  const { itemId, tariffId } = req.body || {};
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return res.status(400).json({ error: 'item_not_found' });

  const tariff = item.tariffs.find(t => t.id === tariffId);
  if (!tariff) return res.status(400).json({ error: 'tariff_not_found' });

  const balance = await getBalance(req.user.steamId);
  if (balance < tariff.price) {
    return res.status(400).json({ error: 'insufficient_balance' });
  }

  await addBalance(req.user.steamId, -tariff.price);

  const roleName = item.roleName;
  const existing = mongoDb ? await mongoDb.collection('subscriptions').findOne({ steamId: req.user.steamId }) : null;
  const isForever = tariff.days === 0;

  let expiresAt = null;
  if (isForever) expiresAt = null;
  else if (existing && existing.forever) expiresAt = null;
  else if (existing && existing.expiresAt) {
    const baseTime = Math.max(Date.now(), new Date(existing.expiresAt).getTime());
    expiresAt = new Date(baseTime + tariff.days * 24 * 60 * 60 * 1000).toISOString();
  } else {
    expiresAt = new Date(Date.now() + tariff.days * 24 * 60 * 60 * 1000).toISOString();
  }

  const discordId = await getLink(req.user.steamId);
  let roleApplied = false;

  if (discordId && DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
    try {
      const roles = await getGuildRoles();
      const role = roles.find(r => r.name.toLowerCase() === roleName.toLowerCase());
      if (role) {
        await discordPut(`/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${role.id}`);
        roleApplied = true;
      }
    } catch (e) { console.error('[sub discord]', e); }
  } else {
    await setPendingRole(req.user.steamId, roleName);
  }

  if (mongoDb) {
    let roleId = null;
    try {
      const roles = await getGuildRoles();
      roleId = roles.find(x => x.name.toLowerCase() === roleName.toLowerCase())?.id || null;
    } catch {}

    await mongoDb.collection('subscriptions').updateOne(
      { steamId: req.user.steamId },
      {
        $set: {
          itemId: item.id,
          roleName,
          roleId,
          purchasedAt: new Date().toISOString(),
          expiresAt,
          forever: isForever || !!(existing?.forever),
          active: true,
          pending: !roleApplied,
          lastTariffId: tariff.id,
          lastTariffLabel: tariff.label,
        }
      },
      { upsert: true }
    );

    await mongoDb.collection('orders').insertOne({
      userId: req.user.steamId,
      userName: req.user.global_name || req.user.username,
      itemId: item.id,
      itemName: item.name,
      tariffId: tariff.id,
      tariffLabel: tariff.label,
      price: tariff.price,
      days: tariff.days,
      createdAt: new Date().toISOString(),
    });
  }

  await logTransaction(
    req.user.steamId,
    req.user.global_name || req.user.username,
    'outcome',
    tariff.price,
    'RUB',
    `Покупка ${item.name} (${tariff.label})`
  );

  await appendHistory({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    action: 'shop_buy_subscription',
    itemName: item.name,
    tariffLabel: tariff.label,
    price: tariff.price,
    roleApplied,
    performedBy: req.user.id,
    performedByName: req.user.global_name || req.user.username,
    performedByAvatar: req.user.avatar,
    performedAt: new Date().toISOString(),
  });

  const newBalance = await getBalance(req.user.steamId);
  res.json({
    ok: true,
    item: item.name,
    tariff: tariff.label,
    newBalance,
    expiresAt,
    roleApplied,
    pending: !roleApplied,
  });
});

app.get('/api/shop/orders/all', requireOwner, async (req, res) => {
  if (!mongoDb) return res.json({ orders: [] });
  const orders = await mongoDb.collection('orders')
    .find({})
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
  res.json({ orders: orders.map(o => { delete o._id; return o; }) });
});

/* ============ ВЫДАЧА РОЛЕЙ ============ */
app.get('/api/roles-list', requireAdmin, async (req, res) => {
  const allowed = getAssignableRolesFor(req.user);
  if (!allowed.length) return res.status(403).json({ error: 'forbidden' });
  try {
    const roles = await getGuildRoles();
    const allowedLower = allowed.map(n => n.toLowerCase());
    res.json({
      roles: roles
        .filter(r => allowedLower.includes(r.name.toLowerCase()))
        .map(r => ({
          id: r.id,
          name: r.name,
          color: r.color ? '#' + r.color.toString(16).padStart(6, '0') : '#ffffff',
        }))
    });
  } catch {
    res.status(500).json({ error: 'server_error' });
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
        const discordId = await getLink(p.steamid);
        const siteRoles = await getSiteRoles(p.steamid);
        results.push({
          steamId: p.steamid,
          personaName: p.personaname,
          avatar: p.avatarfull || p.avatarmedium || p.avatar,
          discordId: discordId || null,
          currentRole: siteRoles[0] || null,
          siteRoles,
        });
      }
    } catch {}
    return res.json({ users: results });
  }

  if (!mongoDb) return res.json({ users: [] });
  const links = await mongoDb.collection('links').find({}).toArray();
  const ids = links.map(l => l.steamId).filter(id => /^\d{17}$/.test(id));
  const profileMap = {};

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    try {
      const r = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${batch.join(',')}`
      );
      const data = await r.json();
      for (const p of (data.response?.players || [])) profileMap[p.steamid] = p;
    } catch (e) { console.warn('[steam-search batch]', e.message); }
  }

  const lower = q.toLowerCase();
  for (const l of links) {
    const p = profileMap[l.steamId];
    if (!p) continue;
    if (!p.personaname.toLowerCase().includes(lower)) continue;
    const siteRoles = await getSiteRoles(p.steamid);
    results.push({
      steamId: p.steamid,
      personaName: p.personaname,
      avatar: p.avatarfull || p.avatarmedium || p.avatar,
      discordId: l.discordId,
      currentRole: siteRoles[0] || null,
      siteRoles,
    });
    if (results.length >= 20) break;
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
  } catch {
    res.json({ currentRole: null });
  }
});

app.post('/api/give-role', requireAdmin, async (req, res) => {
  const allowed = getAssignableRolesFor(req.user);
  if (!allowed.length) return res.status(403).json({ error: 'forbidden' });
  const { steamId, discordId, roleId } = req.body || {};
  if (!roleId || (!steamId && !discordId)) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  try {
    const roles = await getGuildRoles();
    const role = roles.find(r => r.id === roleId);
    if (!role) return res.status(400).json({ error: 'role_not_found' });

    const allowedLower = allowed.map(n => n.toLowerCase());
    if (!allowedLower.includes(role.name.toLowerCase())) {
      return res.status(403).json({ error: 'role_not_assignable' });
    }

    if (steamId) await addSiteRole(steamId, role.name, req.user.id, req.user.global_name || req.user.username);

    const key = steamId || discordId;
    if (key) await setPendingRole(key, role.name);

    let appliedToDiscord = false;
    const linkedDiscord = steamId ? await getLink(steamId) : discordId;
    if (linkedDiscord && DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
      try {
        await removeAllStaffRoles(linkedDiscord, [role.name.toLowerCase()]);
        await discordPut(`/guilds/${DISCORD_GUILD_ID}/members/${linkedDiscord}/roles/${roleId}`);
        appliedToDiscord = true;
        await clearPendingRole(linkedDiscord);
        if (steamId) await clearPendingRole(steamId);
      } catch (e) {
        console.error('[give-role discord]', e);
      }
    }

    await appendHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      action: 'give_role',
      targetSteamId: steamId || null,
      targetDiscordId: linkedDiscord || null,
      roleName: role.name,
      performedBy: req.user.id,
      performedByName: req.user.global_name || req.user.username,
      performedByAvatar: req.user.avatar,
      performedAt: new Date().toISOString(),
      appliedToDiscord,
    });

    res.json({ ok: true, role: role.name, appliedToDiscord });
  } catch (e) {
    res.status(500).json({ error: 'server_error', details: String(e) });
  }
});

/* ============ АДМИН: БАЛАНСЫ ============ */
app.get('/api/admin/balances', requireHeadAdmin, async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  try {
    const balances = await mongoDb.collection('balances').find({}).sort({ amount: -1 }).toArray();
    const links = await mongoDb.collection('links').find({}).toArray();
    const linkMap = {};
    links.forEach(l => { linkMap[l.steamId] = l.discordId; });

    const allSteamIds = new Set([...balances.map(b => b.steamId), ...links.map(l => l.steamId)]);
    const result = [];

    for (const steamId of allSteamIds) {
      const balance = balances.find(b => b.steamId === steamId)?.amount || 0;
      const discordId = linkMap[steamId] || null;
      let username = 'Steam User';
      let avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

      if (discordId && DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
        try {
          const m = await discordGet(`/guilds/${DISCORD_GUILD_ID}/members/${discordId}`);
          username = m.nick || m.user.global_name || m.user.username;
          avatar = m.user.avatar
            ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png';
        } catch {}
      }
      if (username === 'Steam User') {
        try {
          const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`);
          const data = await r.json();
          const p = data.response?.players?.[0];
          if (p) { username = p.personaname; avatar = p.avatarfull || p.avatarmedium || p.avatar; }
        } catch {}
      }
      result.push({ steamId, discordId, balance, username, avatar });
    }
    result.sort((a, b) => b.balance - a.balance);
    res.json({ users: result });
  } catch (e) { console.error('[admin/balances]', e); res.status(500).json({ error: 'server_error', details: String(e) }); }
});

app.post('/api/admin/balance/change', requireHeadAdmin, async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  const { steamId, mode, amount } = req.body || {};
  if (!steamId || !mode || amount === undefined) return res.status(400).json({ error: 'missing_fields' });
  const delta = Number(amount);
  if (!Number.isFinite(delta) || delta <= 0) return res.status(400).json({ error: 'bad_amount' });
  if (!['add', 'subtract', 'set'].includes(mode)) return res.status(400).json({ error: 'bad_mode' });

  try {
    const current = await getBalance(steamId);
    let newAmount = current;
    if (mode === 'add') newAmount = current + delta;
    else if (mode === 'subtract') newAmount = Math.max(0, current - delta);
    else if (mode === 'set') newAmount = delta;

    await setBalance(steamId, newAmount);
    await logTransaction(
      steamId,
      req.user.global_name || req.user.username,
      mode === 'subtract' ? 'outcome' : 'income',
      mode === 'set' ? Math.abs(newAmount - current) : delta,
      'RUB',
      `[ADMIN] ${req.user.global_name || req.user.username}: ${mode === 'add' ? 'выдал' : mode === 'subtract' ? 'снял' : 'установил'} ${mode === 'set' ? newAmount : delta}₽`
    );
    await appendHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      action: 'balance_change',
      targetSteamId: steamId,
      oldBalance: current,
      newBalance: newAmount,
      mode,
      amount: delta,
      performedBy: req.user.id,
      performedByName: req.user.global_name || req.user.username,
      performedByAvatar: req.user.avatar,
      performedAt: new Date().toISOString(),
    });

    res.json({ ok: true, oldBalance: current, newBalance: newAmount });
  } catch (e) {
    console.error('[admin/balance/change]', e);
    res.status(500).json({ error: 'server_error', details: String(e) });
  }
});

/* ============ ПЕРСОНАЛ ============ */
app.get('/api/staff', requireAdmin, async (req, res) => {
  try {
    const members = await discordGet(`/guilds/${DISCORD_GUILD_ID}/members?limit=1000`);
    const allRoles = await getGuildRoles();
    const roleMap = {};
    allRoles.forEach(r => {
      roleMap[r.id] = { name: r.name, color: r.color, position: r.position };
    });

    let linksMap = {};
    if (mongoDb) {
      const links = await mongoDb.collection('links').find({}).toArray();
      links.forEach(l => { if (l.discordId && l.steamId) linksMap[l.discordId] = l.steamId; });
    }

    const staffMembers = members.filter(m =>
      m.roles.some(r => ALL_STAFF_ROLES.includes(r))
    );
    const administrators = [];
    const moderators = [];

    for (const m of staffMembers) {
      const isAdmin = m.roles.some(r => ADMIN_ROLES.includes(r));
      const roles = m.roles
        .map(id => roleMap[id])
        .filter(Boolean)
        .filter(r => r.name !== '@everyone')
        .sort((a, b) => b.position - a.position);
      const topRole = roles[0] || { name: 'Участник', color: 0 };
      const memberData = {
        id: m.user.id,
        steamId: linksMap[m.user.id] || null,
        username: m.user.username,
        global_name: m.user.global_name,
        nickname: m.nick,
        avatar: m.user.avatar
          ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/0.png`,
        joinedAt: m.joined_at,
        topRole: topRole.name,
        topRoleColor: topRole.color ? '#' + topRole.color.toString(16).padStart(6, '0') : '#ffffff',
        roles: roles.map(r => r.name),
        isAdmin,
        presence: await getPresence(m.user.id),
      };
      if (isAdmin) administrators.push(memberData);
      else moderators.push(memberData);
    }
    administrators.sort((a, b) => b.roles.length - a.roles.length);
    moderators.sort((a, b) => b.roles.length - a.roles.length);
    res.json({ administrators, moderators });
  } catch (e) {
    console.error('[staff]', e);
    res.status(500).json({ error: 'server_error' });
  }
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
            preview = (last.content || last.embeds?.[0]?.description || '').slice(0, 120);
            lastAuthor = last.author.global_name || last.author.username;
            lastDate = last.timestamp;
          }
        }
      } catch {}
      return { id: c.id, name: c.name, preview, lastAuthor, lastDate };
    }

    const openCh = DISCORD_OPEN_TICKETS_CATEGORY_ID
      ? channels.filter(c => c.parent_id === DISCORD_OPEN_TICKETS_CATEGORY_ID && c.type === 0)
      : [];
    const closedCh = DISCORD_CLOSED_TICKETS_CATEGORY_ID
      ? channels.filter(c => c.parent_id === DISCORD_CLOSED_TICKETS_CATEGORY_ID && c.type === 0)
      : [];

    const [open, closed] = await Promise.all([
      Promise.all(openCh.map(buildTicket)),
      Promise.all(closedCh.map(buildTicket))
    ]);

    const sortNewest = (a, b) =>
      Number(BigInt(b.id) >> 22n) - Number(BigInt(a.id) >> 22n);
    open.sort(sortNewest);
    closed.sort(sortNewest);

    res.json({ open, closed });
  } catch {
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/tickets/:id/messages', requireAdmin, async (req, res) => {
  try {
    const r = await fetch(
      `https://discord.com/api/channels/${req.params.id}/messages?limit=100`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!r.ok) return res.status(500).json({ error: 'discord_error' });
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
        attachments: (m.attachments || []).map(a => ({
          url: a.url,
          type: a.content_type || ''
        })),
        date: m.timestamp
      }))
    });
  } catch {
    res.status(500).json({ error: 'server_error' });
  }
});

/* ============ ЛОГИ ============ */
app.get('/api/logs', requireHeadAdmin, async (req, res) => {
  if (!DISCORD_LOGS_CHANNEL_ID) return res.status(500).json({ error: 'channel_not_configured' });
  try {
    const r = await fetch(
      `https://discord.com/api/channels/${DISCORD_LOGS_CHANNEL_ID}/messages?limit=50`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!r.ok) return res.status(500).json({ error: 'discord_error' });
    const messages = await r.json();
    res.json({
      logs: messages.map(m => {
        const embed = m.embeds?.[0] || null;
        return {
          id: m.id,
          date: m.timestamp,
          authorName: m.author.global_name || m.author.username,
          avatar: m.author.avatar
            ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/0.png`,
          content: m.content || '',
          embedTitle: embed?.title || '',
          embedDescription: embed?.description || '',
          embedFields: (embed?.fields || []).map(f => ({
            name: f.name,
            value: f.value,
            inline: !!f.inline
          })),
          embedColor: embed?.color || null,
          embedImage: embed?.image?.url || '',
          attachments: (m.attachments || []).map(a => ({
            url: a.url,
            type: a.content_type || '',
            name: a.filename || ''
          }))
        };
      })
    });
  } catch {
    res.status(500).json({ error: 'server_error' });
  }
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

/* ============ ПРОФИЛЬ (публичный) ============ */
app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let steamId = null;

    if (/^\d{17}$/.test(id)) {
      steamId = id;
    } else if (/^\d{18,20}$/.test(id) && mongoDb) {
      const link = await mongoDb.collection('links').findOne({ discordId: id });
      if (link) steamId = link.steamId;
    } else if (mongoDb) {
      const prof = await mongoDb.collection('profiles').findOne({
        profileLink: String(id).toLowerCase(),
      });
      if (prof) steamId = prof.steamId;
    }

    if (!steamId) return res.status(404).json({ error: 'not_found' });

    let profile = { steamid: steamId, personaname: 'Steam User', avatar: '' };
    try {
      const r = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`
      );
      const data = await r.json();
      const p = data.response?.players?.[0];
      if (p) profile = {
        steamid: p.steamid,
        personaname: p.personaname,
        avatar: p.avatarfull || p.avatarmedium || p.avatar,
        profileurl: p.profileurl,
      };
    } catch {}

    const discordId = await getLink(profile.steamid);
    let discordInfo = null;
    if (discordId && DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
      try {
        const m = await getGuildMember(discordId);
        const roles = await getGuildRoles();
        const roleMap = {};
        roles.forEach(r => { roleMap[r.id] = r; });
        const userRoles = m.roles.map(rid => roleMap[rid]).filter(Boolean)
          .filter(r => r.name !== '@everyone')
          .sort((a, b) => b.position - a.position);
        const topRole = userRoles[0] || { name: 'Участник', color: 0 };
        discordInfo = {
          id: m.user.id,
          username: m.user.username,
          global_name: m.user.global_name,
          nickname: m.nick,
          avatar: m.user.avatar
            ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/0.png`,
          joinedAt: m.joined_at,
          roles: userRoles.map(r => r.name),
          topRole: topRole.name,
          topRoleColor: topRole.color ? '#' + topRole.color.toString(16).padStart(6, '0') : '#ffffff',
        };
      } catch {}
    }

    let siteStatus = 'offline';
    let lastSeen = null;
    if (mongoDb) {
      const presence = await mongoDb.collection('presence').findOne({ steamId: profile.steamid });
      if (presence?.lastSeen) {
        lastSeen = presence.lastSeen;
        const diff = Date.now() - new Date(presence.lastSeen).getTime();
        if (diff < 5 * 60 * 1000) siteStatus = 'online';
      }
    }

    const balance = await getBalance(profile.steamid);
    const profileExtra = await getProfileExtra(profile.steamid);
    const siteRoles = await getSiteRoles(profile.steamid);

    const allRoles = [...siteRoles, ...(discordInfo ? discordInfo.roles : [])].filter((v, i, a) => a.indexOf(v) === i);
    const ROLE_PRIORITY = ['Главная администрация', 'Владелец', 'Разработчик', 'Следящий', 'Куратор', 'Главный модератор', 'Старший модератор', 'Модератор', 'Поддержка', 'Медиа', 'Игрок'];
    const topRole = ROLE_PRIORITY.find(r => allRoles.includes(r)) || 'Игрок';
    const COLORS = {
      'Главная администрация': '#e10600', 'Владелец': '#e10600', 'Разработчик': '#e10600',
      'Следящий': '#e10600', 'Куратор': '#e10600', 'Поддержка': '#e10600', 'Медиа': '#e10600',
      'Главный модератор': '#22d3ee', 'Старший модератор': '#4ade80',
      'Модератор': '#3b82f6', 'Игрок': '#a855f7',
    };

    res.json({
      user: {
        id: profile.steamid,
        steamId: profile.steamid,
        username: profile.personaname,
        global_name: profile.personaname,
        nickname: profile.personaname,
        avatar: profile.avatar,
        profileUrl: profile.profileurl,
        discordId: discordId || null,
        discord: discordInfo,
        roles: allRoles,
        topRole,
        topRoleColor: COLORS[topRole] || '#ffffff',
        siteRoles,
        siteStatus,
        lastSeen,
        provider: 'steam',
        balance,
        description: profileExtra.description || 'Is it worth it?',
        backgroundUrl: profileExtra.backgroundUrl || '',
        profileLink: profileExtra.profileLink || '',
        telegram: profileExtra.telegram || '',
        vk: profileExtra.vk || '',
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
  if (!age || !experience || !online || !motivation) {
    return res.status(400).json({ error: 'missing_fields' });
  }
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
  } catch {
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
  if (!r.ok) throw new Error('discord_error');
  const messages = await r.json();

  let overrides = {};
  if (mongoDb) {
    const doc = await mongoDb.collection('kv').findOne({ _id: 'overrides' });
    overrides = doc?.data || {};
  }

  return messages
    .filter(m => m.embeds?.length)
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
        id: m.id,
        date: m.timestamp,
        authorId: m.author.id,
        authorName: m.author.username,
        avatar: e.thumbnail?.url || `https://cdn.discordapp.com/embed/avatars/0.png`,
        age: fields['Возраст'] || '',
        online: fields['Онлайн в день'] || '',
        experience: fields['Опыт модерации'] || '',
        motivation: fields['Мотивация'] || '',
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
    const apps = await fetchApplicationsRaw();
    res.json({ applications: apps });
  } catch (e) {
    res.status(500).json({ error: 'server_error', details: String(e) });
  }
});

app.get('/api/my-applications', requireAuth, async (req, res) => {
  try {
    const all = await fetchApplicationsRaw();
    const applications = all.filter(a =>
      (req.user.discordId && a.discordId === req.user.discordId) ||
      (req.user.steamId && a.steamId === req.user.steamId)
    );
    res.json({ applications });
  } catch {
    res.status(500).json({ error: 'server_error' });
  }
});

/* ============ СТАТУСЫ ЗАЯВОК ============ */
async function setOverride(id, status) {
  if (!mongoDb) return;
  const doc = await mongoDb.collection('kv').findOne({ _id: 'overrides' });
  const data = doc?.data || {};
  if (status === null || status === undefined) delete data[id];
  else data[id] = status;
  await mongoDb.collection('kv').updateOne(
    { _id: 'overrides' },
    { $set: { data } },
    { upsert: true }
  );
}

async function applyStatusToDiscord(messageId, newStatus) {
  const channelId = DISCORD_APPLY_CHANNEL_ID;
  await setOverride(messageId, newStatus);
  for (const emoji of ['✅', '❌']) {
    try {
      await fetch(
        `https://discord.com/api/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
        { method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
      );
    } catch {}
  }
  if (newStatus === 'approved' || newStatus === 'rejected') {
    const emoji = newStatus === 'approved' ? '✅' : '❌';
    try {
      await fetch(
        `https://discord.com/api/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
        { method: 'PUT', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
      );
    } catch {}
  }
}

async function getApplicationOwner(id) {
  try {
    const r = await fetch(
      `https://discord.com/api/channels/${DISCORD_APPLY_CHANNEL_ID}/messages/${id}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!r.ok) return '—';
    const m = await r.json();
    const f = (m.embeds?.[0]?.fields || []).find(x => x.name === 'Discord');
    return f ? f.value : '—';
  } catch {
    return '—';
  }
}

async function getApplicationStatus(id) {
  if (mongoDb) {
    const doc = await mongoDb.collection('kv').findOne({ _id: 'overrides' });
    const overrides = doc?.data || {};
    if (overrides[id]) return overrides[id];
  }
  try {
    const r = await fetch(
      `https://discord.com/api/channels/${DISCORD_APPLY_CHANNEL_ID}/messages/${id}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!r.ok) return 'unknown';
    const m = await r.json();
    if (m.reactions?.some(x => x.emoji.name === '✅')) return 'approved';
    if (m.reactions?.some(x => x.emoji.name === '❌')) return 'rejected';
    return 'pending';
  } catch {
    return 'unknown';
  }
}

app.post('/api/applications/:id/:action', requireAdmin, async (req, res) => {
  const { id, action } = req.params;
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'bad_action' });
  }
  if (!canChangeDirectly(req.user)) {
    return res.status(403).json({ error: 'not_allowed_directly' });
  }
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  try {
    const oldStatus = await getApplicationStatus(id);
    const owner = await getApplicationOwner(id);
    await applyStatusToDiscord(id, newStatus);
    await appendHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      action: 'change',
      applicationId: id,
      applicationOwner: owner,
      oldStatus,
      newStatus,
      performedBy: req.user.id,
      performedByName: req.user.global_name || req.user.username,
      performedByAvatar: req.user.avatar,
      performedAt: new Date().toISOString(),
      method: 'direct'
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'discord_error' });
  }
});

app.post('/api/applications/:id/change', requireAdmin, async (req, res) => {
  if (!canChangeDirectly(req.user)) {
    return res.status(403).json({ error: 'not_allowed_directly' });
  }
  const { newStatus } = req.body || {};
  if (!['approved', 'rejected', 'pending'].includes(newStatus)) {
    return res.status(400).json({ error: 'bad_status' });
  }
  try {
    const oldStatus = await getApplicationStatus(req.params.id);
    const owner = await getApplicationOwner(req.params.id);
    await applyStatusToDiscord(req.params.id, newStatus);
    await appendHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      action: 'change',
      applicationId: req.params.id,
      applicationOwner: owner,
      oldStatus,
      newStatus,
      performedBy: req.user.id,
      performedByName: req.user.global_name || req.user.username,
      performedByAvatar: req.user.avatar,
      performedAt: new Date().toISOString(),
      method: 'direct'
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'discord_error' });
  }
});

app.delete('/api/applications/:id', requireAdmin, async (req, res) => {
  if (!canDeleteDirectly(req.user)) {
    return res.status(403).json({ error: 'not_allowed_directly' });
  }
  try {
    const owner = await getApplicationOwner(req.params.id);
    const oldStatus = await getApplicationStatus(req.params.id);
    const r = await fetch(
      `https://discord.com/api/channels/${DISCORD_APPLY_CHANNEL_ID}/messages/${req.params.id}`,
      { method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (!r.ok && r.status !== 204 && r.status !== 404) throw new Error('del_failed');
    await setOverride(req.params.id, null);
    await appendHistory({
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
  } catch {
    res.status(500).json({ error: 'discord_error' });
  }
});

/* ============ ИСТОРИЯ ============ */
app.get('/api/applications-history', requireAdmin, async (req, res) => {
  if (!isWatcherOrAbove(req.user)) return res.status(403).json({ error: 'forbidden' });
  res.json({ history: await loadHistory() });
});

/* ============ ANALYTICS ============ */
app.get('/api/analytics-data', requireAdmin, async (req, res) => {
  try {
    const apps = await fetchApplicationsRaw();
    const hist = await loadHistory();

    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      days.push({
        label: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
        date: d,
        apps: 0,
        actions: 0
      });
    }

    apps.forEach(a => {
      const d = new Date(a.date);
      d.setHours(0, 0, 0, 0);
      const day = days.find(x => x.date.getTime() === d.getTime());
      if (day) day.apps++;
    });

    hist.forEach(h => {
      const d = new Date(h.performedAt);
      d.setHours(0, 0, 0, 0);
      const day = days.find(x => x.date.getTime() === d.getTime());
      if (day) day.actions++;
    });

    const staffMap = {};
    hist.forEach(h => {
      const key = h.performedBy;
      if (!key) return;
      if (!staffMap[key]) staffMap[key] = {
        id: key,
        name: h.performedByName || 'Неизвестный',
        avatar: h.performedByAvatar || '',
        count: 0
      };
      staffMap[key].count++;
    });
    const topStaff = Object.values(staffMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const stats = {
      pending: apps.filter(a => a.status === 'pending').length,
      approved: apps.filter(a => a.status === 'approved').length,
      rejected: apps.filter(a => a.status === 'rejected').length
    };

    res.json({ days, topStaff, stats });
  } catch (e) {
    res.status(500).json({ error: 'server_error', details: String(e) });
  }
});

/* ============ PRESENCE ============ */
app.get('/api/presence', requireAdmin, async (req, res) => res.json(await getPresenceStats()));
app.get('/api/presence/:id', requireAdmin, async (req, res) => res.json(await getPresence(req.params.id)));
app.get('/api/presence-all', requireAdmin, async (req, res) => res.json({ presence: await getAllPresence() }));

/* ============ HEALTH ============ */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    mongo: !!mongoDb,
    timestamp: new Date().toISOString()
  });
});

/* ============ АВТОСНЯТИЕ ПОДПИСОК ============ */
async function checkExpiredSubscriptions() {
  if (!mongoDb || !DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) return;
  try {
    const now = new Date().toISOString();
    const expired = await mongoDb.collection('subscriptions').find({
      active: true,
      pending: false,
      forever: { $ne: true },
      expiresAt: { $ne: null, $lte: now },
    }).toArray();

    let rolesCacheLocal = null;
    for (const sub of expired) {
      try {
        const discordId = await getLink(sub.steamId);
        if (discordId) {
          let roleId = sub.roleId;
          if (!roleId && sub.roleName) {
            if (!rolesCacheLocal) rolesCacheLocal = await getGuildRoles();
            roleId = rolesCacheLocal.find(r => r.name.toLowerCase() === sub.roleName.toLowerCase())?.id;
          }
          if (roleId) {
            try {
              await discordDelete(`/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`);
            } catch (e) { console.warn('[expire discord]', e.message); }
          }
        }
        await mongoDb.collection('subscriptions').updateOne(
          { _id: sub._id },
          { $set: { active: false, expiredAt: new Date().toISOString() } }
        );
      } catch (e) { console.error('[subscription expire]', e); }
    }
  } catch (e) { console.error('[checkExpiredSubscriptions]', e); }
}

/* ============ ERROR HANDLER ============ */
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'server_error' });
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

/* ============ INIT ============ */
initPresence();
initMongo().then(() => {
  setInterval(checkExpiredSubscriptions, 30 * 60 * 1000);
  setTimeout(checkExpiredSubscriptions, 10000);
  app.listen(PORT, () => console.log(`\n✅ Fernodd API: http://localhost:${PORT}\n`));
});