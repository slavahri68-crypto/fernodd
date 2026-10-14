window.currentUser = null;
window.API = window.API_BASE || 'https://fernodd.onrender.com';
let currentBalance = 0;

function getToken() { return localStorage.getItem('fernodd_token'); }
function setToken(t) {
  if (t) localStorage.setItem('fernodd_token', t);
  else localStorage.removeItem('fernodd_token');
}

/* ============ МОДАЛКА ============ */
function ensureAuthModalStyles() {
  if (document.getElementById('authModalStyles')) return;
  const style = document.createElement('style');
  style.id = 'authModalStyles';
  style.textContent = `
    .fd-auth-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);z-index:9999;display:none;align-items:center;justify-content:center;padding:20px;animation:fdAuthFadeIn 0.25s;}
    .fd-auth-modal-overlay.visible{display:flex;}
    @keyframes fdAuthFadeIn{from{opacity:0;}to{opacity:1;}}
    .fd-auth-modal{background:linear-gradient(145deg,#0e0e0e,#060606);border:1px solid var(--border-bright);border-radius:22px;padding:28px;max-width:460px;width:100%;animation:fdAuthModalIn 0.35s cubic-bezier(0.22,1,0.36,1);position:relative;overflow:hidden;}
    .fd-auth-modal::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--red),var(--red-dark),var(--red));}
    @keyframes fdAuthModalIn{from{opacity:0;transform:scale(0.94) translateY(20px);}to{opacity:1;transform:scale(1) translateY(0);}}
    .fd-auth-modal-icon{width:56px;height:56px;border-radius:16px;background:rgba(225,6,0,0.12);border:1px solid rgba(225,6,0,0.3);display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:16px;}
    .fd-auth-modal h3{font-family:'Unbounded',sans-serif;font-size:19px;margin-bottom:8px;color:#fff;letter-spacing:-0.5px;}
    .fd-auth-modal p{color:var(--text-dim);font-size:13.5px;margin-bottom:20px;line-height:1.6;}
    .fd-auth-modal-input{width:100%;padding:14px 16px;background:var(--bg-elevated);border:1px solid var(--border-bright);border-radius:12px;color:var(--text);font-family:'Inter',sans-serif;font-size:14px;outline:none;margin-bottom:8px;transition:all 0.3s;}
    .fd-auth-modal-input:focus{border-color:var(--red);box-shadow:0 0 0 4px rgba(225,6,0,0.12);}
    .fd-auth-modal-input::placeholder{color:#555;}
    .fd-auth-modal-actions{display:flex;gap:10px;margin-top:22px;justify-content:flex-end;}
    .fd-auth-modal-actions button{padding:12px 22px;border-radius:12px;font-family:'Inter',sans-serif;font-weight:600;font-size:13.5px;cursor:pointer;border:1px solid transparent;transition:all 0.25s;display:inline-flex;align-items:center;gap:8px;}
    .fd-auth-btn-cancel{background:rgba(255,255,255,0.04);color:var(--text);border-color:var(--border-bright);}
    .fd-auth-btn-cancel:hover{border-color:var(--red);background:rgba(225,6,0,0.08);}
    .fd-auth-btn-confirm{background:linear-gradient(135deg,var(--red),var(--red-dark));color:#fff;box-shadow:0 8px 30px rgba(225,6,0,0.4);}
    .fd-auth-btn-confirm:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 12px 45px rgba(225,6,0,0.6);}
    .fd-auth-btn-confirm:disabled{opacity:0.4;cursor:not-allowed;}
    .fd-auth-btn-confirm.green{background:linear-gradient(135deg,#4ade80,#16a34a);box-shadow:0 8px 30px rgba(74,222,128,0.4);}
  `;
  document.head.appendChild(style);
}

function authModal({
  icon = 'ℹ️', title, desc, inputLabel, inputPlaceholder, inputType = 'text',
  confirmText = 'OK', confirmClass = '', showCancel = true, onConfirm
}) {
  ensureAuthModalStyles();
  const old = document.getElementById('fdAuthModalOverlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.className = 'fd-auth-modal-overlay';
  overlay.id = 'fdAuthModalOverlay';
  overlay.innerHTML = `
    <div class="fd-auth-modal">
      <div class="fd-auth-modal-icon">${icon}</div>
      <h3>${title}</h3>
      ${desc ? `<p>${desc}</p>` : ''}
      ${inputLabel !== undefined ? `<input type="${inputType}" class="fd-auth-modal-input" id="fdAuthModalInput" placeholder="${inputPlaceholder || ''}">` : ''}
      <div class="fd-auth-modal-actions">
        ${showCancel ? `<button class="fd-auth-btn-cancel" id="fdAuthModalCancel">Отмена</button>` : ''}
        <button class="fd-auth-btn-confirm ${confirmClass}" id="fdAuthModalConfirm">${confirmText}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  const close = () => {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 250);
  };

  if (showCancel) document.getElementById('fdAuthModalCancel').onclick = close;

  const confirmBtn = document.getElementById('fdAuthModalConfirm');
  confirmBtn.onclick = async () => {
    let value = null;
    if (inputLabel !== undefined) {
      const inp = document.getElementById('fdAuthModalInput');
      value = (inp?.value || '').trim();
      if (!value) { inp.focus(); return; }
    }
    confirmBtn.disabled = true;
    try { await onConfirm(value, close); }
    catch (e) { close(); }
  };

  if (inputLabel !== undefined) {
    setTimeout(() => {
      const inp = document.getElementById('fdAuthModalInput');
      if (inp) {
        inp.focus();
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') confirmBtn.click();
        });
      }
    }, 100);
  }
}

/* ============ CAPTURE TOKEN FROM URL ============ */
(function captureTokenFromURL() {
  const url = new URL(window.location.href);
  const t = url.searchParams.get('token');
  if (t) {
    setToken(t);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.pathname + url.search);
  }
})();

/* ============ INIT ============ */
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
    if (window.currentUser) {
      try {
        const br = await fetch(window.API + '/api/balance', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (br.ok) {
          const bd = await br.json();
          currentBalance = bd.balance || 0;
        }
      } catch {}
      renderUser(authWidget, window.currentUser);
    } else {
      setToken(null);
      renderGuest(authWidget);
    }
  } catch (e) {
    console.error('[auth]', e);
    renderGuest(authWidget);
  }
}

function renderGuest(authWidget) {
  authWidget.innerHTML = `
    <a class="auth-login" href="${window.API}/auth/steam">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0z"/></svg>
      Войти
    </a>
  `;
  window.currentUser = null;
  window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: null } }));
}

function renderUser(authWidget, user) {
  // Меню профиля теперь рисует my-profile.js
  // Здесь только сохраняем пользователя и триггерим событие
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

/* ============ ПРОМОКОД ============ */
window.openPromoActivate = function () {
  const block = document.getElementById('authUserBlock');
  if (block) block.classList.remove('open');

  authModal({
    icon: '🎟️',
    title: 'Активировать промокод',
    desc: 'Введите код промокода (регистр не важен, можно на русском)',
    inputLabel: 'Код промокода',
    inputPlaceholder: 'FERM100 или СКИДКА',
    confirmText: '✓ Активировать',
    confirmClass: 'green',
    onConfirm: async (code, close) => {
      try {
        const r = await fetch(window.API + '/api/promocodes/activate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + getToken()
          },
          body: JSON.stringify({ code }),
        });
        const data = await r.json();
        if (!r.ok) {
          const errors = {
            not_found: 'Промокод не найден',
            inactive: 'Промокод неактивен',
            already_used_by_you: 'Вы уже активировали',
            limit_reached: 'Лимит исчерпан',
            missing_code: 'Введите код'
          };
          close();
          authModal({
            icon: '❌',
            title: 'Ошибка',
            desc: errors[data.error] || data.error,
            confirmText: 'Понятно',
            showCancel: false
          });
          return;
        }
        close();
        currentBalance = data.newBalance;
        authModal({
          icon: '✅',
          title: 'Промокод активирован!',
          desc: `Начислено: ${data.amount}<br>Новый баланс: <b style="color:#fff;">${data.newBalance}</b>`,
          confirmText: 'Отлично',
          confirmClass: 'green',
          showCancel: false
        });
      } catch (e) {
        close();
        authModal({
          icon: '⚠️',
          title: 'Ошибка сети',
          desc: e.message,
          confirmText: 'ОК',
          showCancel: false
        });
      }
    }
  });
};