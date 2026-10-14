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

window.showToast = function (text, type = 'info', ms = 3000) {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) { console.log('[toast:' + type + ']', text); return; }
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = '<span style="font-weight:900;">' + (icons[type] || 'ℹ') + '</span>' +
    '<span class="toast-msg">' + window.escapeHtml(text) + '</span>';
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 300); }, ms);
};

window.formatDate = function (date) {
  if (!date) return '—';
  try { return new Date(date).toLocaleString('ru-RU'); } catch { return String(date); }
};

window.getToken = function () { return localStorage.getItem('fernodd_token') || ''; };

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

/* ============ СТРИК: 5 минут активного времени на сайте ============ */
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

console.log('[common] загружен');