-- 给 audio_tracks 增加 part_label 字段（声部中文名，如：女高、女低、男高、男低）
ALTER TABLE audio_tracks ADD COLUMN part_label TEXT DEFAULT '';
