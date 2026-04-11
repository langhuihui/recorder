-- 确保 audio_tracks 存在 part_label（声部中文名）。
-- 使用表重建而非 ALTER ADD COLUMN：列已存在时 ADD 会报 duplicate column（例如上次 DDL 已成功但迁移未标记完成）。
-- 复制时显式选取前 7 列 + 默认 ''；若源表末尾已有 part_label 且含数据，该次迁移会用空串覆盖（极少见，因 duplicate 场景下列多为新建）。

PRAGMA foreign_keys=OFF;

CREATE TABLE audio_tracks__mig_0005 (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  track_type TEXT NOT NULL CHECK(track_type IN ('accompaniment', 'vocal')),
  part_name TEXT NOT NULL DEFAULT 'default',
  file_key TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  duration REAL DEFAULT 0,
  part_label TEXT DEFAULT '',
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

INSERT INTO audio_tracks__mig_0005 (id, song_id, track_type, part_name, file_key, file_size, duration, part_label)
SELECT id, song_id, track_type, part_name, file_key, file_size, duration, '' FROM audio_tracks;

DROP TABLE audio_tracks;

ALTER TABLE audio_tracks__mig_0005 RENAME TO audio_tracks;

PRAGMA foreign_keys=ON;
