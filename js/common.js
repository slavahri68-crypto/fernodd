/* ================================================================
   FERNODD — COMMON UTILITIES
   ================================================================
   Общие функции, используемые на всех страницах:
   - генерация частиц на фоне
   - утилита escapeHtml
   - прочие хелперы
   ================================================================ */

/* ============ ЧАСТИЦЫ НА ФОНЕ ============ */
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
      const (2 + Math.random() * 3).toFixed(1) + 'px';
      p.style.width = size;
      p.style.height = size;
      container.appendChild(p);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', create);
  } else {
    create();
  }
})();

/* ============ ЭКРАНИРОВАНИЕ HTML ============ */
window.escapeHtml = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

/* ============ ТОСТ-УВЕДОМЛЕНИЯ ============ */
window.showToast = function (text, type = 'info', ms = 3000) {
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
    '<span class="toast-msg">' + window.escapeHtml(text) + '</span>';
  wrap.appendChild(el);
  setTimeout(function () {
    el.classList.add('fade');
    setTimeout(function () { el.remove(); }, 300);
  }, ms);
};

/* ============ ФОРМАТ ДАТЫ ============ */
window.formatDate = function (date) {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleString('ru-RU');
  } catch {
    return String(date);
  }
};

/* ============ ПРОСТОЙ API-ХЕЛПЕР ============ */
window.apiFetch = async function (path, options) {
  options = options || {};
  const base = window.API_BASE || '';
  const token = localStorage.getItem('fernodd_token') || '';

  const headers = Object.assign(
    {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
    },
    options.headers || {}
  );

  const res = await fetch(base + path, Object.assign({}, options, { headers }));

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }

  if (!res.ok) {
    throw new Error((data.error || 'error') + ' — ' + (data.details || ''));
  }
  return data;
};

console.log('[common] загружен');
