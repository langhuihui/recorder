-- 练唱文件表
CREATE TABLE IF NOT EXISTS practice_files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('sheet','audio','video','doc','other')),
  file_key TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
