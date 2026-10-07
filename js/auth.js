/* ============ AUTH через Steam ============ */
window.currentUser = null;
window.API = window.API_BASE || 'https://fernodd-api.onrender.com';

function getToken() {
  return localStorage.getItem('fernodd_token');
}
function setToken(t) {
  if (t) localStorage.setItem('fernodd_token', t);
  else localStorage.removeItem('fernodd_token');
}

(function captureTokenFromURL() {
  const url = new URL(window.location.href);
  const t = url.searchParams.get('token');
  if (t) {
    setToken(t);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.pathname + url.search);
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  const authWidget = document.getElementById('authWidget');
  if (!authWidget) return;
  loadUser(authWidget);

  document.addEventListener('click', (e) => {
    const block = document.getElementById('authUserBlock');
    if (block && block.classList.contains('open') && !block.contains(e.target)) {
      block.classList.remove('open');
    }
  });
});

async function loadUser(authWidget) {
  const token = getToken();
  if (!token) { renderGuest(authWidget); return; }
  try {
    const r = await fetch(window.API + '/api/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await r.json();
    window.currentUser = data.user;
    if (window.currentUser) renderUser(authWidget, window.currentUser);
    else { setToken(null); renderGuest(authWidget); }
  } catch (e) {
    console.error('[auth] ошибка /api/me:', e);
    renderGuest(authWidget);
  }
}

function renderGuest(authWidget) {
  authWidget.innerHTML = `
    <a class="auth-login" href="${window.API}/auth/steam">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/>
      </svg>
      Войти
    </a>
  `;
  window.currentUser = null;
  window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: null } }));
}

function renderUser(authWidget, user) {
  authWidget.innerHTML = `
    <div class="auth-user" id="authUserBlock">
      <img class="auth-avatar" src="${user.avatar}" alt="" onclick="toggleAuthMenu(event)">
      <div class="auth-user-menu">
        <div class="auth-menu-header">
          <img src="${user.avatar}" alt="">
          <div>
            <div class="auth-menu-name">${user.global_name || user.username}</div>
            <div class="auth-menu-role">${user.isOwner ? 'Владелец' : ((user.roles && user.roles[0]) || 'Steam')}</div>
          </div>
        </div>
        <div class="auth-menu-divider"></div>
        <a class="auth-menu-item" href="/apply.html">
          <svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          Заявки
        </a>
        <a class="auth-menu-item" href="/profile.html">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/></svg>
          Профиль
        </a>
        ${user.isAdmin ? `
        <a class="auth-menu-item" href="/admin.html">
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
          Админ-панель
        </a>` : ''}
        <a class="auth-menu-item" href="/settings.html">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Настройки
        </a>
        <div class="auth-menu-divider"></div>
        <button class="auth-menu-item danger" onclick="logoutUser()">
          <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Выйти
        </button>
      </div>
    </div>
  `;
  window.currentUser = user;
  window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user } }));
}

function toggleAuthMenu(e) {
  e.stopPropagation();
  const block = document.getElementById('authUserBlock');
  if (block) block.classList.toggle('open');
}

function logoutUser() {
  setToken(null);
  window.location.reload();
}