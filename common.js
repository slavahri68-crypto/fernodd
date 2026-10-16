/* ============ ЧАСТИЦЫ ============ */
(function initParticles() {
  function create() {
    const container = document.getElementById('particles');
    if (!container) return;
    const count = 30;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = (10 + Math.random() * 15) + 's';
      p.style.animationDelay = (Math.random() * 10) + 's';
      const size = (2 + Math.random() * 3).toFixed(1) + 'px';
      p.style.width = size;
      p.style.height = size;
      container.appendChild(p);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', create);
  else create();
})();

window.escapeHtml = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

/* ============ УДАЛЕНИЕ ЭМОДЗИ ИЗ ТЕКСТА ============ */
window.stripEmoji = function (text) {
  return String(text == null ? '' : text)
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{2190}-\u{21FF}]/gu, '')
    .replace(/[\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/\uFE0F/g, '')
    .trim();
};

/* ============ TOAST ============ */
window.showToast = function (text, type = 'info', ms = 3000) {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) { console.log('[toast:' + type + ']', text); return; }

  const icons = {
    success: window.ICONS?.checkCircle || '',
    error: window.ICONS?.x || '',
    info: window.ICONS?.info || '',
  };

  const cleanText = window.stripEmoji(text);

  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-msg">${window.escapeHtml(cleanText)}</span>
  `;
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 300); }, ms);
};

window.formatDate = function (date) {
  if (!date) return '—';
  try { return new Date(date).toLocaleString('ru-RU'); } catch { return String(date); }
};

window.getToken = function () { return localStorage.getItem('fernodd_token') || ''; };

/* ============ REMOTE CONFIG ============ */
window.__remoteConfig = null;
window.__remoteConfigPromise = null;

window.getRemoteConfig = async function () {
  if (window.__remoteConfig) return window.__remoteConfig;
  if (window.__remoteConfigPromise) return window.__remoteConfigPromise;

  try {
    const cached = sessionStorage.getItem('fernodd_remote_config');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.expiresAt > Date.now()) {
        window.__remoteConfig = parsed.data;
        return window.__remoteConfig;
      }
    }
  } catch {}

  window.__remoteConfigPromise = fetch((window.API_BASE || '') + '/api/config')
    .then(r => r.ok ? r.json() : Promise.reject(new Error('config_failed')))
    .then(data => {
      window.__remoteConfig = data;
      try {
        sessionStorage.setItem('fernodd_remote_config', JSON.stringify({
          data,
          expiresAt: Date.now() + 5 * 60 * 1000,
        }));
      } catch {}
      return data;
    })
    .catch(() => {
      window.__remoteConfig = {};
      return {};
    })
    .finally(() => { window.__remoteConfigPromise = null; });

  return window.__remoteConfigPromise;
};

/* ============ API ============ */
window.api = async function (path, options = {}) {
  const base = window.API_BASE || '';
  const r = await fetch(base + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + window.getToken(),
      ...(options.headers || {})
    }
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text || 'unknown_error' }; }
  if (!r.ok) throw new Error((data.error || 'error') + ' — ' + (data.details || ''));
  return data;
};

/* ============ СТРИК: 5 минут активного времени ============ */
(function initActivityTracker() {
  const REQUIRED_MS = 5 * 60 * 1000;
  const STORAGE_KEY = 'fernodd_activity_start';
  const SENT_KEY = 'fernodd_activity_sent';
  const HIDDEN_AT_KEY = 'fernodd_activity_hidden_at';

  let activityTimer = null;

  function safeGet(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
  function safeSet(key, val) { try { sessionStorage.setItem(key, String(val)); } catch {} }
  function safeRemove(key) { try { sessionStorage.removeItem(key); } catch {} }

  function getStartTime() {
    const t = safeGet(STORAGE_KEY);
    return t ? parseInt(t, 10) : null;
  }
  function setStartTime(t) { safeSet(STORAGE_KEY, t); }
  function clearStartTime() {
    safeRemove(STORAGE_KEY);
    safeRemove(SENT_KEY);
    safeRemove(HIDDEN_AT_KEY);
  }
  function isSent() { return safeGet(SENT_KEY) === '1'; }
  function markSent() { safeSet(SENT_KEY, '1'); }

  function pingActivity() {
    const token = window.getToken();
    if (!token) return;
    fetch((window.API_BASE || '') + '/api/activity/ping', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('http_' + r.status)))
    .then(data => {
      if (typeof data.points === 'number') {
        window.currentActivity = data.points;
        window.dispatchEvent(new CustomEvent('activity:changed', {
          detail: { points: data.points, streak: data.streak, frozen: data.frozen }
        }));
      }
      markSent();
    })
    .catch(() => {});
  }

  function startTimer() {
    if (!window.getToken()) return;
    if (isSent()) return;
    let start = getStartTime();
    if (!start) {
      start = Date.now();
      setStartTime(start);
    }
    const elapsed = Date.now() - start;
    const remaining = REQUIRED_MS - elapsed;
    if (remaining <= 0) { pingActivity(); return; }
    if (activityTimer) clearTimeout(activityTimer);
    activityTimer = setTimeout(() => { pingActivity(); }, remaining);
  }

  function stopTimer() {
    if (activityTimer) { clearTimeout(activityTimer); activityTimer = null; }
  }

  window.addEventListener('auth:changed', (e) => {
    if (e.detail.user) startTimer();
    else { stopTimer(); clearStartTime(); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      safeSet(HIDDEN_AT_KEY, Date.now());
      stopTimer();
    } else {
      const hiddenAt = safeGet(HIDDEN_AT_KEY);
      if (hiddenAt) {
        const awayMs = Date.now() - parseInt(hiddenAt, 10);
        const start = getStartTime();
        if (start) setStartTime(start + awayMs);
        safeRemove(HIDDEN_AT_KEY);
      }
      if (window.getToken() && !isSent()) startTimer();
    }
  });

  setTimeout(() => {
    if (window.currentUser && window.getToken()) startTimer();
  }, 1500);
})();

/* ============ УНИВЕРСАЛЬНОЕ МОДАЛЬНОЕ ОКНО ПОДТВЕРЖДЕНИЯ ============ */
window.confirmSiteModal = function ({ title, desc, confirmText = 'OK', cancelText = 'Отмена', onConfirm }) {
  if (document.getElementById('__siteConfirmModal')) {
    document.getElementById('__siteConfirmModal').remove();
  }

  if (!document.getElementById('__siteConfirmStyles')) {
    const style = document.createElement('style');
    style.id = '__siteConfirmStyles';
    style.textContent = `
      .site-confirm-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.75);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        animation: siteConfirmFade 0.2s;
      }
      @keyframes siteConfirmFade { from { opacity: 0; } to { opacity: 1; } }
      .site-confirm-box {
        background: linear-gradient(145deg, #1a1a1a, #0e0e0e);
        border: 1px solid #2a2a2a;
        border-radius: 22px;
        padding: 26px 26px 20px;
        max-width: 380px;
        width: 100%;
        box-shadow: 0 30px 80px rgba(0,0,0,0.8);
        animation: siteConfirmIn 0.25s cubic-bezier(0.22, 1, 0.36, 1);
      }
      @keyframes siteConfirmIn { from { opacity: 0; transform: scale(0.94) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      .site-confirm-title {
        font-family: 'Unbounded', sans-serif;
        font-size: 18px; font-weight: 700;
        color: #fff; letter-spacing: -0.4px;
        margin-bottom: 12px; line-height: 1.25;
      }
      .site-confirm-desc {
        font-family: 'Inter', sans-serif;
        font-size: 13.5px; color: #8a8a8a;
        line-height: 1.55; white-space: pre-line;
        margin-bottom: 22px;
      }
      .site-confirm-actions {
        display: flex; gap: 8px; justify-content: flex-end;
      }
      .site-confirm-actions button {
        padding: 11px 22px;
        border-radius: 11px;
        font-family: 'Inter', sans-serif;
        font-weight: 600; font-size: 13.5px;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.2s;
      }
      .site-confirm-cancel {
        background: transparent;
        color: #60a5fa;
        border: none;
      }
      .site-confirm-cancel:hover { color: #93c5fd; }
      .site-confirm-ok {
        background: transparent;
        color: #60a5fa;
        border: none;
        font-weight: 700;
      }
      .site-confirm-ok:hover { color: #93c5fd; }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'site-confirm-overlay';
  overlay.id = '__siteConfirmModal';
  overlay.innerHTML = `
    <div class="site-confirm-box">
      <div class="site-confirm-title">${window.escapeHtml(title || 'Подтвердите действие')}</div>
      ${desc ? `<div class="site-confirm-desc">${window.escapeHtml(desc)}</div>` : ''}
      <div class="site-confirm-actions">
        <button class="site-confirm-cancel" id="__siteConfirmCancel">${window.escapeHtml(cancelText)}</button>
        <button class="site-confirm-ok" id="__siteConfirmOk">${window.escapeHtml(confirmText)}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();

  document.getElementById('__siteConfirmCancel').onclick = close;
  document.getElementById('__siteConfirmOk').onclick = async () => {
    const btn = document.getElementById('__siteConfirmOk');
    btn.disabled = true;
    try { await onConfirm(); } finally { close(); }
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
};

console.log('[common] загружен');