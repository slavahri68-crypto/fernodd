(function() {
  const ICONS = {
    profile: window.ICONS.user,
    skins:   window.ICONS.palette,
    inv:     window.ICONS.box,
    friends: window.ICONS.users,
    tx:      window.ICONS.chart,
    ref:     window.ICONS.gift,
    shop:    window.ICONS.cart,
    settings:window.ICONS.settings,
    admin:   window.ICONS.shield,
    promo:   window.ICONS.tag,
    logout:  window.ICONS.logout,
  };

  window.PROFILE_PAGES = [
    { href: '/profile',                 icon: ICONS.profile,  label: 'Профиль',     key: 'profile' },
    { href: '/profile#inventory',       icon: ICONS.inv,      label: 'Инвентарь',   key: 'inventory' },
    { href: '/profile#skins',           icon: ICONS.skins,    label: 'Скины',       key: 'skins' },
    { href: '/profile#friends',         icon: ICONS.friends,  label: 'Друзья',      key: 'friends' },
    { href: '/profile#transactions',    icon: ICONS.tx,       label: 'Транзакции',  key: 'transactions' },
    { href: '/profile',                 icon: ICONS.ref,      label: 'Рефералы',    key: 'referrals' },
    { href: '/shop',                    icon: ICONS.shop,     label: 'Магазин',     key: 'shop' },
  ];

  window.ADMIN_ACCESS_ROLES = ['Куратор', 'Следящий', 'Техническая поддержка'];
  window.PROFILE_EDIT_ROLES = ['Следящий', 'Техническая поддержка', 'Владелец'];

  window.canEditOthersProfiles = function(user) {
    if (!user) return false;
    if (user.isOwner || user.isHeadAdmin) return true;
    const allRoles = [...(user.roles || []), ...(user.siteRoles || [])].map(r => (r || '').toLowerCase());
    return allRoles.some(r => window.PROFILE_EDIT_ROLES.map(x => x.toLowerCase()).includes(r));
  };

  window.canAccessAdmin = function(user) {
    if (!user) return false;
    if (user.isOwner || user.isHeadAdmin) return true;
    const allRoles = [...(user.roles || []), ...(user.siteRoles || [])].map(r => (r || '').toLowerCase());
    return allRoles.some(r => window.ADMIN_ACCESS_ROLES.map(x => x.toLowerCase()).includes(r));
  };

  window.renderProfileMenu = function(activeKey) {
    const user = window.currentUser;
    if (!user) return '';
    const avatar = user.avatar || '';
    const balance = Number(user.balance || 0).toLocaleString('ru-RU');

    const adminItem = window.canAccessAdmin(user)
      ? `<a class="my-menu-item" href="/admin" style="color:var(--red);">
           <span class="my-menu-icon">${ICONS.admin}</span><span>Админ-панель</span>
         </a>` : '';

    const avatarHTML = avatar
      ? `<img class="my-menu-avatar" src="${avatar}" alt="">`
      : `<div class="my-menu-avatar my-menu-avatar-empty"></div>`;

    return `
      <div class="my-menu">
        <div class="my-menu-head">
          ${avatarHTML}
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
          <span>Промокод</span>
        </button>
        ${adminItem}
        <div class="my-menu-divider"></div>
        <div class="my-menu-bottom-row">
          <button class="my-menu-item danger" onclick="handleProfileLogout()">
            <span class="my-menu-icon">${ICONS.logout}</span>
            <span>Выйти</span>
          </button>
          <a class="my-menu-item my-menu-settings-btn" href="/profile#settings" title="Настройки">
            <span class="my-menu-icon">${ICONS.settings}</span>
          </a>
        </div>
      </div>
    `;
  };

  window.toggleProfileMenu = function(e) {
    if (e) e.stopPropagation();
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
    const profileBtn = document.getElementById('profileAvatarBtn');
    const authWidget = document.getElementById('authWidget');

    if (!user) {
      if (profileBtn) profileBtn.style.display = 'none';
      if (authWidget) authWidget.style.display = '';
      return;
    }

    if (profileBtn) profileBtn.style.display = '';
    if (authWidget) authWidget.style.display = 'none';

    const avatar = document.getElementById('headerAvatar');
    if (avatar) {
      if (user.avatar) {
        avatar.src = user.avatar;
        avatar.style.display = '';
      } else {
        avatar.src = '';
        avatar.style.display = 'none';
      }
    }

    const menuBox = document.getElementById('profileMenuContent');
    if (menuBox) {
      const path = window.location.pathname.replace('/', '').replace('.html', '');
      menuBox.innerHTML = window.renderProfileMenu(path || 'profile');
    }
  });

  console.log('[my-profile] загружен');
})();