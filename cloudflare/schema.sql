-- 吃了吗 · have-you-eaten —— D1 的表。
-- 跟上一层 core.py 里的 SCHEMA 一字不差（只去掉了 PRAGMA foreign_keys：D1 默认就开着外键），
-- 再加上 core.Book() 起来时建的 taste_uq2。改表先改 core.py，再照抄过来，跑 npm run conformance 对一遍。
--
-- 用法（可选：Worker 第一次被访问时也会自己建表，这一步不做也行）：
--   npx wrangler d1 execute have-you-eaten --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS shop (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, cuisine TEXT, note TEXT,
  verdict TEXT CHECK (verdict IN ('good','meh','bad')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX IF NOT EXISTS shop_name_uq ON shop (lower(trim(name)));
CREATE TABLE IF NOT EXISTS branch (
  id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  city TEXT NOT NULL, area TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '',
  address TEXT, platform TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX IF NOT EXISTS branch_uq ON branch (shop_id, lower(trim(city)), lower(trim(area)), lower(trim(label)));
CREATE TABLE IF NOT EXISTS meal (
  id INTEGER PRIMARY KEY, branch_id INTEGER REFERENCES branch(id) ON DELETE CASCADE,
  eaten_on TEXT NOT NULL, slot TEXT CHECK (slot IN ('早饭','午饭','晚饭','夜宵','加餐','纯记录')),
  place TEXT, city TEXT, photo TEXT, src TEXT NOT NULL DEFAULT 'page' CHECK (src IN ('page','chat')),
  how TEXT CHECK (how IN ('外卖','堂食','自取','自己做')), total REAL, currency TEXT NOT NULL DEFAULT 'CNY',
  verdict TEXT CHECK (verdict IN ('good','meh','bad')), note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS meal_day ON meal (eaten_on DESC, id DESC);
CREATE TABLE IF NOT EXISTS dish (
  id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  name TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX IF NOT EXISTS dish_uq ON dish (shop_id, lower(trim(name)));
CREATE TABLE IF NOT EXISTS dish_log (
  id INTEGER PRIMARY KEY, meal_id INTEGER NOT NULL REFERENCES meal(id) ON DELETE CASCADE,
  dish_id INTEGER REFERENCES dish(id) ON DELETE CASCADE, name TEXT,
  verdict TEXT CHECK (verdict IN ('good','meh','bad')), price REAL, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (dish_id IS NOT NULL OR (name IS NOT NULL AND trim(name) <> '')));
CREATE TABLE IF NOT EXISTS taste (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('love','hate','never')),
  item TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', away INTEGER NOT NULL DEFAULT 0,
  note TEXT, src TEXT NOT NULL DEFAULT 'page' CHECK (src IN ('page','chat')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS setting (k TEXT PRIMARY KEY, v TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS taste_uq2 ON taste (lower(trim(item)), lower(trim(scope)));
