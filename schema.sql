-- Narumi D1 数据库表结构

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  github_id TEXT UNIQUE,
  avatar_url TEXT,
  auth_provider TEXT DEFAULT 'local',
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now'))
);

-- 追番列表
CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  anime_id INTEGER NOT NULL,
  anime_title TEXT NOT NULL,
  anime_image TEXT,
  status TEXT DEFAULT 'plan_to_watch',
  score INTEGER,
  episodes_watched INTEGER DEFAULT 0,
  total_episodes INTEGER,
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, anime_id)
);

-- 观看历史
CREATE TABLE IF NOT EXISTS watch_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  anime_id INTEGER NOT NULL,
  anime_title TEXT NOT NULL,
  anime_image TEXT,
  episode INTEGER DEFAULT 1,
  episode_title TEXT,
  progress INTEGER DEFAULT 0,
  watched_at DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist(user_id, status);
CREATE INDEX IF NOT EXISTS idx_history_user ON watch_history(user_id);
CREATE INDEX IF NOT EXISTS idx_history_anime ON watch_history(anime_id);
CREATE INDEX IF NOT EXISTS idx_users_github ON users(github_id);
