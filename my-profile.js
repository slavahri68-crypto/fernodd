/* ================================================================
   FERNODD — ОБЩИЕ УТИЛИТЫ ДЛЯ ПРОФИЛЯ
   ================================================================ */
(function() {
  window.PROFILE_PAGES = [
    { href: '/profile.html',      icon: '👤', label: 'Профиль',     key: 'profile' },
    { href: '/skins.html',        icon: '🔪', label: 'Скины',       key: 'skins' },
    { href: '/inventory.html',    icon: '📦', label: 'Инвентарь',   key: 'inventory' },
    { href: '/friends.html',      icon: '👥', label: 'Друзья',      key: 'friends' },
    { href: '/transactions.html', icon: '💸', label: 'Транзакции',  key: 'transactions' },
    { href: '/referrals.html',    icon: '🎁', label: 'Рефералы',    key: 'referrals' },
    { href: '/settings.html',     icon: '⚙️', label: 'Настройки',   key: 'settings' },
  ];

  window.ADMIN_ACCESS_ROLES = ['Куратор', 'Следящий', 'Главная администрация'];

  window.canAccessAdmin = function(user) {
    if (!user) return false;
    if (user.isOwner || user.isHeadAdmin) return true;
    return (user.roles || []).some(r => window.ADMIN_ACCESS_ROLES.includes(r));
  };

  window.renderProfileMenu = function(activeKey) {
    const user = window.currentUser;
    if (!user) return '';

    const avatar = user.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
    const balance = user.balance || 0;

    const adminItem = window.canAccessAdmin(user)
      ? `<a class="my-menu-item" href="/admin.html" style="color:var(--red);">
           <span class="my-menu-icon">🛡️</span><span>Админ-панель</span>
         </a>`
      : '';

    return `
      <div class="my-menu">
        <div class="my-menu-head">
          <img class="my-menu-avatar" src="${avatar}" alt="">
          <div style="min-width:0;flex:1;">
            <div class="my-menu-name">${window.escapeHtml(user.global_name || user.username || 'Пользователь')}</div>
            <div class="my-menu-balance">${balance} ₽</div>
          </div>
        </div>
        <div class="my-menu-divider"></div>
        ${window.PROFILE_PAGES.map(p => `
          <a class="my-menu-item ${p.key === activeKey ? 'active' : ''}" href="${p.href}">
            <span class="my-menu-icon">${p.icon}</span>
            <span>${p.label}</span>
          </a>
        `).join('')}
        ${adminItem}
      </div>
    `;
  };

  window.escapeHtml = function(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  window.showToast = function(text, type = 'info', ms = 3000) {
    const wrap = document.getElementById('toastWrap');
    if (!wrap) { console.log('[toast:' + type + ']', text); return; }
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML =
      '<span style="font-weight:900;">' + (icons[type] || 'ℹ') + '</span>' +
      '<span class="toast-msg">' + window.escapeHtml(text) + '</span>';
    wrap.appendChild(el);
    setTimeout(function() {
      el.classList.add('fade');
      setTimeout(function() { el.remove(); }, 300);
    }, ms);
  };

  window.getToken = function() {
    return localStorage.getItem('fernodd_token') || '';
  };

  window.api = async function(path, options = {}) {
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
    try { data = JSON.parse(text); } catch { data = { error: text }; }
    if (!r.ok) {
      throw new Error((data.error || 'error') + ' — ' + (data.details || ''));
    }
    return data;
  };

  window.toggleProfileMenu = function(e) {
    e.stopPropagation();
    const btn = document.getElementById('profileAvatarBtn');
    if (btn) btn.classList.toggle('open');
  };

  document.addEventListener('click', (e) => {
    const btn = document.getElementById('profileAvatarBtn');
    if (btn && !btn.contains(e.target)) {
      btn.classList.remove('open');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const btn = document.getElementById('profileAvatarBtn');
      if (btn) btn.classList.remove('open');
    }
  });

  window.addEventListener('auth:changed', (e) => {
    const user = e.detail.user;
    if (!user) return;

    const avatar = document.getElementById('headerAvatar');
    const balance = document.getElementById('headerBalance');

    if (avatar) avatar.src = user.avatar || '';
    if (balance) balance.textContent = `${user.balance || 0} ₽`;

    const menuBox = document.getElementById('profileMenuContent');
    if (menuBox) {
      const path = window.location.pathname.replace('/', '').replace('.html', '');
      menuBox.innerHTML = window.renderProfileMenu(path || 'profile');
    }
  });

  console.log('[my-profile] загружен');
})();