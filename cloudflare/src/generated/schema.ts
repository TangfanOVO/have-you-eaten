// 自动生成，别手改：node scripts/sync-assets.mjs 从 schema.sql 拆出来的。
export const SCHEMA_STATEMENTS: string[] = [
  "CREATE TABLE IF NOT EXISTS shop (\n  id INTEGER PRIMARY KEY, name TEXT NOT NULL, cuisine TEXT, note TEXT,\n  verdict TEXT CHECK (verdict IN ('good','meh','bad')),\n  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE UNIQUE INDEX IF NOT EXISTS shop_name_uq ON shop (lower(trim(name)))",
  "CREATE TABLE IF NOT EXISTS branch (\n  id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shop(id) ON DELETE CASCADE,\n  city TEXT NOT NULL, area TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '',\n  address TEXT, platform TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE UNIQUE INDEX IF NOT EXISTS branch_uq ON branch (shop_id, lower(trim(city)), lower(trim(area)), lower(trim(label)))",
  "CREATE TABLE IF NOT EXISTS meal (\n  id INTEGER PRIMARY KEY, branch_id INTEGER REFERENCES branch(id) ON DELETE CASCADE,\n  eaten_on TEXT NOT NULL, slot TEXT CHECK (slot IN ('早饭','午饭','晚饭','夜宵','加餐','纯记录')),\n  place TEXT, city TEXT, photo TEXT, src TEXT NOT NULL DEFAULT 'page' CHECK (src IN ('page','chat')),\n  how TEXT CHECK (how IN ('外卖','堂食','自取','自己做')), total REAL, currency TEXT NOT NULL DEFAULT 'CNY',\n  verdict TEXT CHECK (verdict IN ('good','meh','bad')), note TEXT,\n  created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE INDEX IF NOT EXISTS meal_day ON meal (eaten_on DESC, id DESC)",
  "CREATE TABLE IF NOT EXISTS dish (\n  id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shop(id) ON DELETE CASCADE,\n  name TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE UNIQUE INDEX IF NOT EXISTS dish_uq ON dish (shop_id, lower(trim(name)))",
  "CREATE TABLE IF NOT EXISTS dish_log (\n  id INTEGER PRIMARY KEY, meal_id INTEGER NOT NULL REFERENCES meal(id) ON DELETE CASCADE,\n  dish_id INTEGER REFERENCES dish(id) ON DELETE CASCADE, name TEXT,\n  verdict TEXT CHECK (verdict IN ('good','meh','bad')), price REAL, note TEXT,\n  created_at TEXT NOT NULL DEFAULT (datetime('now')),\n  CHECK (dish_id IS NOT NULL OR (name IS NOT NULL AND trim(name) <> '')))",
  "CREATE TABLE IF NOT EXISTS taste (\n  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('love','hate','never')),\n  item TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', away INTEGER NOT NULL DEFAULT 0,\n  note TEXT, src TEXT NOT NULL DEFAULT 'page' CHECK (src IN ('page','chat')),\n  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS setting (k TEXT PRIMARY KEY, v TEXT)",
  "CREATE UNIQUE INDEX IF NOT EXISTS taste_uq2 ON taste (lower(trim(item)), lower(trim(scope)))"
];
