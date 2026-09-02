// Сервер приложения "Учёт товаров / склад"
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Секрет для JWT: хранится в файле, чтобы сессии не слетали после перезапуска
const SECRET_FILE = path.join(__dirname, 'data', 'secret.txt');
let JWT_SECRET;
if (fs.existsSync(SECRET_FILE)) {
  JWT_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
} else {
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, JWT_SECRET);
}

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Аутентификация ---
function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Требуется вход' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Сессия недействительна' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ только для администратора' });
  next();
}

// --- Вход / выход ---
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, full_name: user.full_name }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ id: user.id, username: user.username, role: user.role, full_name: user.full_name });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role, full_name: req.user.full_name });
});

app.post('/api/auth/password', auth, (req, res) => {
  const { old_password, new_password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(old_password || ''), user.password_hash)) {
    return res.status(400).json({ error: 'Старый пароль неверен' });
  }
  if (String(new_password || '').length < 4) return res.status(400).json({ error: 'Новый пароль слишком короткий' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(new_password), 10), req.user.id);
  res.json({ ok: true });
});

// --- Категории ---
app.get('/api/categories', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
});
app.post('/api/categories', auth, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Укажите название' });
  try {
    const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    res.json({ id: Number(info.lastInsertRowid), name });
  } catch {
    res.status(400).json({ error: 'Такая категория уже есть' });
  }
});
app.delete('/api/categories/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Товары ---
app.get('/api/products', auth, (req, res) => {
  const search = String(req.query.search || '').trim();
  let sql = `SELECT p.*, c.name AS category_name
             FROM products p LEFT JOIN categories c ON c.id = p.category_id`;
  const params = [];
  if (search) {
    sql += ' WHERE p.name LIKE ? OR p.sku LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY p.name';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/products/:id', auth, (req, res) => {
  const product = db.prepare(
    `SELECT p.*, c.name AS category_name FROM products p
     LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`
  ).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Товар не найден' });
  const history = db.prepare(
    `SELECT m.*, u.full_name AS user_name FROM movements m
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.product_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 100`
  ).all(req.params.id);
  res.json({ ...product, history });
});

app.post('/api/products', auth, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Укажите название товара' });
  const info = db.prepare(
    `INSERT INTO products (name, sku, category_id, unit, price, quantity, min_quantity, supplier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name,
    String(b.sku || '').trim(),
    b.category_id || null,
    String(b.unit || 'шт').trim(),
    Number(b.price) || 0,
    Number(b.quantity) || 0,
    Number(b.min_quantity) || 0,
    String(b.supplier || '').trim()
  );
  res.json({ id: Number(info.lastInsertRowid) });
});

app.put('/api/products/:id', auth, (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Товар не найден' });
  db.prepare(
    `UPDATE products SET name = ?, sku = ?, category_id = ?, unit = ?, price = ?,
       min_quantity = ?, supplier = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    String(b.name || '').trim(),
    String(b.sku || '').trim(),
    b.category_id || null,
    String(b.unit || 'шт').trim(),
    Number(b.price) || 0,
    Number(b.min_quantity) || 0,
    String(b.supplier || '').trim(),
    req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/products/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Движения (приход / расход) ---
// Ручная транзакция: остаток товара и запись операции меняются строго вместе
function applyMovement(productId, type, quantity, price, comment, userId) {
  db.exec('BEGIN');
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) throw new Error('Товар не найден');
    const delta = type === 'in' ? quantity : -quantity;
    const newQty = product.quantity + delta;
    if (newQty < 0) throw new Error('Недостаточно товара на складе');
    db.prepare(`UPDATE products SET quantity = ?, updated_at = datetime('now') WHERE id = ?`).run(newQty, productId);
    db.prepare(
      `INSERT INTO movements (product_id, type, quantity, price, comment, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(productId, type, quantity, price, comment, userId);
    db.exec('COMMIT');
    return newQty;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

app.post('/api/movements', auth, (req, res) => {
  const b = req.body || {};
  const type = b.type === 'in' ? 'in' : b.type === 'out' ? 'out' : null;
  const quantity = Number(b.quantity);
  if (!type) return res.status(400).json({ error: 'Тип должен быть приход или расход' });
  if (!(quantity > 0)) return res.status(400).json({ error: 'Количество должно быть больше нуля' });
  try {
    const newQty = applyMovement(
      Number(b.product_id), type, quantity, Number(b.price) || 0,
      String(b.comment || '').trim(), req.user.id
    );
    res.json({ ok: true, quantity: newQty });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/movements', auth, (req, res) => {
  res.json(db.prepare(
    `SELECT m.*, p.name AS product_name, p.unit, u.full_name AS user_name
     FROM movements m
     LEFT JOIN products p ON p.id = m.product_id
     LEFT JOIN users u ON u.id = m.user_id
     ORDER BY m.created_at DESC, m.id DESC LIMIT 200`
  ).all());
});

// --- Статистика для главной ---
app.get('/api/stats', auth, (req, res) => {
  const totals = db.prepare(
    `SELECT COUNT(*) AS products,
            COALESCE(SUM(quantity), 0) AS total_qty,
            COALESCE(SUM(quantity * price), 0) AS total_value
     FROM products`
  ).get();
  const lowStock = db.prepare(
    `SELECT id, name, quantity, min_quantity, unit FROM products
     WHERE min_quantity > 0 AND quantity <= min_quantity ORDER BY quantity`
  ).all();
  res.json({ ...totals, low_stock: lowStock });
});

// --- Пользователи (только администратор) ---
app.get('/api/users', auth, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT id, username, full_name, role, created_at FROM users ORDER BY id').all());
});
app.post('/api/users', auth, adminOnly, (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  if (!username || password.length < 4) return res.status(400).json({ error: 'Укажите логин и пароль (от 4 символов)' });
  try {
    const info = db.prepare(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)`
    ).run(username, bcrypt.hashSync(password, 10), String(b.full_name || '').trim(), b.role === 'admin' ? 'admin' : 'employee');
    res.json({ id: Number(info.lastInsertRowid) });
  } catch {
    res.status(400).json({ error: 'Такой логин уже занят' });
  }
});
app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
