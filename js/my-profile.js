(function() {
  const ICONS = {
    profile: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/></svg>`,
    skins:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 3.5L21 10l-9 9-6.5-6.5z"/><path d="M5 15l-1.5 5.5L9 19"/></svg>`,
    inv:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    friends: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    tx:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
    ref:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`,
    shop:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
    settings:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    admin:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    promo:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`,
    logout:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  };

  window.PROFILE_PAGES = [
    { href: '/profile',      icon: ICONS.profile,  label: 'Профиль',     key: 'profile' },
    { href: '/skins',        icon: ICONS.skins,    label: 'Скины',       key: 'skins' },
    { href: '/inventory',    icon: ICONS.inv,      label: 'Инвентарь',   key: 'inventory' },
    { href: '/friends',      icon: ICONS.friends,  label: 'Друзья',      key: 'friends' },
    { href: '/transactions', icon: ICONS.tx,       label: 'Транзакции',  key: 'transactions' },
    { href: '/referrals',    icon: ICONS.ref,      label: 'Рефералы',    key: 'referrals' },
    { href: '/shop',         icon: ICONS.shop,     label: 'Магазин',     key: 'shop' },
  ];

  window.ADMIN_ACCESS_ROLES = ['Куратор', 'Следящий', 'Главная администрация'];

  window.canAccessAdmin = function(user) {
    if (!user) return false;
    if (user.isOwner || user.isHeadAdmin) return true;
    const allRoles = [...(user.roles || []), ...(user.siteRoles || [])];
    return allRoles.some(r =>
      window.ADMIN_ACCESS_ROLES.some(adminRole =>
        r && r.toLowerCase() === adminRole.toLowerCase()
      )
    );
  };

  window.renderProfileMenu = function(activeKey) {
    const user = window.currentUser;
    if (!user) return '';
    const avatar = user.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
    const balance = Number(user.balance || 0).toLocaleString('ru-RU');

    const adminItem = window.canAccessAdmin(user)
      ? `<a class="my-menu-item" href="/admin" style="color:var(--red);">
           <span class="my-menu-icon">${ICONS.admin}</span><span>Админ-панель</span>
         </a>` : '';

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
        <button class="my-menu-item" onclick="handleProfilePromo(event)">
          <span class="my-menu-icon">${ICONS.promo}</span>
          <span>Активировать промокод</span>
        </button>
        ${adminItem}
        <div class="my-menu-divider"></div>
        <div class="my-menu-bottom-row">
          <button class="my-menu-item danger" onclick="handleProfileLogout()">
            <span class="my-menu-icon">${ICONS.logout}</span>
            <span>Выйти</span>
          </button>
          <a class="my-menu-item my-menu-settings-btn" href="/settings" title="Настройки">
            <span class="my-menu-icon">${ICONS.settings}</span>
          </a>
        </div>
      </div>
    `;
  };

  window.toggleProfileMenu = function(e) {
    e.stopPropagation();
    const btn = document.getElementById('profileAvatarBtn');
    if (btn) btn.classList.toggle('open');
  };

  window.handleProfileLogout = function() {
    try { localStorage.removeItem('fernodd_token'); } catch (e) {}
    window.location.href = '/';
  };

  window.handleProfilePromo = function(e) {
    if (e) e.stopPropagation();
    const btn = document.getElementById('profileAvatarBtn');
    if (btn) btn.classList.remove('open');
    if (typeof window.openPromoActivate === 'function') {
      setTimeout(() => window.openPromoActivate(), 150);
    }
  };

  document.addEventListener('click', (e) => {
    const btn = document.getElementById('profileAvatarBtn');
    if (btn && !btn.contains(e.target)) btn.classList.remove('open');
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
    if (avatar) avatar.src = user.avatar || '';
    const menuBox = document.getElementById('profileMenuContent');
    if (menuBox) {
      const path = window.location.pathname.replace('/', '').replace('.html', '');
      menuBox.innerHTML = window.renderProfileMenu(path || 'profile');
    }
  });

  console.log('[my-profile] загружен');
})();
