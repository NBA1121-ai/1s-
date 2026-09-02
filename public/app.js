// --- Вспомогательные функции для запросов к API ---
async function api(url, method = 'GET', body) {
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}
const $ = (id) => document.getElementById(id);
const money = (n) => (Number(n) || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let currentUser = null;
let categories = [];

// --- Вход ---
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    currentUser = await api('/api/auth/login', 'POST', {
      username: $('login-username').value,
      password: $('login-password').value,
    });
    showApp();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', 'POST');
  location.reload();
});

function showApp() {
  $('login-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('user-name').textContent = currentUser.full_name || currentUser.username;
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.style.display = currentUser.role === 'admin' ? '' : 'none';
  });
  loadCategories();
  loadDashboard();
}

// --- Переключение вкладок ---
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.tab;
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.add('hidden'));
    $('tab-' + name).classList.remove('hidden');
    if (name === 'dashboard') loadDashboard();
    if (name === 'products') loadProducts();
    if (name === 'movements') loadMovements();
    if (name === 'users') loadUsers();
  });
});

// --- Обзор ---
async function loadDashboard() {
  const s = await api('/api/stats');
  $('stat-products').textContent = s.products;
  $('stat-qty').textContent = money(s.total_qty);
  $('stat-value').textContent = money(s.total_value);
  const box = $('low-stock');
  if (!s.low_stock.length) {
    box.innerHTML = '<div class="empty">Всё в порядке — запасов достаточно</div>';
    return;
  }
  box.innerHTML = s.low_stock.map((p) => `
    <div class="item">
      <div class="item-main"><div class="item-title">${esc(p.name)}</div>
        <div class="item-sub">Минимум: ${money(p.min_quantity)} ${esc(p.unit)}</div></div>
      <div class="item-qty"><div class="qty-value qty-low">${money(p.quantity)}</div>
        <div class="item-sub">${esc(p.unit)}</div></div>
    </div>`).join('');
}

// --- Категории ---
async function loadCategories() {
  categories = await api('/api/categories');
}

// --- Товары ---
async function loadProducts() {
  const search = $('product-search').value.trim();
  const url = '/api/products' + (search ? '?search=' + encodeURIComponent(search) : '');
  const products = await api(url);
  const box = $('products-list');
  if (!products.length) {
    box.innerHTML = '<div class="empty">Товаров пока нет. Нажмите «+ Товар».</div>';
    return;
  }
  box.innerHTML = products.map((p) => {
    const low = p.min_quantity > 0 && p.quantity <= p.min_quantity;
    return `
    <div class="item" onclick="openProduct(${p.id})">
      <div class="item-main">
        <div class="item-title">${esc(p.name)}</div>
        <div class="item-sub">${p.sku ? 'Арт. ' + esc(p.sku) + ' · ' : ''}${esc(p.category_name || 'Без категории')} · ${money(p.price)} ₸</div>
      </div>
      <div class="item-qty">
        <div class="qty-value ${low ? 'qty-low' : ''}">${money(p.quantity)}</div>
        <div class="item-sub">${esc(p.unit)}</div>
      </div>
    </div>`;
  }).join('');
}
let searchTimer;
$('product-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadProducts, 300);
});
$('add-product-btn').addEventListener('click', () => openProductForm());

// Форма добавления/редактирования товара
function openProductForm(p) {
  const isEdit = !!p;
  p = p || {};
  const catOptions = ['<option value="">Без категории</option>']
    .concat(categories.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`))
    .join('');
  setModal(isEdit ? 'Редактировать товар' : 'Новый товар', `
    <div class="field"><label>Название *</label><input id="f-name" value="${esc(p.name || '')}"></div>
    <div class="row">
      <div class="field"><label>Артикул</label><input id="f-sku" value="${esc(p.sku || '')}"></div>
      <div class="field"><label>Ед. изм.</label><input id="f-unit" value="${esc(p.unit || 'шт')}"></div>
    </div>
    <div class="field"><label>Категория</label><select id="f-cat">${catOptions}</select></div>
    <div class="row">
      <div class="field"><label>Цена (₸)</label><input id="f-price" type="number" step="0.01" value="${p.price || 0}"></div>
      <div class="field"><label>Мин. остаток</label><input id="f-min" type="number" step="0.01" value="${p.min_quantity || 0}"></div>
    </div>
    ${isEdit ? '' : '<div class="field"><label>Начальный остаток</label><input id="f-qty" type="number" step="0.01" value="0"></div>'}
    <div class="field"><label>Поставщик</label><input id="f-supplier" value="${esc(p.supplier || '')}"></div>
    <div class="error" id="f-error"></div>
    <div class="btn-group">
      <button class="btn-save" onclick="saveProduct(${isEdit ? p.id : 'null'})">Сохранить</button>
      <button class="btn-secondary" onclick="closeModal()">Отмена</button>
    </div>
  `);
}

async function saveProduct(id) {
  const body = {
    name: $('f-name').value, sku: $('f-sku').value, unit: $('f-unit').value,
    category_id: $('f-cat').value || null, price: $('f-price').value,
    min_quantity: $('f-min').value, supplier: $('f-supplier').value,
  };
  if ($('f-qty')) body.quantity = $('f-qty').value;
  try {
    if (id) await api('/api/products/' + id, 'PUT', body);
    else await api('/api/products', 'POST', body);
    closeModal();
    loadProducts();
  } catch (err) { $('f-error').textContent = err.message; }
}

// Карточка товара: движения + история
async function openProduct(id) {
  const p = await api('/api/products/' + id);
  const historyHtml = p.history.length ? p.history.map((h) => `
    <div class="history-item">
      <span class="badge ${h.type === 'in' ? 'badge-in' : 'badge-out'}">${h.type === 'in' ? 'Приход' : 'Расход'}</span>
      ${money(h.quantity)} ${esc(p.unit)}
      <span class="muted">· ${esc((h.created_at || '').replace('T', ' '))} · ${esc(h.user_name || '—')}</span>
      ${h.comment ? '<div class="muted">' + esc(h.comment) + '</div>' : ''}
    </div>`).join('') : '<div class="muted">Операций пока нет</div>';

  setModal(esc(p.name), `
    <div class="item-qty" style="text-align:left;margin-bottom:16px">
      Остаток: <span class="qty-value">${money(p.quantity)}</span> ${esc(p.unit)} · ${money(p.price)} ₸
    </div>
    <div class="field"><label>Количество</label><input id="m-qty" type="number" step="0.01" placeholder="0"></div>
    <div class="field"><label>Комментарий</label><input id="m-comment" placeholder="Необязательно"></div>
    <div class="error" id="m-error"></div>
    <div class="btn-group">
      <button class="btn-in" onclick="doMovement(${p.id}, 'in')">+ Приход</button>
      <button class="btn-out" onclick="doMovement(${p.id}, 'out')">− Расход</button>
    </div>
    <div class="btn-group">
      <button class="btn-secondary" onclick='openProductForm(${JSON.stringify(p).replace(/'/g, "&#39;")})'>Изменить</button>
      ${currentUser.role === 'admin' ? `<button class="btn-danger" onclick="deleteProduct(${p.id})">Удалить</button>` : ''}
    </div>
    <h3 style="margin-top:20px">История</h3>
    ${historyHtml}
  `);
}

async function doMovement(productId, type) {
  const qty = $('m-qty').value;
  try {
    await api('/api/movements', 'POST', { product_id: productId, type, quantity: qty, comment: $('m-comment').value });
    closeModal();
    loadProducts();
    loadDashboard();
  } catch (err) { $('m-error').textContent = err.message; }
}

async function deleteProduct(id) {
  if (!confirm('Удалить товар вместе со всей историей?')) return;
  await api('/api/products/' + id, 'DELETE');
  closeModal();
  loadProducts();
}

// --- Движения ---
async function loadMovements() {
  const list = await api('/api/movements');
  const box = $('movements-list');
  if (!list.length) { box.innerHTML = '<div class="empty">Операций пока нет</div>'; return; }
  box.innerHTML = list.map((m) => `
    <div class="item">
      <div class="item-main">
        <div class="item-title">${esc(m.product_name || 'Удалённый товар')}</div>
        <div class="item-sub">${esc((m.created_at || '').replace('T', ' '))} · ${esc(m.user_name || '—')}${m.comment ? ' · ' + esc(m.comment) : ''}</div>
      </div>
      <div class="item-qty">
        <span class="badge ${m.type === 'in' ? 'badge-in' : 'badge-out'}">${m.type === 'in' ? '+' : '−'}${money(m.quantity)}</span>
        <div class="item-sub">${esc(m.unit || '')}</div>
      </div>
    </div>`).join('');
}

// --- Пользователи ---
async function loadUsers() {
  const users = await api('/api/users');
  $('users-list').innerHTML = users.map((u) => `
    <div class="item">
      <div class="item-main">
        <div class="item-title">${esc(u.full_name || u.username)}</div>
        <div class="item-sub">${esc(u.username)}</div>
      </div>
      <div class="item-qty">
        <span class="badge badge-role">${u.role === 'admin' ? 'Админ' : 'Сотрудник'}</span>
        ${u.id !== currentUser.id ? `<button class="link-btn" style="color:var(--danger)" onclick="deleteUser(${u.id})">Удалить</button>` : ''}
      </div>
    </div>`).join('');
}
$('add-user-btn').addEventListener('click', () => {
  setModal('Новый пользователь', `
    <div class="field"><label>Имя</label><input id="u-name" placeholder="Иван Иванов"></div>
    <div class="field"><label>Логин *</label><input id="u-username"></div>
    <div class="field"><label>Пароль *</label><input id="u-password" type="text"></div>
    <div class="field"><label>Роль</label><select id="u-role">
      <option value="employee">Сотрудник</option><option value="admin">Администратор</option>
    </select></div>
    <div class="error" id="u-error"></div>
    <div class="btn-group">
      <button class="btn-save" onclick="saveUser()">Создать</button>
      <button class="btn-secondary" onclick="closeModal()">Отмена</button>
    </div>`);
});
async function saveUser() {
  try {
    await api('/api/users', 'POST', {
      full_name: $('u-name').value, username: $('u-username').value,
      password: $('u-password').value, role: $('u-role').value,
    });
    closeModal();
    loadUsers();
  } catch (err) { $('u-error').textContent = err.message; }
}
async function deleteUser(id) {
  if (!confirm('Удалить пользователя?')) return;
  await api('/api/users/' + id, 'DELETE');
  loadUsers();
}
$('change-pass-btn').addEventListener('click', () => {
  setModal('Смена пароля', `
    <div class="field"><label>Старый пароль</label><input id="p-old" type="password"></div>
    <div class="field"><label>Новый пароль</label><input id="p-new" type="password"></div>
    <div class="error" id="p-error"></div>
    <div class="btn-group">
      <button class="btn-save" onclick="savePassword()">Сохранить</button>
      <button class="btn-secondary" onclick="closeModal()">Отмена</button>
    </div>`);
});
async function savePassword() {
  try {
    await api('/api/auth/password', 'POST', { old_password: $('p-old').value, new_password: $('p-new').value });
    closeModal();
    alert('Пароль изменён');
  } catch (err) { $('p-error').textContent = err.message; }
}

// --- Модальное окно ---
function setModal(title, html) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = html;
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

// --- Автовход, если сессия ещё жива ---
(async () => {
  try {
    currentUser = await api('/api/auth/me');
    showApp();
  } catch { /* не залогинен — показываем экран входа */ }
})();
