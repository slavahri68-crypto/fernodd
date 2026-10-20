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
          detail: {
            points: data.points,
            streak: data.streak,
            frozen: data.frozen,
            grantedRewards: data.grantedRewards || [],
          }
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

/* ============ ОБРАБОТКА НАГРАД ============ */
window.addEventListener('activity:changed', (e) => {
  const granted = e.detail?.grantedRewards;
  if (!Array.isArray(granted) || !granted.length) return;
  for (const r of granted) {
    if (window.showToast) {
      window.showToast(`Награда за стрик: +${r.amount} ₽`, 'success', 5000);
    }
  }
});

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

/* ============ СТРИК-МОДАЛКА + РУЛЕТКА ============ */
window.openStreakModal = async function (e, activeTab = 'streak') {
  if (e) e.stopPropagation();

  if (!window.getToken()) {
    if (window.showToast) window.showToast('Войдите через Steam', 'error');
    return;
  }

  let modal = document.getElementById('streak2Modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'streak2Modal';
    modal.className = 'streak2-modal';
    modal.innerHTML = `<div class="streak2-inner" id="streak2Inner"></div>`;
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) window.closeStreakModal();
    });
    document.body.appendChild(modal);
  }

  const inner = document.getElementById('streak2Inner');
  inner.innerHTML = `<div class="streak2-loading"><div class="spinner"></div> Загрузка...</div>`;
  modal.classList.add('visible');

  try {
    const [status, rewards, roulette] = await Promise.all([
      window.api('/api/activity/status'),
      window.api('/api/activity/rewards').catch(() => ({ rewards: [], nextReward: null, daysLeft: 0 })),
      window.api('/api/roulette/status').catch(() => ({ canFree: false, prizes: [], history: [] })),
    ]);
    renderStreak2Modal({ ...status, ...rewards, roulette }, activeTab);
  } catch (err) {
    inner.innerHTML = `
      <div class="streak2-head">
        <div class="streak2-head-icon">${window.ICONS.alert}</div>
        <div class="streak2-head-text">
          <div class="streak2-head-title">Ошибка</div>
          <div class="streak2-head-sub">${window.escapeHtml(err.message || 'Не удалось загрузить')}</div>
        </div>
        <button class="streak2-close" onclick="closeStreakModal()">${window.ICONS.close}</button>
      </div>
    `;
  }
};

window.closeStreakModal = function () {
  const modal = document.getElementById('streak2Modal');
  if (modal) modal.classList.remove('visible');
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.closeStreakModal();
});

function pluralDays(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}

let currentWeekOffset = 0;
window.changeWeek = function(offset) {
  const newOffset = currentWeekOffset + offset;
  if (newOffset > 0 || newOffset < -2) return; // Смотрим от текущей до -2 недель
  
  currentWeekOffset = newOffset;
  
  const label = document.querySelector('.week-label');
  if (label) {
    if (currentWeekOffset === 0) label.textContent = 'Текущая неделя';
    else if (currentWeekOffset === -1) label.textContent = 'Прошлая неделя';
    else if (currentWeekOffset === -2) label.textContent = 'Позапрошлая неделя';
  }
  
  const data = window.__currentStreakData;
  if (!data) return;
  
  const grid = document.getElementById('streakWeekGrid');
  if (grid) {
    grid.innerHTML = buildWeek(data.streak, data.countedToday, data.frozen, data.todayKey, currentWeekOffset);
  }
};

function buildWeek(streak, countedToday, frozen, todayKey, weekOffset = 0) {
  const dayLabels = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
  const today = new Date();
  const dow = (today.getDay() + 6) % 7;
  
  const monday = new Date(today);
  monday.setDate(today.getDate() - dow + (weekOffset * 7));

  const startStreak = countedToday && weekOffset === 0 ? streak - 1 : streak;

  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const isToday = weekOffset === 0 && i === dow;
    const isPast = d < today;

    let cls = '';
    let iconHtml = '';

    if (isToday) {
      if (frozen) {
        cls = 'frozen-day';
        iconHtml = `<div class="sd-icon">${window.ICONS.snowflake}</div>`;
      } else if (countedToday) {
        cls = 'today done';
        iconHtml = `<div class="sd-icon">${window.ICONS.flame}</div>`;
      } else {
        cls = 'today';
        iconHtml = `<div class="sd-icon">${window.ICONS.flame}</div>`;
      }
    } else if (isPast) {
      const daysAgo = Math.round((today - d) / (1000 * 60 * 60 * 24));
      if (daysAgo <= startStreak && startStreak > 0) {
        cls = 'done';
        iconHtml = `<div class="sd-icon">${window.ICONS.flame}</div>`;
      } else {
        cls = 'missed';
        iconHtml = `<div class="sd-dot"></div>`;
      }
    } else {
      cls = 'locked';
      iconHtml = `<div class="sd-dot"></div>`;
    }

    html += `<div class="streak2-day ${cls}"><span>${dayLabels[i]}</span>${iconHtml}</div>`;
  }
  return html;
}

function renderStreak2Modal(data, activeTab = 'streak') {
  window.__currentStreakData = data; // Сохраняем для навигации по неделям
  currentWeekOffset = 0;
  
  const streak = data.streak || 0;
  const maxStreak = data.maxStreak || 0;
  const countedToday = !!data.countedToday;
  const frozen = !!data.frozen;
  const hasPlus = !!data.hasFernoddPlus;

  const frozenIcon = window.ICONS.snowflake;
  const fireIcon = window.ICONS.flame;
  const headIcon = frozen ? frozenIcon : fireIcon;
  const headClass = frozen ? 'frozen' : '';

  const bigHint = frozen
    ? 'Стрик заморожен · пропуск 1 дня не сгорит'
    : countedToday
      ? 'Огонёк засчитан сегодня'
      : 'Заходи 5 минут — огонёк засчитается';

  const weekHtml = buildWeek(streak, countedToday, frozen, data.todayKey || '', 0);

  const rewardsList = data.rewards || [];
  const nextReward = data.nextReward;
  const daysLeft = data.daysLeft || 0;

  const prevAt = (() => {
    if (!nextReward) return rewardsList.length ? rewardsList[rewardsList.length - 1].milestone : 0;
    const idx = rewardsList.findIndex(r => r.milestone === nextReward.milestone);
    return idx > 0 ? rewardsList[idx - 1].milestone : 0;
  })();
  const progress = nextReward
    ? Math.max(0, Math.min(1, (streak - prevAt) / (nextReward.milestone - prevAt)))
    : 1;

  const rewardsHtml = rewardsList.map(r => {
    const icon = window.ICONS.gift;
    const cls = r.isClaimed ? 'active' : (r === nextReward ? 'current' : '');
    const label = r.isClaimed ? `✓ ${r.label}` : r.label;
    return `
      <div class="streak2-reward ${cls}">
        <div class="streak2-reward-icon">${icon}</div>
        <div class="streak2-reward-label">${label}</div>
      </div>
    `;
  }).join('');

  const freezesLeft = data.freezesLeft !== undefined ? data.freezesLeft : 1;
  const maxFreezes = data.maxFreezes || 1;
  const freezeBtnHtml = hasPlus
    ? (frozen
        ? `<div style="font-size: 11px; color: #60a5fa; margin-top: 4px; font-weight: 600;">Заморозка</div>`
        : `<div style="font-size: 11px; color: #4ade80; margin-top: 4px; font-weight: 600; cursor: pointer;" onclick="freezeStreakFromModal()">Заморозить →</div>`)
    : '';

  const streakPanel = `
    <div class="streak2-main-new">
      <div class="streak-big-card">
        <div class="streak-big-num">${streak}</div>
        <div class="streak-big-text">дней подряд</div>
        <div class="streak-big-hint">${countedToday ? 'Засчитано сегодня' : 'Сыграй 5 мин сегодня'}</div>
        <div class="streak-big-bg-icon">${fireIcon}</div>
      </div>
      <div class="streak-side-cards">
        <div class="streak-side-card">
          <div class="streak-side-val">${maxStreak}</div>
          <div class="streak-side-label">рекорд</div>
        </div>
        <div class="streak-side-card">
          <div class="streak-side-val blue">${freezesLeft} / ${maxFreezes}</div>
          <div class="streak-side-label">заморозка</div>
          ${freezeBtnHtml}
        </div>
      </div>
    </div>

    <div class="streak-week-navigation">
      <button class="nav-arrow" onclick="changeWeek(-1)">←</button>
      <div class="week-label">Текущая неделя</div>
      <button class="nav-arrow" onclick="changeWeek(1)">→</button>
    </div>

    <div class="streak2-week" id="streakWeekGrid">
      ${weekHtml}
    </div>

    <div class="streak2-rewards">
      <div class="streak2-rewards-head">
        <div class="streak2-rewards-title">Награда за стрик</div>
        <div class="streak2-rewards-sub">Каждые 7 дней стрика</div>
      </div>
      <div class="streak-rewards-cards">
        ${rewardsHtml}
      </div>
      <div class="streak-rewards-footer">
        ${daysLeft > 0 ? `Награда через ${daysLeft} ${pluralDays(daysLeft)}` : 'Награда получена!'}
      </div>
    </div>
  `;

  // Рулетка
  const r = data.roulette || {};
  const canFree = !!r.canFree;
  const rDaysLeft = r.daysLeft || 0;
  const rHistory = r.history || [];
  const freeSpinsLeft = r.freeSpinsLeft || 0;
  const maxSpins = r.maxSpins || 1;

  const canPaid = !!r.canPaid;
  const paidPrice = r.paidPrice || 99;

  let freeBtnLabel;
  if (canFree) {
    freeBtnLabel = maxSpins > 1
      ? `Крутить${freeSpinsLeft === 2 ? '²' : '¹'}`
      : 'Крутить бесплатно';
  } else {
    freeBtnLabel = `Через ${rDaysLeft} ${pluralDays(rDaysLeft)}`;
  }

  const historyHtml = rHistory.length
    ? rHistory.map(h => {
        const tierCls = h.tier === 'red' ? 'tier-red' : h.tier === 'purple' ? 'tier-purple' : h.tier === 'empty' ? 'tier-empty' : 'tier-blue';
        const label = h.amount > 0 ? `${h.amount} ₽` : 'пусто';
        const date = new Date(h.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `<div class="roulette-history-row ${tierCls}">
          <span class="rh-label">${label}</span>
          <span class="rh-date">${date}</span>
        </div>`;
      }).join('')
    : `<div class="roulette-history-empty">Пока нет спинов</div>`;

  const roulettePanel = `
    <div class="roulette-wrap">
      <div class="roulette-arrow"></div>
      <div class="roulette-strip" id="rouletteStrip"></div>
    </div>

    <div class="roulette-buttons">
      <button class="roulette-spin-btn free ${canFree ? '' : 'disabled'}" id="rouletteFreeBtn" ${canFree ? '' : 'disabled'}>
        ${freeBtnLabel}
      </button>
      <button class="roulette-spin-btn paid ${canPaid ? '' : 'disabled'}" id="roulettePaidBtn" ${canPaid ? '' : 'disabled'}>
        Крутить за ${paidPrice} ₽
      </button>
    </div>

    <div class="roulette-history">
      <div class="roulette-history-title">Последние спины</div>
      <div class="roulette-history-list">${historyHtml}</div>
    </div>
  `;

  const inner = document.getElementById('streak2Inner');
  inner.innerHTML = `
    <div class="streak2-head">
      <div class="streak2-head-icon ${headClass}">${headIcon}</div>
      <div class="streak2-head-text">
        <div class="streak2-head-title">Стрик непрерывной игры</div>
        <div class="streak2-head-sub">Заходи каждый день — получай награды</div>
      </div>
      <button class="streak2-close" onclick="closeStreakModal()">${window.ICONS.close}</button>
    </div>

    <div class="streak2-tabs">
      <button class="streak2-tab ${activeTab === 'streak' ? 'active' : ''}" data-tab="streak">Стрик</button>
      <button class="streak2-tab ${activeTab === 'roulette' ? 'active' : ''}" data-tab="roulette">Рулетка</button>
    </div>

    <div class="streak2-panel ${activeTab === 'streak' ? 'active' : ''}" data-panel="streak">${streakPanel}</div>
    <div class="streak2-panel ${activeTab === 'roulette' ? 'active' : ''}" data-panel="roulette">${roulettePanel}</div>
  `;

  inner.querySelectorAll('.streak2-tab').forEach(tab => {
    tab.onclick = () => {
      const t = tab.dataset.tab;
      inner.querySelectorAll('.streak2-tab').forEach(x => x.classList.toggle('active', x === tab));
      inner.querySelectorAll('.streak2-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === t));
    };
  });

  if (document.getElementById('rouletteStrip')) {
    initRouletteStrip(data.roulette?.prizes || []);
    const freeBtn = document.getElementById('rouletteFreeBtn');
    if (freeBtn && canFree) {
      freeBtn.onclick = () => spinRoulette(data, 'free');
    }
    const paidBtn = document.getElementById('roulettePaidBtn');
    if (paidBtn && canPaid) {
      paidBtn.onclick = () => {
        if (window.confirmSiteModal) {
          window.confirmSiteModal({
            title: `Крутить за ${paidPrice} ₽?`,
            desc: 'Спин платный. Сумма спишется сразу.',
            confirmText: 'Крутить',
            cancelText: 'Отмена',
            onConfirm: () => spinRoulette(data, 'paid'),
          });
        } else {
          spinRoulette(data, 'paid');
        }
      };
    }
  }
}

window.freezeStreakFromModal = async function () {
  if (window.confirmSiteModal) {
    window.confirmSiteModal({
      title: 'Заморозить стрик?',
      desc: 'Пропустишь 1 день — стрик не сгорит.\nПропустишь 2 — сгорит.',
      confirmText: 'Заморозить',
      cancelText: 'Отмена',
      onConfirm: async () => {
        try {
          const r = await window.api('/api/activity/freeze', { method: 'POST' });
          if (window.showToast) window.showToast(`Заморозка активна (${r.streak})`, 'success');
          window.closeStreakModal();
          setTimeout(() => window.openStreakModal(), 400);
        } catch (err) {
          const errors = {
            fernodd_plus_required: 'Только для FERNODD+',
            no_streak_to_freeze: 'У вас ещё нет стрика',
            already_frozen: 'Заморозка уже активна',
            must_visit_first: 'Сначала зайдите сегодня',
            no_db: 'Ошибка базы данных',
          };
          const key = err.message.split(' — ')[0];
          if (window.showToast) window.showToast(errors[key] || err.message, 'error');
        }
      }
    });
  }
};

/* ============ РУЛЕТКА ============ */
function initRouletteStrip(prizes) {
  const strip = document.getElementById('rouletteStrip');
  if (!strip) return;

  const pool = [];
  for (const p of prizes) {
    const count = Math.max(1, Math.round(p.weight * 2));
    for (let i = 0; i < count; i++) pool.push(p);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const items = [];
  for (let i = 0; i < 60; i++) items.push(pool[i % pool.length]);

  strip.innerHTML = items.map(p => {
    const tierCls = p.tier === 'red' ? 'tier-red' : p.tier === 'purple' ? 'tier-purple' : p.tier === 'empty' ? 'tier-empty' : 'tier-blue';
    const label = p.amount > 0 ? `${p.amount} ₽` : 'пусто';
    return `<div class="roulette-card ${tierCls}">${label}</div>`;
  }).join('');

  strip.style.transform = 'translateX(0)';
}

async function spinRoulette(statusData, spinType = 'free') {
  const strip = document.getElementById('rouletteStrip');
  if (!strip) return;

  const freeBtn = document.getElementById('rouletteFreeBtn');
  const paidBtn = document.getElementById('roulettePaidBtn');
  const activeBtn = spinType === 'paid' ? paidBtn : freeBtn;
  const idleText = spinType === 'paid'
    ? `Крутить за ${statusData.roulette?.paidPrice || 99} ₽`
    : 'Крутить бесплатно';

  if (freeBtn) freeBtn.disabled = true;
  if (paidBtn) paidBtn.disabled = true;
  if (activeBtn) activeBtn.textContent = 'Крутим...';

  try {
    const result = await window.api('/api/roulette/spin', {
      method: 'POST',
      body: JSON.stringify({ type: spinType }),
    });
    const prize = result.prize;
    const tierCls = prize.tier === 'red' ? 'tier-red' : prize.tier === 'purple' ? 'tier-purple' : prize.tier === 'empty' ? 'tier-empty' : 'tier-blue';

    const cards = strip.querySelectorAll('.roulette-card');
    const total = cards.length;
    
    // Чиним рулетку, чтобы выпадало именно то, что показано
    let targetIndex = cards.length - 8; 
    for (let i = 0; i < cards.length; i++) {
        if (cards[i].textContent.includes(prize.amount > 0 ? prize.amount : 'пусто')) {
            targetIndex = i;
            break;
        }
    }
    if (targetIndex < 5) targetIndex += 5;

    const cardWidth = cards[0].offsetWidth + 6;
    const containerWidth = strip.parentElement.offsetWidth;
    const offset = targetIndex * cardWidth + cardWidth / 2 - containerWidth / 2;

    strip.style.transition = 'transform 5s cubic-bezier(0.15, 0.9, 0.15, 1)';
    strip.style.transform = `translateX(-${offset}px)`;

    setTimeout(async () => {
      const wonCard = cards[targetIndex];
      if (wonCard) wonCard.classList.add('won', tierCls);

      showRouletteResult(prize);

      if (window.currentUser && typeof result.newBalance === 'number') {
        window.currentUser.balance = result.newBalance;
      }

      setTimeout(() => {
        window.closeStreakModal();
        setTimeout(() => window.openStreakModal(null, 'roulette'), 300);
      }, 2500);
    }, 5100);
  } catch (err) {
    const errors = {
      cooldown: 'Бесплатный спин ещё не доступен',
      not_enough_streak: 'Нужен стрик 7+ дней',
      insufficient_balance: 'Недостаточно средств для платного спина',
      no_db: 'Ошибка базы данных',
      rate_limit_exceeded: 'Слишком часто',
    };
    const key = err.message.split(' — ')[0];
    if (window.showToast) window.showToast(errors[key] || err.message, 'error');
    if (freeBtn) freeBtn.disabled = false;
    if (paidBtn) paidBtn.disabled = false;
    if (activeBtn) activeBtn.textContent = idleText;
  }
}

function showRouletteResult(prize) {
  const isWin = prize.amount > 0;
  const tierCls = prize.tier === 'red' ? 'red' : prize.tier === 'purple' ? 'purple' : prize.tier === 'empty' ? 'empty' : 'blue';
  const label = isWin ? `${prize.amount} ₽` : 'Пусто';

  let modal = document.getElementById('rouletteResultModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'rouletteResultModal';
    modal.className = 'roulette-result-modal';
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="roulette-result-inner tier-${tierCls}">
      <div class="roulette-result-label">${isWin ? 'Вы выиграли' : 'Не повезло'}</div>
      <div class="roulette-result-amount">${label}</div>
      ${isWin ? `<div class="roulette-result-sub">Зачислено на баланс</div>` : `<div class="roulette-result-sub">Попробуйте в следующий раз</div>`}
    </div>
  `;
  modal.classList.add('visible');
  setTimeout(() => modal.remove(), 2500);
}

window.spinRoulette = spinRoulette;

console.log('[common] загружен');
