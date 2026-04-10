-- 区分专辑欣赏歌曲与练唱歌曲；练唱附件归属某首练唱歌曲
ALTER TABLE songs ADD COLUMN song_kind TEXT NOT NULL DEFAULT 'practice';

UPDATE songs SET song_kind = 'album' WHERE id IN (SELECT song_id FROM album_songs);

ALTER TABLE practice_files ADD COLUMN song_id TEXT;

CREATE INDEX IF NOT EXISTS idx_practice_files_song_id ON practice_files(song_id);
