// База данных SQLite — все данные хранятся в файле data/sklad.db
// Используется встроенный в Node.js модуль node:sqlite (без внешних зависимостей)
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'sklad.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// --- Схема ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'employee', -- admin | employee
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS products (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    sku          TEXT DEFAULT '',                 -- артикул
    category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    unit         TEXT NOT NULL DEFAULT 'шт',       -- шт, кг, л, ...
    price        REAL NOT NULL DEFAULT 0,          -- цена за единицу
    quantity     REAL NOT NULL DEFAULT 0,          -- текущий остаток
    min_quantity REAL NOT NULL DEFAULT 0,          -- мин. остаток (для предупреждения)
    supplier     TEXT DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS movements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,                      -- in (приход) | out (расход)
    quantity   REAL NOT NULL,
    price      REAL NOT NULL DEFAULT 0,
    comment    TEXT DEFAULT '',
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_movements_product ON movements(product_id);
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
`);

// --- Стартовый администратор (создаётся один раз) ---
function seedAdmin() {
  const exists = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (exists.c === 0) {
    const hash = bcrypt.hashSync('admin', 10);
    db.prepare(
      `INSERT INTO users (username, password_hash, full_name, role)
       VALUES (?, ?, ?, 'admin')`
    ).run('admin', hash, 'Администратор');
    console.log('Создан пользователь по умолчанию: логин "admin", пароль "admin"');
    console.log('ОБЯЗАТЕЛЬНО смените пароль после первого входа!');
  }
}
seedAdmin();

module.exports = db;
