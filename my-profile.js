/* ============ ОБЩИЕ УТИЛИТЫ ДЛЯ ПРОФИЛЯ ============ */
(function() {
  window.PROFILE_PAGES = [
    { href: '/profile.html',      icon: '👤', label: 'Профиль',     key: 'profile' },
    { href: '/skins.html',        icon: '🔪', label: 'Скины',       key: 'skins' },
    { href: '/inventory.html',    icon: '📦', label: 'Инвентарь',   key: 'inventory' },
    { href: '/friends.html',      icon: '👥', label: 'Друзья',      key: 'friends' },
    { href: '/transactions.html', icon: '💸', label: 'Транзакции',  key: 'transactions' },
    { href: '/settings.html',     icon: '⚙️', label: 'Настройки',   key: 'settings' },
  ];

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
            <div class="my-menu-name">${escapeHtml(user.global_name || user.username)}</div>
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

  window.escapeHtml = function(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  window.showToast = function(text, type = 'info', ms = 3000) {
    const wrap = document.getElementById('toastWrap');
    if (!wrap) return;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<span style="font-weight:900;">${icons[type] || 'ℹ'}</span><span class="toast-msg">${escapeHtml(text)}</span>`;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 300);
    }, ms);
  };

  window.getToken = function() { return localStorage.getItem('fernodd_token') || ''; };

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
    if (!r.ok) throw new Error((data.error || 'error') + ' — ' + (data.details || ''));
    return data;
  };

  window.toggleProfileMenu = function(e) {
    e.stopPropagation();
    document.getElementById('profileAvatarBtn').classList.toggle('open');
  };

  document.addEventListener('click', (e) => {
    const btn = document.getElementById('profileAvatarBtn');
    if (btn && !btn.contains(e.target)) btn.classList.remove('open');
  });
})();