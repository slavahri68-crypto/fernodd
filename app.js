import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { MongoClient } from 'mongodb';

/* ============ PRESENCE ЗАГЛУШКИ ============ */
async function getPresence(id) { return { status: 'offline', activities: [], updatedAt: Date.now() }; }
async function getAllPresence() { return {}; }
async function getPresenceStats() { return { online: 0, idle: 0, dnd: 0, offline: 0, total: 0, ready: false }; }

if (!process.env.JWT_SECRET) {
  console.error('[env] Отсутствует JWT_SECRET');
  process.exit(1);
}
if (!process.env.MONGO_URL) console.warn('[env] MONGO_URL не задан');

const app = express();
app.use(express.json({ limit: '100kb' }));

/* ============ CORS ============ */
const ALLOWED_ORIGINS = [
  'https://fernodd.netlify.app',
  'https://fernodd.onrender.com',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:10000',
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) res.header('Access-Control-Allow-Origin', origin);
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
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
    const key = ip + ':' + req.path;
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
  STEAM_API_KEY, STEAM_REALM = 'http://localhost:3000', STEAM_RETURN_URL = 'http://localhost:3000/auth/steam/callback',
  OWNER_STEAM_ID, ADMIN_STEAM_IDS = '', DISCORD_BOT_TOKEN, DISCORD_GUILD_ID,
  DISCORD_APPLY_CHANNEL_ID, DISCORD_LOGS_CHANNEL_ID, DISCORD_PURCHASE_CHANNEL_ID,
  DISCORD_ROLES_CHANNEL_ID, DISCORD_PRIVILEGES_CHANNEL_ID, DISCORD_PRIVILEGES_REVOKE_CHANNEL_ID,
  DISCORD_ROLES_REVOKE_CHANNEL_ID, DISCORD_BALANCE_CHANNEL_ID, DISCORD_SITE_LOGS_CHANNEL_ID,
  DISCORD_ERRORS_CHANNEL_ID, DISCORD_OPEN_TICKETS_CATEGORY_ID, DISCORD_CLOSED_TICKETS_CATEGORY_ID,
  DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_OAUTH_REDIRECT = 'http://localhost:3000/auth/discord/callback',
  ROLE_CURATOR, ROLE_WATCHER, ROLE_HEADADMIN, ROLE_MODERATOR, ROLE_SENIOR_MODERATOR, ROLE_CHIEF_MODERATOR,
  FRONTEND_URL = 'http://localhost:3000', JWT_SECRET, DISCORD_WEBHOOK_URL, MONGO_URL, ERROR_RATE_LIMIT_MS = '60000',
} = process.env;

const ADMIN_ROLES = [ROLE_CURATOR, ROLE_WATCHER, ROLE_HEADADMIN].filter(Boolean);
const MODERATOR_ROLES = [ROLE_MODERATOR, ROLE_SENIOR_MODERATOR, ROLE_CHIEF_MODERATOR].filter(Boolean);
const ALL_STAFF_ROLES = [...ADMIN_ROLES, ...MODERATOR_ROLES];
const ADMIN_STEAM_LIST = ADMIN_STEAM_IDS.split(',').map(s => s.trim()).filter(Boolean);
const STAFF_ROLE_NAMES_ALL = ['модератор', 'старший модератор', 'главный модератор', 'куратор', 'следящий', 'главная администрация'];

const ROLE_PRIORITY = ['Владелец', 'Главная администрация', 'Следящий', 'Куратор', 'Главный модератор', 'Старший модератор', 'Модератор', 'Игрок'];
const ROLE_COLORS = {
  'Владелец': '#5865f2', 'Главная администрация': '#5865f2', 'Техническая поддержка': '#5865f2',
  'Следящий': '#f0b232', 'Куратор': '#f0b232', 'Главный модератор': '#00a8fc',
  'Старший модератор': '#23a55a', 'Модератор': '#5865f2', 'Игрок': '#a855f7',
};

const NON_REMOVABLE_ROLES = ['Модератор', 'Старший модератор', 'Главный модератор', 'Медиа', 'Разработчик', 'Куратор', 'Следящий', 'Техническая поддержка', 'Главная администрация', 'Владелец'];
const HIDDEN_FROM_INVENTORY = ['Главная администрация', 'Владелец'];
const STAFF_ROLES_FOR_REMOVE = ['Модератор', 'Старший модератор', 'Главный модератор', 'Куратор', 'Следящий', 'Главная администрация'];

const SHOP_ITEMS = [{
  id: 'fernodd_plus', name: 'FERNODD+', description: 'Премиум-подписка с уникальными возможностями', color: '#fbbf24', roleName: 'fernodd+',
  tariffs: [
    { id: 'month', label: '1 месяц', price: 249, days: 30 }, { id: 'q3', label: '3 месяца', price: 499, days: 90 },
    { id: 'q6', label: '6 месяцев', price: 1199, days: 180 }, { id: 'year', label: '1 год', price: 2399, days: 365 },
    { id: 'forever', label: 'Навсегда', price: 24999, days: 0 },
  ],
}];

const PRIVILEGES = [{ id: 'fernodd_plus', name: 'FERNODD+', description: 'Премиум-подписка', color: '#fbbf24', roleName: 'fernodd+' }];

const STREAK_REWARDS = [{ milestone: 3, amount: 35, label: '35 ₽' }, { milestone: 7, amount: 5, label: '5 ₽' }, { milestone: 14, amount: 30, label: '30 ₽' }];

const ROULETTE_PRIZES_DEFAULT = [
  { amount: 5, weight: 25, tier: 'blue' }, { amount: 10, weight: 18, tier: 'blue' }, { amount: 15, weight: 14, tier: 'blue' },
  { amount: 25, weight: 11, tier: 'blue' }, { amount: 30, weight: 8, tier: 'blue' }, { amount: 35, weight: 7, tier: 'blue' },
  { amount: 40, weight: 6, tier: 'blue' }, { amount: 45, weight: 4, tier: 'blue' }, { amount: 50, weight: 2.5, tier: 'purple' },
  { amount: 100, weight: 1.5, tier: 'purple' }, { amount: 300, weight: 0.7, tier: 'red' }, { amount: 500, weight: 0.4, tier: 'red' },
  { amount: 1000, weight: 0.1, tier: 'red' }, { amount: 0, weight: 1.8, tier: 'empty' },
];
const ROULETTE_COOLDOWN_DAYS = 7;
const ROULETTE_PAID_PRICE = 99;
const ROULETTE_FREE_SPINS_DEFAULT = 1;
const ROULETTE_FREE_SPINS_PLUS = 2;

let mongoDb = null;

/* ============ БД ФУНКЦИИ ============ */
async function getBalance(steamId) { if (!mongoDb) return 0; const doc = await mongoDb.collection('balances').findOne({ steamId }); return doc?.amount || 0; }
async function setBalance(steamId, amount) { if (!mongoDb) return; await mongoDb.collection('balances').updateOne({ steamId }, { $set: { amount, updatedAt: new Date().toISOString() } }, { upsert: true }); }
async function addBalance(steamId, delta) { if (!mongoDb) return delta; const result = await mongoDb.collection('balances').findOneAndUpdate({ steamId }, { $inc: { amount: delta }, $set: { updatedAt: new Date().toISOString() } }, { upsert: true, returnDocument: 'after' }); return result?.amount ?? delta; }
async function getLink(steamId) { if (!mongoDb) return null; const doc = await mongoDb.collection('links').findOne({ steamId }); return doc?.discordId || null; }
async function setLink(steamId, discordId) { if (!mongoDb) return; await mongoDb.collection('links').updateOne({ steamId }, { $set: { discordId, linkedAt: new Date().toISOString() } }, { upsert: true }); }
async function delLink(steamId) { if (!mongoDb) return; await mongoDb.collection('links').deleteOne({ steamId }); }
async function setPendingRole(userId, roleName) { if (!mongoDb) return; await mongoDb.collection('pendingRoles').updateOne({ userId }, { $set: { roleName, updatedAt: new Date().toISOString() } }, { upsert: true }); }
async function getPendingRole(userId) { if (!mongoDb) return null; const doc = await mongoDb.collection('pendingRoles').findOne({ userId }); return doc?.roleName || null; }
async function clearPendingRole(userId) { if (!mongoDb) return; await mongoDb.collection('pendingRoles').deleteOne({ userId }); }
async function addSiteRole(steamId, roleName, grantedBy, grantedByName) { if (!mongoDb) return; await mongoDb.collection('siteRoles').updateOne({ steamId, roleName }, { $set: { steamId, roleName, grantedBy, grantedByName, grantedAt: new Date().toISOString() } }, { upsert: true }); }
async function getSiteRoles(steamId) { if (!mongoDb) return []; const docs = await mongoDb.collection('siteRoles').find({ steamId }).sort({ grantedAt: -1 }).toArray(); return docs.map(d => d.roleName); }
async function loadHistory() { if (!mongoDb) return []; const items = await mongoDb.collection('history').find({}).sort({ performedAt: -1 }).limit(500).toArray(); return items.map(i => { delete i._id; return i; }); }
async function appendHistory(entry) { if (!mongoDb) return; await mongoDb.collection('history').insertOne({ ...entry }); }
async function logTransaction(steamId, userName, type, amount, currency, description) { if (!mongoDb) return; await mongoDb.collection('transactions').insertOne({ userId: steamId, userName, type, amount, currency, description, createdAt: new Date().toISOString() }); }
async function getProfileExtra(steamId) { if (!mongoDb) return {}; return (await mongoDb.collection('profiles').findOne({ steamId })) || {}; }

function getMoscowDateKey(date = new Date()) { const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000); const y = msk.getUTCFullYear(); const m = String(msk.getUTCMonth() + 1).padStart(2, '0'); const d = String(msk.getUTCDate()).padStart(2, '0'); return `${y}-${m}-${d}`; }
function daysBetweenKeys(key1, key2) { const [y1, m1, d1] = key1.split('-').map(Number); const [y2, m2, d2] = key2.split('-').map(Number); const t1 = Date.UTC(y1, m1 - 1, d1); const t2 = Date.UTC(y2, m2 - 1, d2); return Math.round((t2 - t1) / (1000 * 60 * 60 * 24)); }
function formatDuration(minutes) { if (!minutes || minutes <= 0) return '0 мин'; const total = Math.round(minutes); const days = Math.floor(total / (60 * 24)); const hours = Math.floor((total % (60 * 24)) / 60); const m = total % 60; const parts = []; if (days > 0) parts.push(`${days} д`); if (hours > 0) parts.push(`${hours} ч`); if (m > 0 && days === 0) parts.push(`${m} мин`); return parts.join(' ') || '0 мин'; }

/* ============ STEAM ============ */
async function fetchSteamProfilesBatch(steamIds) {
  const unique = [...new Set(steamIds.filter(id => /^\d{17}$/.test(id)))];
  if (!unique.length || !STEAM_API_KEY) return {};
  const result = {};
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    try {
      const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${batch.join(',')}`);
      if (!r.ok) continue;
      const data = await r.json();
      for (const p of (data.response?.players || [])) {
        result[p.steamid] = { name: p.personaname, avatar: p.avatarfull || p.avatarmedium || p.avatar, profileUrl: p.profileurl, personastate: p.personastate };
      }
    } catch (e) { console.warn('[steam-batch]', e.message); }
  }
  return result;
}

/* ============ DISCORD ============ */
async function discordGet(p) { const r = await fetch(`https://discord.com/api${p}`, { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }); if (!r.ok) throw new Error(`discord_error: ${r.status}`); return r.json(); }
async function discordPut(p) { const r = await fetch(`https://discord.com/api${p}`, { method: 'PUT', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }); if (!r.ok && r.status !== 204) throw new Error('discord_error'); return true; }
async function discordDelete(p) { const r = await fetch(`https://discord.com/api${p}`, { method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }); if (!r.ok && r.status !== 204 && r.status !== 404) throw new Error('discord_error'); return true; }
let rolesCache = { data: null, time: 0 };
async function getGuildRoles() { if (rolesCache.data && Date.now() - rolesCache.time < 60000) return rolesCache.data; const roles = await discordGet(`/guilds/${DISCORD_GUILD_ID}/roles`); rolesCache = { data: roles, time: Date.now() }; return roles; }
async function getGuildMember(id) { return discordGet(`/guilds/${DISCORD_GUILD_ID}/members/${id}`); }
async function getUserStaffRoles(id) {
  try {
    const member = await getGuildMember(id);
    const allRoles = await getGuildRoles();
    const roleMap = {};
    allRoles.forEach(r => { roleMap[r.id] = r.name; });
    return (member.roles || []).map(rid => roleMap[rid]).filter(name => name && STAFF_ROLE_NAMES_ALL.includes(name.toLowerCase()));
  } catch { return []; }
}
async function removeAllStaffRoles(id, keep = []) {
  try {
    const member = await getGuildMember(id);
    const allRoles = await getGuildRoles();
    const keepLower = keep.map(n => n.toLowerCase());
    const removeIds = allRoles.filter(r => { const n = r.name.toLowerCase(); return STAFF_ROLE_NAMES_ALL.includes(n) && !keepLower.includes(n); }).map(r => r.id);
    const userSet = new Set(member.roles || []);
    for (const rid of removeIds.filter(x => userSet.has(x))) { try { await discordDelete(`/guilds/${DISCORD_GUILD_ID}/members/${id}/roles/${rid}`); } catch {} }
  } catch {}
}

/* ============ УВЕДОМЛЕНИЯ ============ */
async function notifyDiscordLogs(embed) { if (!DISCORD_LOGS_CHANNEL_ID || !DISCORD_BOT_TOKEN) return; try { await fetch(`https://discord.com/api/channels/${DISCORD_LOGS_CHANNEL_ID}/messages`, { method: 'POST', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) }); } catch (e) { console.error(e); } }
async function notifyDiscordPurchase(embed) { if (!DISCORD_PURCHASE_CHANNEL_ID || !DISCORD_BOT_TOKEN) return; try { await fetch(`https://discord.com/api/channels/${DISCORD_PURCHASE_CHANNEL_ID}/messages`, { method: 'POST', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) }); } catch (e) { console.error(e); } }
async function notifyDiscordRole(embed) { if (!DISCORD_ROLES_CHANNEL_ID || !DISCORD_BOT_TOKEN) return; try { await fetch(`https://discord.com/api/channels/${DISCORD_ROLES_CHANNEL_ID}/messages`, { method: 'POST', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) }); } catch (e) { console.error(e); } }
async function notifyDiscordRolesRevoke(embed) { if (!DISCORD_ROLES_REVOKE_CHANNEL_ID || !DISCORD_BOT_TOKEN) return; try { await fetch(`https://discord.com/api/channels/${DISCORD_ROLES_REVOKE_CHANNEL_ID}/messages`, { method: 'POST', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) }); } catch (e) { console.error(e); } }
async function notifyDiscordPrivileges(embed) { if (!DISCORD_PRIVILEGES_CHANNEL_ID || !DISCORD_BOT_TOKEN) return; try { await fetch(`https://discord.com/api/channels/${DISCORD_PRIVILEGES_CHANNEL_ID}/messages`, { method: 'POST', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) }); } catch (e) { console.error(e); } }
async function notifyDiscordPrivilegesRevoke(embed) { if (!DISCORD_PRIVILEGES_REVOKE_CHANNEL_ID || !DISCORD_BOT_TOKEN) return; try { await fetch(`https://discord.com/api/channels/${DISCORD_PRIVILEGES_REVOKE_CHANNEL_ID}/messages`, { method: 'POST', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) }); } catch (e) { console.error(e); } }
async function notifyDiscordBalance(embed) { if (!DISCORD_BALANCE_CHANNEL_ID || !DISCORD_BOT_TOKEN) return; try { await fetch(`https://discord.com/api/channels/${DISCORD_BALANCE_CHANNEL_ID}/messages`, { method: 'POST', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) }); } catch (e) { console.error(e); } }
async function notifyDiscordSiteLog(embed) { if (!DISCORD_SITE_LOGS_CHANNEL_ID || !DISCORD_BOT_TOKEN) return; try { await fetch(`https://discord.com/api/channels/${DISCORD_SITE_LOGS_CHANNEL_ID}/messages`, { method: 'POST', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) }); } catch (e) { console.error(e); } }

function buildStaffEmbed({ title, color, actor, target, details }) {
  const fields = [];
  fields.push({ name: 'Кто', value: actor?.steamId ? `<@${actor.discordId || '—'}> \`${actor.steamId}\`${actor.name ? ' · ' + actor.name : ''}` : (actor?.name || '—'), inline: false });
  fields.push({ name: 'Кому', value: target?.steamId ? `<@${target.discordId || '—'}> \`${target.steamId}\`${target.name ? ' · ' + target.name : ''}` : (target?.name || '—'), inline: false });
  if (details) fields.push({ name: 'Детали', value: String(details).slice(0, 1024), inline: false });
  return { title, color, fields, footer: { text: 'Fernodd' }, timestamp: new Date().toISOString() };
}

const errorRateBuckets = new Map();
async function notifyDiscordError({ title = 'Ошибка', description = '', color = 0xef4444, fields = [], stack = null, req = null, extra = {} }) {
  if (!DISCORD_ERRORS_CHANNEL_ID || !DISCORD_BOT_TOKEN) return;
  const hashKey = title + '|' + String(stack || '').slice(0, 200);
  const now = Date.now();
  const limit = Math.max(Number(ERROR_RATE_LIMIT_MS) || 60000, 5000);
  const last = errorRateBuckets.get(hashKey) || 0;
  if (now - last < limit) return;
  errorRateBuckets.set(hashKey, now);
  if (errorRateBuckets.size > 500) { const cutoff = now - 60 * 60 * 1000; for (const [k, v] of errorRateBuckets) if (v < cutoff) errorRateBuckets.delete(k); }
  try {
    const allFields = [...fields];
    if (req) {
      const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
      allFields.unshift({ name: 'Запрос', value: `\`${req.method} ${req.originalUrl}\``, inline: false }, { name: 'IP', value: `\`${ip}\``, inline: true });
      try { const u = getUserFromToken(req); if (u?.steamId) allFields.push({ name: 'Пользователь', value: `[${u.global_name || u.username || u.steamId}](https://steamcommunity.com/profiles/${u.steamId})`, inline: true }); } catch {}
    }
    if (stack) allFields.push({ name: 'Стек', value: '```\n' + String(stack).slice(0, 1000) + '\n```', inline: false });
    for (const [k, v] of Object.entries(extra || {})) { if (v == null) continue; allFields.push({ name: k, value: String(v).slice(0, 1024), inline: false }); }
    const embed = { title: `🚨 ${title}`.slice(0, 256), description: String(description || '').slice(0, 2000), color, fields: allFields.slice(0, 25), footer: { text: 'Fernodd • Ошибки' }, timestamp: new Date().toISOString() };
    await fetch(`https://discord.com/api/channels/${DISCORD_ERRORS_CHANNEL_ID}/messages`, { method: 'POST', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) });
  } catch (e) { console.error(e); }
}

async function logSiteEvent({ action, category = 'general', actor = null, target = null, meta = {}, req = null, silentDiscord = false }) {
  if (!mongoDb) return;
  try {
    const ip = req ? (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || null) : null;
    const ua = req ? (req.headers['user-agent'] || null) : null;
    const createdAt = new Date().toISOString();
    await mongoDb.collection('siteLogs').insertOne({ action, category, actorSteamId: actor?.steamId || null, actorName: actor?.name || null, actorAvatar: actor?.avatar || null, actorIsAdmin: !!actor?.isAdmin, targetSteamId: target?.steamId || null, targetName: target?.name || null, meta, ip, userAgent: ua ? ua.slice(0, 200) : null, createdAt });
    if (!silentDiscord) {
      const cat = SITE_LOG_CATEGORIES[category] || SITE_LOG_CATEGORIES.general;
      const actionLabel = SITE_LOG_ACTIONS[action] || action;
      const fields = [];
      if (actor?.name) fields.push({ name: 'Кто', value: actor.steamId ? `[${actor.name}](https://steamcommunity.com/profiles/${actor.steamId})${actor.isAdmin ? ' `ADMIN`' : ''}` : actor.name, inline: true });
      if (target?.steamId || target?.name) fields.push({ name: 'Кому', value: target.steamId ? `[${target.name || target.steamId}](https://steamcommunity.com/profiles/${target.steamId})` : (target.name || '—'), inline: true });
      const detailParts = [];
      if (meta.privilegeName) detailParts.push(`Привилегия: **${meta.privilegeName}**`);
      if (meta.durationLabel) detailParts.push(`Срок: **${meta.durationLabel}**`);
      if (meta.roleName) detailParts.push(`Роль: **${meta.roleName}**`);
      if (meta.itemName) detailParts.push(`Товар: **${meta.itemName}**`);
      if (meta.price != null) detailParts.push(`Цена: **${meta.price} ₽**`);
      if (meta.amount != null && !meta.price) detailParts.push(`Сумма: **${meta.amount} ₽**`);
      if (meta.code) detailParts.push(`Промокод: \`${meta.code}\``);
      if (meta.oldBalance != null && meta.newBalance != null) detailParts.push(`Баланс: **${meta.oldBalance} ₽ → ${meta.newBalance} ₽**`);
      if (detailParts.length) fields.push({ name: 'Детали', value: detailParts.join('\n').slice(0, 1024), inline: false });
      if (ip) fields.push({ name: 'IP', value: `\`${ip}\``, inline: true });
      const embed = { title: `${cat.label} · ${actionLabel}`, color: cat.color, fields, footer: { text: 'Fernodd • Логи сайта' }, timestamp: createdAt };
      if (actor?.avatar) embed.thumbnail = { url: actor.avatar };
      await notifyDiscordSiteLog(embed);
    }
  } catch (e) { console.error(e); }
}

const SITE_LOG_CATEGORIES = { auth: { label: 'Авторизация', color: 0x60a5fa }, profile: { label: 'Профиль', color: 0xa855f7 }, shop: { label: 'Магазин', color: 0xfbbf24 }, moderation: { label: 'Модерация', color: 0x4ade80 }, admin: { label: 'Админ', color: 0xef4444 }, roles: { label: 'Роли', color: 0x00a8fc }, privileges: { label: 'Привилегии', color: 0xfbbf24 }, balance: { label: 'Баланс', color: 0x4ade80 }, promo: { label: 'Промокоды', color: 0xeb459e }, referral: { label: 'Рефералы', color: 0x23a55a }, inventory: { label: 'Инвентарь', color: 0x8b5cf6 }, general: { label: 'Общее', color: 0x8a8a8a } };
const SITE_LOG_ACTIONS = { login: 'Вход', profile_update: 'Изменение профиля', promo_activate: 'Активация промокода', promo_create: 'Создание промокода', promo_delete: 'Удаление промокода', referral_activate: 'Активация реферала', shop_purchase: 'Покупка в магазине', inventory_remove: 'Удаление из инвентаря', balance_change: 'Изменение баланса', give_role: 'Выдача роли', privilege_grant: 'Выдача привилегии', privilege_revoke: 'Снятие привилегии', application_status: 'Статус заявки', application_delete: 'Удаление заявки', roulette_spin: 'Спин рулетки', roulette_config_update: 'Изменение конфига рулетки', roulette_config_reset: 'Сброс конфига рулетки', remove_all_admin: 'Снятие всех админ-прав' };

/* ============ ПРАВА ============ */
function getUserFromToken(req) { const auth = req.headers.authorization || ''; const token = auth.startsWith('Bearer ') ? auth.slice(7) : null; if (!token) return null; try { return jwt.verify(token, JWT_SECRET); } catch { return null; } }
function requireAuth(req, res, next) { const u = getUserFromToken(req); if (!u) return res.status(401).json({ error: 'not_authenticated' }); req.user = u; next(); }
function requireOwner(req, res, next) { const u = getUserFromToken(req); if (!u) return res.status(401).json({ error: 'not_authenticated' }); if (!u.isOwner) return res.status(403).json({ error: 'owner_only' }); req.user = u; next(); }
function requireHeadAdmin(req, res, next) { const u = getUserFromToken(req); if (!u) return res.status(401).json({ error: 'not_authenticated' }); if (!u.isHeadAdmin && !u.isOwner) return res.status(403).json({ error: 'head_admin_only' }); req.user = u; next(); }
function getRolesLower(u) { if (!u) return []; return [...(u.roles || []), ...(u.siteRoles || [])].map(r => (r || '').toLowerCase()); }
function isCuratorOrAbove(u) { if (!u) return false; if (u.isHeadAdmin || u.isOwner) return true; const roles = getRolesLower(u); return roles.some(r => ['куратор', 'следящий', 'главная администрация', 'владелец'].includes(r)); }
function canViewOrders(u) { if (!u) return false; if (u.isOwner || u.isHeadAdmin) return true; const roles = getRolesLower(u); return roles.some(r => ['следящий', 'куратор', 'главная администрация', 'владелец'].includes(r)); }
function canManageBalance(u) { if (!u) return false; if (u.isOwner || u.isHeadAdmin) return true; const roles = getRolesLower(u); return roles.some(r => ['следящий', 'куратор', 'главная администрация', 'владелец'].includes(r)); }
function canViewLogs(u) { if (!u) return false; if (u.isOwner || u.isHeadAdmin) return true; const roles = getRolesLower(u); return ['главная администрация', 'владелец'].some(r => roles.includes(r)); }
function canEditOthersProfiles(u) { if (!u) return false; if (u.isOwner || u.isHeadAdmin) return true; const roles = getRolesLower(u); return ['следящий', 'главная администрация', 'владелец'].some(r => roles.includes(r)); }
function hasFernoddPlus(u, siteRoles = []) { if (!u) return false; const allRoles = [...(u.roles || []), ...siteRoles].map(r => (r || '').toLowerCase()); return allRoles.some(r => r.startsWith('fernodd+')); }
async function userHasFernoddPlus(steamId, user = null) {
  if (user) { const roles = getRolesLower(user); if (roles.some(r => r.startsWith('fernodd+'))) return true; }
  if (!mongoDb) return false;
  const siteRoles = await getSiteRoles(steamId);
  if (siteRoles.map(r => (r || '').toLowerCase()).some(r => r.startsWith('fernodd+'))) return true;
  const sub = await mongoDb.collection('subscriptions').findOne({ steamId, itemId: 'fernodd_plus', active: { $ne: false } });
  if (!sub) return false;
  if (sub.forever) return true;
  if (!sub.expiresAt) return true;
  return new Date(sub.expiresAt) > new Date();
}
function canChangeDirectly(u) { return isCuratorOrAbove(u); }
function canDeleteDirectly(u) { return isCuratorOrAbove(u); }
function getAssignableRolesFor(user) {
  if (!user) return [];
  if (user.isOwner) return ['модератор', 'старший модератор', 'главный модератор', 'куратор', 'следящий', 'главная администрация'];
  if (user.isHeadAdmin) return ['модератор', 'старший модератор', 'главный модератор', 'куратор', 'следящий'];
  const roles = getRolesLower(user);
  if (roles.includes('следящий') || roles.includes('куратор')) return ['модератор', 'старший модератор', 'главный модератор'];
  return [];
}

async function tryGrantStreakRewards(steamId, points, userName) {
  if (!mongoDb) return [];
  const granted = [];
  for (const reward of STREAK_REWARDS) {
    if (points < reward.milestone) continue;
    const existing = await mongoDb.collection('streakRewards').findOne({ steamId, milestone: reward.milestone });
    if (existing) continue;
    try { await mongoDb.collection('streakRewards').insertOne({ steamId, milestone: reward.milestone, amount: reward.amount, grantedAt: new Date().toISOString() }); } catch (e) { if (e.code === 11000) continue; throw e; }
    await addBalance(steamId, reward.amount);
    await logTransaction(steamId, userName || 'Steam User', 'income', reward.amount, 'RUB', `Награда за стрик ${reward.milestone} дней`);
    granted.push(reward);
  }
  return granted;
}

/* ============ MIDDLEWARE ============ */
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
          mongoDb.collection('presence').updateOne({ steamId: p.steamId }, { $set: { lastSeen: new Date().toISOString() } }, { upsert: true }).catch(() => {});
        }
      }
    }
  } catch {}
  next();
});

app.use((req, res, next) => {
  const skipPaths = ['/api/health', '/favicon.ico'];
  if (skipPaths.some(p => req.path === p)) return next();
  const start = Date.now();
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    try {
      if (res.statusCode >= 500) {
        const isKnownError = body && typeof body === 'object' && body.error;
        notifyDiscordError({ title: `5xx ответ: ${res.statusCode}`, description: isKnownError ? `\`${body.error}\`` : 'Сервер вернул ошибку', color: 0xef4444, req, extra: { 'Время': `${Date.now() - start} ms` } }).catch(() => {});
      }
    } catch {}
    return originalJson(body);
  };
  next();
});

/* ============ MONGO INIT ============ */
async function initMongo() {
  if (!MONGO_URL) { console.warn('[mongo] MONGO_URL не задан'); return; }
  try {
    const client = new MongoClient(MONGO_URL);
    await client.connect();
    mongoDb = client.db('fernodd');
    console.log('[mongo] Подключено');
    await ensureIndexes();
  } catch (e) {
    console.error('[mongo]', e.message);
    await notifyDiscordError({ title: 'MongoDB: ошибка подключения', description: e.message, color: 0xef4444, stack: e.stack }).catch(() => {});
  }
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
    await mongoDb.collection('activity').createIndex({ steamId: 1 }, { unique: true });
    await mongoDb.collection('activity').createIndex({ points: -1 });
    await mongoDb.collection('reactions').createIndex({ targetSteamId: 1, fromSteamId: 1 }, { unique: true });
    await mongoDb.collection('reactions').createIndex({ targetSteamId: 1 });
    await mongoDb.collection('profileViews').createIndex({ steamId: 1 }, { unique: true });
    await mongoDb.collection('profileViewers').createIndex({ targetSteamId: 1, viewerId: 1 }, { unique: true });
    await mongoDb.collection('siteLogs').createIndex({ createdAt: -1 });
    await mongoDb.collection('siteLogs').createIndex({ actorSteamId: 1, createdAt: -1 });
    await mongoDb.collection('siteLogs').createIndex({ targetSteamId: 1, createdAt: -1 });
    await mongoDb.collection('siteLogs').createIndex({ action: 1, createdAt: -1 });
    await mongoDb.collection('streakRewards').createIndex({ steamId: 1, milestone: 1 }, { unique: true });
    await mongoDb.collection('rouletteSpins').createIndex({ steamId: 1, createdAt: -1 });
    await mongoDb.collection('rouletteFree').createIndex({ steamId: 1 }, { unique: true });
    await mongoDb.collection('sessions').createIndex({ steamId: 1, startedAt: -1 });
    console.log('[mongo] Индексы готовы');
  } catch (e) { console.error('[mongo]', e.message); }
}

/* ============ АВТОРИЗАЦИЯ STEAM ============ */
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
    for (const [k, v] of Object.entries(req.query)) { if (k === 'ref') continue; vp.append(k, v); }
    vp.set('openid.mode', 'check_authentication');
    const vr = await fetch(STEAM_OPENID_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: vp.toString() });
    const vt = await vr.text();
    if (!vt.includes('is_valid:true')) return res.redirect(`${FRONTEND_URL}/?error=steam_invalid_signature`);

    let profile = { steamid: steamId, personaname: 'Steam User', avatar: '' };
    try {
      const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`);
      const data = await r.json();
      const p = data.response?.players?.[0];
      if (p) profile = { steamid: p.steamid, personaname: p.personaname, avatar: p.avatarfull || p.avatarmedium || p.avatar, profileurl: p.profileurl };
    } catch {}

    if (refCode && mongoDb) {
      try {
        const refDoc = await mongoDb.collection('referralCodes').findOne({ code: refCode.toLowerCase() });
        if (refDoc && refDoc.steamId !== steamId) {
          const existing = await mongoDb.collection('referrals').findOne({ invitedId: steamId });
          if (!existing) {
            await mongoDb.collection('referrals').insertOne({ referrerId: refDoc.steamId, invitedId: steamId, invitedName: profile.personaname, createdAt: new Date().toISOString() });
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
      id: profile.steamid, username: profile.personaname, global_name: profile.personaname,
      avatar: profile.avatar, steamId: profile.steamid, profileUrl: profile.profileurl,
      discordId: linkedDiscordId || null,
      isAdmin: finalIsAdmin, isOwner, isHeadAdmin: finalIsHeadAdmin,
      roles: allRoles, provider: 'steam',
    }, JWT_SECRET, { expiresIn: '7d' });

    await logSiteEvent({ action: 'login', category: 'auth', actor: { steamId: profile.steamid, name: profile.personaname, avatar: profile.avatar, isAdmin: finalIsAdmin }, meta: { provider: 'steam' }, silentDiscord: true, req });

    res.redirect(`${FRONTEND_URL}/?token=${encodeURIComponent(jwtToken)}`);
  } catch (e) {
    console.error('[steam callback]', e);
    res.redirect(`${FRONTEND_URL}/?error=steam_callback`);
  }
});

/* ============ АВТОРИЗАЦИЯ DISCORD ============ */
app.get('/auth/discord', rateLimit(20, 60000), (req, res) => {
  if (!DISCORD_CLIENT_ID) return res.redirect(`${FRONTEND_URL}/profile?discord_error=not_configured`);
  const token = req.query.token || '';
  const state = Buffer.from(JSON.stringify({ token, t: Date.now() })).toString('base64');
  const params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: DISCORD_OAUTH_REDIRECT, response_type: 'code', scope: 'identify', state, prompt: 'consent' });
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
    const params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: DISCORD_OAUTH_REDIRECT });
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    if (!tokenRes.ok) return res.redirect(`${FRONTEND_URL}/profile?discord_error=token_failed`);
    const tokenData = await tokenRes.json();
    const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    if (!userRes.ok) return res.redirect(`${FRONTEND_URL}/profile?discord_error=user_failed`);
    const discordUser = await userRes.json();

    try {
      const memberRes = await fetch(`https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}`, { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } });
      if (!memberRes.ok) return res.redirect(`${FRONTEND_URL}/profile?discord_error=not_in_guild`);
    } catch { return res.redirect(`${FRONTEND_URL}/profile?discord_error=guild_check_failed`); }

    await setLink(user.steamId, discordUser.id);

    try {
      rolesCache = { data: null, time: 0 };
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
        if (!role) continue;
        try { await discordPut(`/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}/roles/${role.id}`); } catch (e) { console.error(`[role sync] ${role.name}`, e.message); }
      }
      await clearPendingRole(user.steamId);
      await clearPendingRole(discordUser.id);
    } catch (e) { console.error('[role sync]', e); }

    try {
      const roles = await getGuildRoles();
      const playerRole = roles.find(r => r.name.toLowerCase() === 'игрок');
      if (playerRole) {
        const member = await getGuildMember(discordUser.id);
        if (!member.roles.includes(playerRole.id)) await discordPut(`/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}/roles/${playerRole.id}`);
      }
    } catch {}

    return res.redirect(`${FRONTEND_URL}/profile?discord_linked=1`);
  } catch (e) { return res.redirect(`${FRONTEND_URL}/profile?discord_error=unknown`); }
});

/* ============ CONFIG ============ */
app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    roleColors: ROLE_COLORS, rolePriority: ROLE_PRIORITY,
    nonRemovableRoles: NON_REMOVABLE_ROLES, hiddenFromInventory: HIDDEN_FROM_INVENTORY,
    shopItems: SHOP_ITEMS.map(i => ({ id: i.id, name: i.name, description: i.description, color: i.color, roleName: i.roleName, tariffs: i.tariffs })),
    privileges: PRIVILEGES.map(p => ({ id: p.id, name: p.name, description: p.description, color: p.color })),
  });
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
  let activity = 0, streakFrozen = false;
  if (mongoDb) {
    try {
      const actDoc = await mongoDb.collection('activity').findOne({ steamId: p.steamId });
      activity = actDoc?.points || 0;
      if (actDoc?.freezeUsedKey) {
        const todayKey = getMoscowDateKey();
        const diff = actDoc.lastPingKey ? daysBetweenKeys(actDoc.lastPingKey, todayKey) : 999;
        streakFrozen = diff <= 1;
      }
    } catch {}
  }
  res.json({ user: { id: p.id, username: p.username, global_name: p.global_name, avatar: p.avatar || '', steamId: p.steamId, profileUrl: p.profileUrl, discordId: discordId || p.discordId || null, isAdmin, isOwner, isHeadAdmin, roles: allRoles, siteRoles, provider: 'steam', balance, activity, streakFrozen } });
});

app.get('/api/balance', requireAuth, async (req, res) => res.json({ balance: await getBalance(req.user.steamId) }));

/* ============ ТРАНЗАКЦИИ (С ПАГИНАЦИЕЙ И ФИЛЬТРОМ) ============ */
const VISIBLE_TX_FILTERS = {
  $or: [
    { type: 'income', description: { $regex: '^Активация промокода', $options: 'i' } },
    { type: 'income', description: { $regex: '^Рулетка: выигрыш', $options: 'i' } },
    { type: 'income', description: { $regex: '^Награда за стрик', $options: 'i' } },
    { type: 'outcome' },
  ],
};

app.get('/api/transactions', requireAuth, async (req, res) => {
  if (!mongoDb) return res.json({ transactions: [], total: 0, page: 1, pages: 0 });
  const targetSteamId = String(req.query.steamId || '').trim();
  let filterUserId = req.user.steamId;
  if (targetSteamId && targetSteamId !== req.user.steamId) {
    if (!canEditOthersProfiles(req.user)) return res.status(403).json({ error: 'not_allowed_for_others' });
    if (!/^\d{17}$/.test(targetSteamId)) return res.status(400).json({ error: 'bad_steam_id' });
    filterUserId = targetSteamId;
  }
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = 10;
  const skip = (page - 1) * limit;
  const filter = { userId: filterUserId, ...VISIBLE_TX_FILTERS };
  try {
    const [items, total] = await Promise.all([
      mongoDb.collection('transactions').find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      mongoDb.collection('transactions').countDocuments(filter),
    ]);
    res.json({ transactions: items.map(i => { delete i._id; return i; }), total, page, pages: Math.ceil(total / limit) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

/* ============ СТРИК ============ */
app.post('/api/activity/ping', requireAuth, async (req, res) => {
  if (!mongoDb) return res.json({ points: 0, streak: 0, frozen: false });
  const steamId = req.user.steamId;
  const now = new Date();
  const todayKey = getMoscowDateKey(now);
  try {
    const doc = await mongoDb.collection('activity').findOne({ steamId });
    let points = doc?.points || 0;
    const lastPingKey = doc?.lastPingKey || null;
    const freezeUsedKey = doc?.freezeUsedKey || null;
    let shouldIncrement = false;
    let consumedFreeze = false;
    if (!lastPingKey) shouldIncrement = true;
    else {
      const diff = daysBetweenKeys(lastPingKey, todayKey);
      if (diff === 0) shouldIncrement = false;
      else if (diff === 1) { shouldIncrement = true; if (freezeUsedKey) consumedFreeze = true; }
      else if (diff >= 2) {
        const missedDays = diff - 1;
        const freezeActive = freezeUsedKey && freezeUsedKey === lastPingKey;
        if (freezeActive && missedDays === 1) { shouldIncrement = true; consumedFreeze = true; }
        else { points = 0; shouldIncrement = true; if (freezeUsedKey) consumedFreeze = true; }
      }
    }
    if (shouldIncrement) points += 1;
    const maxStreak = Math.max(doc?.maxStreak || 0, points);
    const update = { steamId, points, maxStreak, lastPingKey: todayKey, lastPing: now.toISOString() };
    if (consumedFreeze) { update.freezeUsedKey = null; update.freezeUsedAt = null; }
    await mongoDb.collection('activity').updateOne({ steamId }, { $set: update }, { upsert: true });

    let grantedRewards = [];
    if (shouldIncrement) grantedRewards = await tryGrantStreakRewards(steamId, points, req.user.global_name || req.user.username);

    res.json({ points, streak: points, frozen: !!freezeUsedKey && !consumedFreeze, freezeUsedKey, grantedRewards: grantedRewards.map(r => ({ milestone: r.milestone, amount: r.amount, label: r.label })) });
  } catch (e) { console.error('[activity/ping]', e); res.status(500).json({ error: 'server_error' }); }
});

app.post('/api/activity/freeze', requireAuth, async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  const steamId = req.user.steamId;
  const now = new Date();
  const todayKey = getMoscowDateKey(now);
  try {
    const siteRoles = await getSiteRoles(steamId);
    if (!hasFernoddPlus(req.user, siteRoles)) return res.status(403).json({ error: 'fernodd_plus_required' });
    const doc = await mongoDb.collection('activity').findOne({ steamId });
    if (!doc || !doc.points || doc.points < 1) return res.status(400).json({ error: 'no_streak_to_freeze' });
    if (doc.freezeUsedKey) return res.status(400).json({ error: 'already_frozen' });
    if (doc.lastPingKey !== todayKey) return res.status(400).json({ error: 'must_visit_first' });
    await mongoDb.collection('activity').updateOne({ steamId }, { $set: { freezeUsedKey: todayKey, freezeUsedAt: now.toISOString() } });
    res.json({ ok: true, streak: doc.points, freezeUsedKey: todayKey });
  } catch (e) { console.error('[activity/freeze]', e); res.status(500).json({ error: 'server_error', details: String(e) }); }
});

app.get('/api/activity/status', requireAuth, async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  const steamId = req.user.steamId;
  const todayKey = getMoscowDateKey();
  try {
    const doc = await mongoDb.collection('activity').findOne({ steamId });
    const siteRoles = await getSiteRoles(steamId);
    const userHasPlus = hasFernoddPlus(req.user, siteRoles);
    const points = doc?.points || 0;
    const maxStreak = doc?.maxStreak || 0;
    const lastPingKey = doc?.lastPingKey || null;
    const freezeUsedKey = doc?.freezeUsedKey || null;
    const countedToday = lastPingKey === todayKey;
    let frozen = false;
    if (freezeUsedKey) { const diff = lastPingKey ? daysBetweenKeys(lastPingKey, todayKey) : 999; if (diff <= 1) frozen = true; }
    res.json({ streak: points, maxStreak, countedToday, frozen, hasFernoddPlus: userHasPlus, lastPingKey, freezeUsedKey, todayKey });
  } catch (e) { console.error('[activity/status]', e); res.status(500).json({ error: 'server_error' }); }
});

app.get('/api/activity/:steamId', async (req, res) => {
  if (!mongoDb) return res.json({ points: 0, streak: 0 });
  try { const doc = await mongoDb.collection('activity').findOne({ steamId: req.params.steamId }); res.json({ points: doc?.points || 0, streak: doc?.points || 0 }); } catch { res.json({ points: 0, streak: 0 }); }
});

/* ============ РУЛЕТКА ============ */
app.get('/api/roulette/status', requireAuth, async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  const steamId = req.user.steamId;
  try {
    const actDoc = await mongoDb.collection('activity').findOne({ steamId });
    const streak = actDoc?.points || 0;
    const freeDoc = await mongoDb.collection('rouletteFree').findOne({ steamId });
    const lastFreeKey = freeDoc?.lastFreeKey || null;
    const usedCount = freeDoc?.usedCount || 0;
    const todayKey = getMoscowDateKey();
    const siteRoles = await getSiteRoles(steamId);
    const hasPlus = hasFernoddPlus(req.user, siteRoles);
    const maxSpins = hasPlus ? ROULETTE_FREE_SPINS_PLUS : ROULETTE_FREE_SPINS_DEFAULT;
    let freeSpinsLeft = 0; let daysLeft = 0;
    if (streak >= ROULETTE_COOLDOWN_DAYS) {
      let sameWeek = false;
      if (lastFreeKey) { const diff = daysBetweenKeys(lastFreeKey, todayKey); if (diff < ROULETTE_COOLDOWN_DAYS) sameWeek = true; }
      if (sameWeek) { freeSpinsLeft = Math.max(0, maxSpins - usedCount); daysLeft = Math.max(0, ROULETTE_COOLDOWN_DAYS - (lastFreeKey ? daysBetweenKeys(lastFreeKey, todayKey) : 0)); }
      else freeSpinsLeft = maxSpins;
    } else daysLeft = ROULETTE_COOLDOWN_DAYS - streak;

    const canFree = freeSpinsLeft > 0;
    const balance = await getBalance(steamId);
    const history = await mongoDb.collection('rouletteSpins').find({ steamId }).sort({ createdAt: -1 }).limit(20).toArray();
    res.json({ streak, canFree, daysLeft, lastFreeKey, freeSpinsLeft, maxSpins, hasPlus, canPaid: balance >= ROULETTE_PAID_PRICE, paidPrice: ROULETTE_PAID_PRICE, balance, prizes: await getRoulettePrizes(), history: history.map(h => { delete h._id; return h; }) });
  } catch (e) { console.error('[roulette/status]', e); res.status(500).json({ error: 'server_error' }); }
});

app.post('/api/roulette/spin', requireAuth, rateLimit(5, 60000), async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  const steamId = req.user.steamId;
  const spinType = req.body?.type === 'paid' ? 'paid' : 'free';
  try {
    const actDoc = await mongoDb.collection('activity').findOne({ steamId });
    const streak = actDoc?.points || 0;
    const todayKey = getMoscowDateKey();
    const siteRoles = await getSiteRoles(steamId);
    const hasPlus = hasFernoddPlus(req.user, siteRoles);
    const maxSpins = hasPlus ? ROULETTE_FREE_SPINS_PLUS : ROULETTE_FREE_SPINS_DEFAULT;
    let usedCount = 0;
    if (spinType === 'free') {
      if (streak < ROULETTE_COOLDOWN_DAYS) return res.status(403).json({ error: 'not_enough_streak' });
      const freeDoc = await mongoDb.collection('rouletteFree').findOne({ steamId });
      const lastFreeKey = freeDoc?.lastFreeKey || null;
      usedCount = freeDoc?.usedCount || 0;
      let isNewWeek = false;
      if (!lastFreeKey) isNewWeek = true;
      else { const diff = daysBetweenKeys(lastFreeKey, todayKey); if (diff >= ROULETTE_COOLDOWN_DAYS) isNewWeek = true; }
      if (isNewWeek) usedCount = 0;
      if (usedCount >= maxSpins) { const diff = lastFreeKey ? daysBetweenKeys(lastFreeKey, todayKey) : 0; return res.status(403).json({ error: 'cooldown', daysLeft: Math.max(0, ROULETTE_COOLDOWN_DAYS - diff) }); }
      try {
        await mongoDb.collection('rouletteFree').updateOne({ steamId }, { $set: { lastFreeKey: isNewWeek ? todayKey : lastFreeKey, usedCount: usedCount + 1, updatedAt: new Date().toISOString() } }, { upsert: true });
      } catch (e) { if (e.code === 11000) return res.status(403).json({ error: 'cooldown' }); throw e; }
    } else {
      const balance = await getBalance(steamId);
      if (balance < ROULETTE_PAID_PRICE) return res.status(400).json({ error: 'insufficient_balance', needed: ROULETTE_PAID_PRICE, balance });
      await addBalance(steamId, -ROULETTE_PAID_PRICE);
      await logTransaction(steamId, req.user.global_name || req.user.username, 'outcome', ROULETTE_PAID_PRICE, 'RUB', `Рулетка: платный спин`);
    }
    const prize = await rollRoulettePrize();
    const isWin = prize.amount > 0;
    if (isWin) {
      await addBalance(steamId, prize.amount);
      await logTransaction(steamId, req.user.global_name || req.user.username, 'income', prize.amount, 'RUB', `Рулетка: выигрыш ${prize.amount} ₽`);
    }
    await mongoDb.collection('rouletteSpins').insertOne({ steamId, amount: prize.amount, tier: prize.tier, isWin, type: spinType, createdAt: new Date().toISOString() });
    await logSiteEvent({ action: 'roulette_spin', category: 'shop', actor: actorFromReq(req), meta: { amount: prize.amount, tier: prize.tier, isWin, type: spinType, paid: spinType === 'paid' ? ROULETTE_PAID_PRICE : 0 }, req });
    const newBalance = await getBalance(steamId);
    const freeSpinsLeft = spinType === 'free' ? Math.max(0, maxSpins - (usedCount + 1)) : null;
    res.json({ ok: true, prize: { amount: prize.amount, tier: prize.tier }, isWin, type: spinType, newBalance, freeSpinsLeft });
  } catch (e) { console.error('[roulette/spin]', e); res.status(500).json({ error: 'server_error' }); }
});

app.get('/api/admin/roulette/prizes', requireOwner, async (req, res) => {
  try {
    const prizes = await getRoulettePrizes();
    const total = prizes.reduce((s, p) => s + p.weight, 0);
    res.json({ prizes: prizes.map(p => ({ ...p, chance: total > 0 ? (p.weight / total) * 100 : 0 })), totalWeight: total, defaultPrizes: ROULETTE_PRIZES_DEFAULT });
  } catch (e) { console.error('[admin/roulette/prizes]', e); res.status(500).json({ error: 'server_error' }); }
});

app.post('/api/admin/roulette/prizes', requireOwner, async (req, res) => {
  const { prizes } = req.body || {};
  if (!Array.isArray(prizes) || !prizes.length) return res.status(400).json({ error: 'bad_prizes' });
  const cleaned = [];
  for (const p of prizes) {
    const amount = Number(p.amount); const weight = Number(p.weight);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'bad_amount' });
    if (!Number.isFinite(weight) || weight <= 0) return res.status(400).json({ error: 'bad_weight' });
    let tier = p.tier;
    if (!['blue', 'purple', 'red', 'empty'].includes(tier)) tier = amount === 0 ? 'empty' : amount >= 300 ? 'red' : amount >= 50 ? 'purple' : 'blue';
    cleaned.push({ amount, weight, tier });
  }
  try {
    await setRoulettePrizes(cleaned);
    await logSiteEvent({ action: 'roulette_config_update', category: 'admin', actor: actorFromReq(req), meta: { count: cleaned.length }, req });
    res.json({ ok: true, prizes: cleaned });
  } catch (e) { console.error('[admin/roulette/prizes post]', e); res.status(500).json({ error: 'server_error' }); }
});

app.post('/api/admin/roulette/prizes/reset', requireOwner, async (req, res) => {
  try {
    await setRoulettePrizes(ROULETTE_PRIZES_DEFAULT);
    await logSiteEvent({ action: 'roulette_config_reset', category: 'admin', actor: actorFromReq(req), meta: {}, req });
    res.json({ ok: true, prizes: ROULETTE_PRIZES_DEFAULT });
  } catch (e) { console.error('[admin/roulette/prizes reset]', e); res.status(500).json({ error: 'server_error' }); }
});

/* ============ СТАТИСТИКА И РЕАКЦИИ ============ */
app.get('/api/stats/activity', async (req, res) => {
  if (!mongoDb) return res.json({ users: [] });
  try {
    const docs = await mongoDb.collection('activity').find({ points: { $gte: 1 } }).sort({ points: -1 }).limit(100).toArray();
    if (!docs.length) return res.json({ users: [] });
    const profiles = await fetchSteamProfilesBatch(docs.map(d => d.steamId));
    const todayKey = getMoscowDateKey();
    const result = docs.map(doc => {
      const p = profiles[doc.steamId];
      let frozen = false;
      if (doc.freezeUsedKey) { const diff = doc.lastPingKey ? daysBetweenKeys(doc.lastPingKey, todayKey) : 999; if (diff <= 1) frozen = true; }
      return { steamId: doc.steamId, name: p?.name || 'Steam User', avatar: p?.avatar || '', activity: doc.points || 0, frozen };
    });
    res.json({ users: result });
  } catch (e) { console.error('[stats/activity]', e); res.status(500).json({ error: 'server_error' }); }
});

app.get('/api/stats/players', async (req, res) => {
  if (!mongoDb) return res.json({ users: [] });
  try {
    const links = await mongoDb.collection('links').find({}).toArray();
    if (!links.length) return res.json({ users: [] });
    const steamIds = links.map(l => l.steamId);
    const [profiles, activities, presences] = await Promise.all([
      fetchSteamProfilesBatch(steamIds),
      mongoDb.collection('activity').find({ steamId: { $in: steamIds } }).toArray(),
      mongoDb.collection('presence').find({ steamId: { $in: steamIds } }).toArray(),
    ]);
    const activityMap = Object.fromEntries(activities.map(a => [a.steamId, a]));
    const presenceMap = Object.fromEntries(presences.map(p => [p.steamId, p]));
    const todayKey = getMoscowDateKey();
    const result = links.map(link => {
      const p = profiles[link.steamId] || {};
      const act = activityMap[link.steamId];
      const pres = presenceMap[link.steamId];
      let frozen = false;
      if (act?.freezeUsedKey) { const diff = act.lastPingKey ? daysBetweenKeys(act.lastPingKey, todayKey) : 999; if (diff <= 1) frozen = true; }
      let siteStatus = 'offline';
      if (pres?.lastSeen && Date.now() - new Date(pres.lastSeen).getTime() < 5 * 60 * 1000) siteStatus = 'online';
      return { steamId: link.steamId, name: p.name || 'Steam User', avatar: p.avatar || '', streak: act?.points || 0, frozen, siteStatus };
    });
    result.sort((a, b) => { if (b.streak !== a.streak) return b.streak - a.streak; return (a.name || '').localeCompare(b.name || ''); });
    res.json({ users: result });
  } catch (e) { console.error('[stats/players]', e); res.status(500).json({ error: 'server_error' }); }
});

app.get('/api/reactions/:steamId', async (req, res) => {
  if (!mongoDb) return res.json({ likes: 0, dislikes: 0, views: 0, myReaction: null });
  const { steamId } = req.params;
  if (!/^\d{17}$/.test(steamId)) return res.status(400).json({ error: 'bad_steam_id' });
  try {
    const col = mongoDb.collection('reactions');
    const likes = await col.countDocuments({ targetSteamId: steamId, type: 'like' });
    const dislikes = await col.countDocuments({ targetSteamId: steamId, type: 'dislike' });
    const viewer = getUserFromToken(req);
    let myReaction = null;
    if (viewer?.steamId) { const r = await col.findOne({ targetSteamId: steamId, fromSteamId: viewer.steamId }); myReaction = r?.type || null; }
    const viewsDoc = await mongoDb.collection('profileViews').findOne({ steamId });
    const views = viewsDoc?.count || 0;
    res.json({ likes, dislikes, views, myReaction });
  } catch (e) { console.error('[reactions/get]', e); res.status(500).json({ error: 'server_error' }); }
});

app.post('/api/reactions/:steamId', requireAuth, async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  const { steamId } = req.params;
  const { type } = req.body || {};
  if (!/^\d{17}$/.test(steamId)) return res.status(400).json({ error: 'bad_steam_id' });
  if (!['like', 'dislike'].includes(type)) return res.status(400).json({ error: 'bad_type' });
  if (steamId === req.user.steamId) return res.status(400).json({ error: 'self_reaction' });
  try {
    const col = mongoDb.collection('reactions');
    const existing = await col.findOne({ targetSteamId: steamId, fromSteamId: req.user.steamId });
    if (existing && existing.type === type) { await col.deleteOne({ _id: existing._id }); return res.json({ ok: true, action: 'removed' }); }
    if (existing) await col.updateOne({ _id: existing._id }, { $set: { type, updatedAt: new Date().toISOString() } });
    else await col.insertOne({ targetSteamId: steamId, fromSteamId: req.user.steamId, type, createdAt: new Date().toISOString() });
    res.json({ ok: true, action: existing ? 'updated' : 'created' });
  } catch (e) { console.error('[reactions/post]', e); res.status(500).json({ error: 'server_error' }); }
});

/* ============ ССЫЛКИ / ДРУЗЬЯ ============ */
app.post('/api/unlink-discord', requireAuth, async (req, res) => {
  const { steamId } = req.body || {};
  let targetSteamId = req.user.steamId;
  if (steamId && steamId !== req.user.steamId) {
    if (!canEditOthersProfiles(req.user)) return res.status(403).json({ error: 'not_allowed_for_others' });
    if (!/^\d{17}$/.test(steamId)) return res.status(400).json({ error: 'bad_steam_id' });
    targetSteamId = steamId;
  }
  await delLink(targetSteamId);
  res.json({ ok: true });
});

app.get('/api/discord-info/:discordId', requireAuth, async (req, res) => {
  const { discordId } = req.params;
  if (!/^\d{17,20}$/.test(discordId)) return res.status(400).json({ error: 'bad_id' });
  try {
    const m = await getGuildMember(discordId);
    res.json({ id: m.user.id, username: m.user.username, global_name: m.user.global_name, nickname: m.nick, avatar: m.user.avatar ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png` : '' });
  } catch { res.status(404).json({ error: 'not_found' }); }
});

app.get('/api/friends', async (req, res) => {
  let steamId = String(req.query.steamId || '').trim();
  if (!steamId) { const u = getUserFromToken(req); if (!u) return res.status(401).json({ error: 'not_authenticated' }); steamId = u.steamId; }
  else if (!/^\d{17}$/.test(steamId)) return res.status(400).json({ error: 'bad_steam_id' });
  if (!steamId || !STEAM_API_KEY) return res.json({ friends: [] });
  try {
    const r = await fetch(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${STEAM_API_KEY}&steamid=${steamId}&relationship=friend`);
    if (!r.ok) return res.json({ friends: [] });
    const data = await r.json();
    const friendIds = (data.friendslist?.friends || []).map(f => f.steamid);
    if (!friendIds.length) return res.json({ friends: [] });
    const profiles = await fetchSteamProfilesBatch(friendIds);
    const links = mongoDb ? await mongoDb.collection('links').find({}).toArray() : [];
    const linkedMap = {};
    links.forEach(l => { linkedMap[l.steamId] = l.discordId; });
    const friends = friendIds.map(id => profiles[id] ? { id, ...profiles[id] } : null).filter(Boolean).map(p => ({
      steamId: p.id, name: p.name, avatar: p.avatar, profileUrl: p.profileUrl || `https://steamcommunity.com/profiles/${p.id}`,
      status: p.personastate === 0 ? 'offline' : (p.personastate === 1 ? 'online' : 'busy'), registered: !!linkedMap[p.id], registeredDiscordId: linkedMap[p.id] || null,
    }));
    res.json({ friends });
  } catch (e) { res.status(500).json({ error: 'server_error', details: String(e) }); }
});

/* ============ ИНВЕНТАРЬ ============ */
app.get('/api/inventory', async (req, res) => {
  if (!mongoDb) return res.json({ items: [] });
  let targetSteamId = String(req.query.steamId || '').trim();
  if (!targetSteamId) { const u = getUserFromToken(req); if (!u) return res.status(401).json({ error: 'not_authenticated' }); targetSteamId = u.steamId; }
  else if (!/^\d{17}$/.test(targetSteamId)) return res.status(400).json({ error: 'bad_steam_id' });

  const items = [];
  const subscriptions = await mongoDb.collection('subscriptions').find({ steamId: targetSteamId, active: { $ne: false } }).toArray();
  for (const sub of subscriptions) {
    const lastOrder = await mongoDb.collection('orders').find({ userId: targetSteamId, itemId: sub.itemId }).sort({ createdAt: -1 }).limit(1).toArray();
    const order = lastOrder[0] || {};
    items.push({ itemId: sub.itemId, itemName: sub.itemName || order.itemName || sub.itemId, count: 1, totalPrice: order.price || 0, totalDays: 0, forever: sub.forever === true || sub.expiresAt === null, expiresAt: sub.expiresAt || null, active: sub.active !== false, lastPurchase: order.createdAt || sub.purchasedAt || new Date().toISOString(), firstPurchase: sub.purchasedAt || new Date().toISOString(), purchases: order.createdAt ? [order] : [], isRole: false });
  }
  const siteRoles = await getSiteRoles(targetSteamId);
  for (const roleName of siteRoles) {
    if (HIDDEN_FROM_INVENTORY.includes(roleName)) continue;
    const displayName = roleName === 'Главная администрация' ? 'Техническая поддержка' : roleName;
    items.push({ itemId: `role_${roleName}`, itemName: displayName, count: 1, totalPrice: 0, totalDays: 0, forever: true, expiresAt: null, active: true, lastPurchase: new Date().toISOString(), firstPurchase: new Date().toISOString(), purchases: [], isRole: true });
  }
  res.json({ items });
});

app.post('/api/inventory/remove', requireAuth, async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  const { itemId } = req.body || {};
  if (!itemId) return res.status(400).json({ error: 'missing_item_id' });
  const steamId = req.user.steamId;
  try {
    if (itemId.startsWith('role_')) {
      const roleName = itemId.slice(5);
      if (NON_REMOVABLE_ROLES.includes(roleName)) return res.status(403).json({ error: 'non_removable_role' });
      const siteRoles = await getSiteRoles(steamId);
      if (!siteRoles.includes(roleName)) return res.status(404).json({ error: 'role_not_owned' });
      await mongoDb.collection('siteRoles').deleteOne({ steamId, roleName });
      await mongoDb.collection('orders').deleteMany({ userId: steamId, itemId: `role_${roleName}` });
      await mongoDb.collection('orders').deleteMany({ userId: steamId, itemName: roleName });
      const discordId = await getLink(steamId);
      let roleRemoved = false;
      if (discordId && DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
        try { rolesCache = { data: null, time: 0 }; const roles = await getGuildRoles(); const role = roles.find(r => r.name.toLowerCase() === roleName.toLowerCase()); if (role) { await discordDelete(`/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${role.id}`); roleRemoved = true; } } catch {}
      }
      await appendHistory({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), action: 'remove_privilege', targetSteamId: steamId, itemId, itemName: roleName, type: 'role', performedBy: req.user.id, performedByName: req.user.global_name || req.user.username, performedByAvatar: req.user.avatar, performedAt: new Date().toISOString() });
      await logSiteEvent({ action: 'inventory_remove', category: 'inventory', actor: actorFromReq(req), meta: { itemId, itemName: roleName, type: 'role', roleRemoved }, req });
      await notifyDiscordRolesRevoke(buildStaffEmbed({ title: 'Снятие роли', color: 0xef4444, actor: { steamId: req.user.steamId, name: req.user.global_name || req.user.username, discordId: req.user.discordId }, target: { steamId, name: null, discordId: null }, details: `Роль: **${roleName}**\nВ Discord: **${roleRemoved ? 'снята' : 'не найдена'}**\nСпособ: самостоятельное удаление из инвентаря` }));
      return res.json({ ok: true, removed: roleName, type: 'role' });
    }
    const sub = await mongoDb.collection('subscriptions').findOne({ steamId, itemId });
    if (!sub) return res.status(404).json({ error: 'subscription_not_found' });
    await mongoDb.collection('subscriptions').deleteOne({ steamId, itemId });
    await mongoDb.collection('orders').deleteMany({ userId: steamId, itemId });
    const discordId = await getLink(steamId);
    let roleRemoved = false;
    if (discordId && DISCORD_BOT_TOKEN && DISCORD_GUILD_ID && sub.roleName) {
      try { rolesCache = { data: null, time: 0 }; const roles = await getGuildRoles(); const role = roles.find(r => r.name.toLowerCase() === sub.roleName.toLowerCase()); if (role) { await discordDelete(`/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${role.id}`); roleRemoved = true; } } catch {}
    }
    await appendHistory({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), action: 'remove_privilege', targetSteamId: steamId, itemId, itemName: sub.itemName || itemId, type: 'subscription', performedBy: req.user.id, performedByName: req.user.global_name || req.user.username, performedByAvatar: req.user.avatar, performedAt: new Date().toISOString() });
    await logSiteEvent({ action: 'inventory_remove', category: 'inventory', actor: actorFromReq(req), meta: { itemId, itemName: sub.itemName || itemId, type: 'subscription', roleRemoved }, req });
    await notifyDiscordPrivilegesRevoke(buildStaffEmbed({ title: 'Снятие привилегии', color: 0xef4444, actor: { steamId: req.user.steamId, name: req.user.global_name || req.user.username, discordId: req.user.discordId }, target: { steamId, name: null, discordId: null }, details: `Привилегия: **${sub.itemName || itemId}**\nВ Discord: **${roleRemoved ? 'снята' : 'не найдена'}**\nСпособ: самостоятельное удаление из инвентаря` }));
    res.json({ ok: true, removed: sub.itemName || itemId, type: 'subscription' });
  } catch (e) { console.error('[inventory/remove]', e); res.status(500).json({ error: 'server_error', details: String(e) }); }
});

/* ============ РЕФЕРАЛЫ / ПРОФИЛЬ ============ */
app.get('/api/referrals/my', requireAuth, async (req, res) => {
  if (!mongoDb) return res.json({ code: '', invited: [], earned: 0, cashback: 0 });
  let refDoc = await mongoDb.collection('referralCodes').findOne({ steamId: req.user.steamId });
  if (!refDoc) {
    let base = (req.user.username || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'user';
    let code = base, tries = 0;
    while (await mongoDb.collection('referralCodes').findOne({ code }) && tries < 20) { code = base + Math.floor(100 + Math.random() * 900); tries++; }
    await mongoDb.collection('referralCodes').insertOne({ steamId: req.user.steamId, code, createdAt: new Date().toISOString() });
    refDoc = { code };
  }
  const invited = await mongoDb.collection('referrals').find({ referrerId: req.user.steamId }).sort({ createdAt: -1 }).toArray();
  res.json({ code: refDoc.code, fullCode: req.user.steamId, link: `${FRONTEND_URL}/auth/steam?ref=${refDoc.code}`, invited: invited.map(i => ({ steamId: i.invitedId, name: i.invitedName, at: i.createdAt })), earned: invited.length * 100, cashback: 0 });
});

app.post('/api/referrals/set-code', requireAuth, async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_code' });
  const clean = String(code).trim().toLowerCase();
  if (!/^[a-z0-9_\-]{3,20}$/.test(clean)) return res.status(400).json({ error: 'bad_code_format' });
  const existing = await mongoDb.collection('referralCodes').findOne({ code: clean });
  if (existing && existing.steamId !== req.user.steamId) return res.status(400).json({ error: 'code_taken' });
  await mongoDb.collection('referralCodes').updateOne({ steamId: req.user.steamId }, { $set: { code: clean, updatedAt: new Date().toISOString() } }, { upsert: true });
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
  await mongoDb.collection('referrals').insertOne({ referrerId: refDoc.steamId, invitedId: req.user.steamId, invitedName: req.user.global_name || req.user.username, createdAt: new Date().toISOString() });
  await addBalance(refDoc.steamId, 100); await addBalance(req.user.steamId, 50);
  await logSiteEvent({ action: 'referral_activate', category: 'referral', actor: actorFromReq(req), target: { steamId: refDoc.steamId, name: null }, meta: { code: clean }, req });
  res.json({ ok: true });
});

app.get('/api/referrals/top', requireAuth, async (req, res) => {
  if (!mongoDb) return res.json({ top: [] });
  try {
    const pipeline = [{ $group: { _id: '$referrerId', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }];
    const raw = await mongoDb.collection('referrals').aggregate(pipeline).toArray();
    const profiles = await fetchSteamProfilesBatch(raw.map(r => r._id));
    const top = raw.map(r => { const p = profiles[r._id] || {}; return { steamId: r._id, name: p.name || 'Неизвестный', avatar: p.avatar || '', count: r.count, completed: r.count }; });
    res.json({ top });
  } catch (e) { res.status(500).json({ error: 'server_error', details: String(e) }); }
});

app.post('/api/profile/update', requireAuth, async (req, res) => {
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  const { description, backgroundUrl, profileLink, telegram, vk, steamId } = req.body || {};
  let targetSteamId = req.user.steamId;
  if (steamId && steamId !== req.user.steamId) {
    if (!canEditOthersProfiles(req.user)) return res.status(403).json({ error: 'not_allowed_for_others' });
    if (!/^\d{17}$/.test(steamId)) return res.status(400).json({ error: 'bad_steam_id' });
    targetSteamId = steamId;
  }
  const update = {};
  if (description !== undefined) update.description = String(description).slice(0, 200);
  if (backgroundUrl !== undefined) { const bg = String(backgroundUrl).slice(0, 500).trim(); if (bg && !/^https?:\/\/[^\s'"()<>\\]+$/i.test(bg)) return res.status(400).json({ error: 'bad_background_url' }); update.backgroundUrl = bg; }
  if (telegram !== undefined) { const tg = String(telegram).slice(0, 200).trim(); if (tg && !/^https?:\/\/[^\s'"()<>\\]+$/i.test(tg)) return res.status(400).json({ error: 'bad_telegram_url' }); update.telegram = tg; }
  if (vk !== undefined) { const vkUrl = String(vk).slice(0, 200).trim(); if (vkUrl && !/^https?:\/\/[^\s'"()<>\\]+$/i.test(vkUrl)) return res.status(400).json({ error: 'bad_vk_url' }); update.vk = vkUrl; }
  if (profileLink !== undefined) {
    let hasPlus = false;
    if (targetSteamId === req.user.steamId) hasPlus = await userHasFernoddPlus(targetSteamId, req.user);
    else hasPlus = true;
    if (!hasPlus) return res.status(403).json({ error: 'fernodd_plus_required' });
    if (profileLink !== '') {
      if (!/^[a-zA-Z0-9_\-]{3,20}$/.test(profileLink)) return res.status(400).json({ error: 'bad_link_format' });
      const clean = String(profileLink).trim().toLowerCase();
      const existing = await mongoDb.collection('profiles').findOne({ profileLink: clean, steamId: { $ne: targetSteamId } });
      if (existing) return res.status(400).json({ error: 'link_taken' });
      update.profileLink = clean;
    } else update.profileLink = '';
  }
  update.updatedAt = new Date().toISOString();
  await mongoDb.collection('profiles').updateOne({ steamId: targetSteamId }, { $set: update }, { upsert: true });
  if (targetSteamId !== req.user.steamId) await appendHistory({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), action: 'edit_other_profile', targetSteamId, fields: Object.keys(update).filter(k => k !== 'updatedAt'), performedBy: req.user.id, performedByName: req.user.global_name || req.user.username, performedByAvatar: req.user.avatar, performedAt: new Date().toISOString() });
  await logSiteEvent({ action: 'profile_update', category: 'profile', actor: actorFromReq(req), target: { steamId: targetSteamId, name: null }, meta: { fields: Object.keys(update).filter(k => k !== 'updatedAt') }, req });
  res.json({ ok: true });
});

app.get('/api/profile/check-link', requireAuth, async (req, res) => {
  if (!mongoDb) return res.json({ available: true });
  const link = String(req.query.link || '').trim().toLowerCase();
  if (!link) return res.json({ available: true });
  if (!/^[a-z0-9_\-]{3,20}$/.test(link)) return res.json({ available: false, reason: 'bad_format' });
  try { const existing = await mongoDb.collection('profiles').findOne({ profileLink: link, steamId: { $ne: req.user.steamId } }); res.json({ available: !existing, reason: existing ? 'taken' : null }); } catch { res.status(500).json({ error: 'server_error' }); }
});

/* ============ ПРОМОКОДЫ ============ */
app.get('/api/promocodes', requireOwner, async (req, res) => {
  if (!mongoDb) return res.json({ promocodes: [] });
  const items = await mongoDb.collection('promocodes').find({}).toArray();
  const result = [];
  for (const p of items) { const usedCount = await mongoDb.collection('promoUses').countDocuments({ code: p.code }); delete p._id; result.push({ ...p, usedCount }); }
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
  await mongoDb.collection('promocodes').insertOne({ code: clean, amount: Number(amount), maxUses: Number(maxUses) || 0, createdAt: new Date().toISOString(), createdBy: req.user.id, createdByName: req.user.global_name || req.user.username, active: true });
  await logSiteEvent({ action: 'promo_create', category: 'promo', actor: actorFromReq(req), meta: { code: clean, amount: Number(amount), maxUses: Number(maxUses) || 0 }, req });
  res.json({ ok: true, code: clean });
});

app.delete('/api/promocodes/:code', requireOwner, async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!mongoDb) return res.status(500).json({ error: 'no_db' });
  await mongoDb.collection('promocodes').deleteOne({ code });
  await logSiteEvent({ action: 'promo_delete', category: 'promo', actor: actorFromReq(req), meta: { code }, req });
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
  if (promo.maxUses > 0 && totalUses >= promo.maxUses) return res.status(400).json({ error: 'limit_reached' });
  const newBalance = await addBalance(req.user.steamId, promo.amount);
  await mongoDb.collection('promoUses').insertOne({ code: clean, userId: req.user.steamId, userName: req.user.global_name || req.user.username, amount: promo.amount, usedAt: new Date().toISOString() });
  await logTransaction(req.user.steamId, req.user.global_name || req.user.username, 'income', promo.amount, 'RUB', `Активация промокода ${clean}`);
  await logSiteEvent({ action: 'promo_activate', category: 'promo', actor: actorFromReq(req), meta: { code: clean, amount: promo.amount, newBalance }, req });
  res.json({ ok: true, amount: promo.amount, newBalance });
});