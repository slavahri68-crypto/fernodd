/* ================================================================
   FERNODD — ОБЩИЕ УТИЛИТЫ ДЛЯ ПРОФИЛЯ
   ================================================================ */
(function() {
  /* Список страниц для меню */
  window.PROFILE_PAGES = [
    { href: '/profile.html',      icon: '👤', label: 'Профиль',     key: 'profile' },
    { href: '/skins.html',        icon: '🔪', label: 'Скины',       key: 'skins' },
    { href: '/inventory.html',    icon: '📦', label: 'Инвентарь',   key: 'inventory' },
    { href: '/friends.html',      icon: '👥', label: 'Друзья',      key: 'friends' },
    { href: '/transactions.html', icon: '💸', label: 'Транзакции',  key: 'transactions' },
    { href: '/settings.html',     icon: '⚙️', label: 'Настройки',   key: 'settings' },
  ];

  /* ============================================================
     МЕНЮ ПРОФИЛЯ
     ============================================================ */
  window.renderProfileMenu = function(activeKey) {
    const user = window.currentUser;
    if (!user) return '';

    const avatar = user.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
    const balance = user.balance || 0;
    const coins = user.coins || 0;

    return `
      <div class="my-menu">
        <div class="my-menu-head">
          <img class="my-menu-avatar" src="${avatar}" alt="">
          <div>
            <div class="my-menu-name">${escapeHtml(user.global_name || user.username || 'Пользователь')}</div>
            <div class="my-menu-balance">${balance} ₽ | ${coins} койн(ов)</div>
          </div>
        </div>
        <div class="my-menu-divider"></div>
        ${PROFILE_PAGES.map(p => `
          <a class="my-menu-item ${p.key === activeKey ? 'active' : ''}" href="${p.href}">
            <span class="my-menu-icon">${p.icon}</span>
            <span>${p.label}</span>
          </a>
        `).join('')}
      </div>
    `;
  };

  /* ============================================================
     ЭКРАНИРОВАНИЕ HTML
     ============================================================ */
  window.escapeHtml = function(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /* ============================================================
     ТОСТ-УВЕДОМЛЕНИЯ
     ============================================================ */
  window.showToast = function(text, type = 'info', ms = 3000) {
    const wrap = document.getElementById('toastWrap');
    if (!wrap) {
      console.log('[toast:' + type + ']', text);
      return;
    }
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML =
      '<span style="font-weight:900;">' + (icons[type] || 'ℹ') + '</span>' +
      '<span class="toast-msg">' + escapeHtml(text) + '</span>';
    wrap.appendChild(el);
    setTimeout(function() {
      el.classList.add('fade');
      setTimeout(function() { el.remove(); }, 300);
    }, ms);
  };

  /* ============================================================
     ТОКЕН + API
     ============================================================ */
  window.getToken = function() {
    return localStorage.getItem('fernodd_token') || '';
  };

  window.api = async function(path, options = {}) {
    const base = window.API_BASE || '';
    const r = await fetch(base + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken(),
        ...(options.headers || {})
      }
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }
    if (!r.ok) {
      throw new Error((data.error || 'error') + ' — ' + (data.details || ''));
    }
    return data;
  };

  /* ============================================================
     МЕНЮ ПРОФИЛЯ — ОТКРЫТИЕ / ЗАКРЫТИЕ
     ============================================================ */
  window.toggleProfileMenu = function(e) {
    e.stopPropagation();
    const btn = document.getElementById('profileAvatarBtn');
    if (btn) btn.classList.toggle('open');
  };

  /* Закрытие по клику вне */
  document.addEventListener('click', (e) => {
    const btn = document.getElementById('profileAvatarBtn');
    if (btn && !btn.contains(e.target)) {
      btn.classList.remove('open');
    }
  });

  /* Закрытие по Escape */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const btn = document.getElementById('profileAvatarBtn');
      if (btn) btn.classList.remove('open');
    }
  });

  /* ============================================================
     ОБНОВЛЕНИЕ HEADER ВСЕГДА ПРИ СМЕНЕ ЮЗЕРА
     ============================================================ */
  window.addEventListener('auth:changed', (e) => {
    const user = e.detail.user;
    if (!user) return;

    const avatar = document.getElementById('headerAvatar');
    const balance = document.getElementById('headerBalance');
    const coins = document.getElementById('headerCoins');

    if (avatar) avatar.src = user.avatar || '';
    if (balance) balance.textContent = `${user.balance || 0} ₽`;
    if (coins) coins.textContent = `${user.coins || 0}`;
  });

  console.log('[my-profile] загружен');
})();