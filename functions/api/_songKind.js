// Helpers for songs.song_kind (migration 0006). D1 uses "has no column named …";
// some SQLite paths use "no such column".

export function isMissingSongKindColumnError(e) {
  const msg = String(e?.message || e || '');
  if (!msg.includes('song_kind')) return false;
  return (
    msg.includes('no such column') ||
    msg.includes('has no column')
  );
}

/** When song_kind is absent (pre-0006 DB), infer from album_songs membership */
export async function effectiveSongKind(env, song) {
  if (song == null) return null;
  if (song.song_kind != null && song.song_kind !== '') return song.song_kind;
  const inAlbum = await env.ASC_DB.prepare(
    'SELECT 1 FROM album_songs WHERE song_id = ? LIMIT 1'
  )
    .bind(song.id)
    .first();
  return inAlbum ? 'album' : 'practice';
}

/** Pre-0006: approximate song_kind via album_songs */
export async function fetchSongsByKindLegacy(env, kindFilter, limit, offset) {
  const inAlbum = 'id IN (SELECT song_id FROM album_songs)';
  const notInAlbum = 'id NOT IN (SELECT song_id FROM album_songs)';
  const where = kindFilter === 'album' ? inAlbum : notInAlbum;
  const countResult = await env.ASC_DB.prepare(
    `SELECT COUNT(*) as total FROM songs WHERE ${where}`
  ).first();
  const songs = await env.ASC_DB.prepare(
    `SELECT * FROM songs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all();
  return { countResult, songs };
}
