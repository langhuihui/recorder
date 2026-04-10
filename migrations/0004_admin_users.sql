-- 管理员用户表
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 会话表
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- 初始账号 admin / adminasc
-- 密码使用 SHA-256 哈希存储
INSERT OR IGNORE INTO admin_users (id, username, password_hash)
VALUES ('admin-001', 'admin', 'c1074bc3e31dd2a71873cb31e5aab94fcf2a219a0821943636d479fefed341de');
