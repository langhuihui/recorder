-- 歌曲元数据表
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT DEFAULT '',
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 歌谱图片表（一首歌可以有多张图片）
CREATE TABLE IF NOT EXISTS sheet_images (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  file_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

-- 音频文件表（伴奏/范唱，每种最多4个声部）
CREATE TABLE IF NOT EXISTS audio_tracks (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  track_type TEXT NOT NULL CHECK(track_type IN ('accompaniment', 'vocal')),
  part_name TEXT NOT NULL DEFAULT 'default',
  file_key TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  duration REAL DEFAULT 0,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);
