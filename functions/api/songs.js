// GET /api/songs - 获取歌曲列表
// POST /api/songs - 创建新歌曲

function generateId() {
  return crypto.randomUUID();
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function isMissingSongKindColumnError(e) {
  const msg = String(e?.message || e || '');
  return msg.includes('no such column') && msg.includes('song_kind');
}

/** 未执行 0006 迁移时：用 album_songs 成员关系近似 song_kind */
async function fetchSongsByKindLegacy(env, kindFilter, limit, offset) {
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

// 获取歌曲列表
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const offset = (page - 1) * limit;

  try {
    const songKind = url.searchParams.get('song_kind');
    const kindFilter =
      songKind === 'album' || songKind === 'practice' ? songKind : null;

    let countSql = 'SELECT COUNT(*) as total FROM songs';
    let listSql = 'SELECT * FROM songs';
    const kindBindings = [];
    if (kindFilter) {
      countSql += ' WHERE song_kind = ?';
      listSql += ' WHERE song_kind = ?';
      kindBindings.push(kindFilter);
    }
    listSql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

    let countResult;
    let songs;
    try {
      countResult = await env.ASC_DB.prepare(countSql)
        .bind(...kindBindings)
        .first();
      songs = await env.ASC_DB.prepare(listSql)
        .bind(...kindBindings, limit, offset)
        .all();
    } catch (e) {
      if (kindFilter && isMissingSongKindColumnError(e)) {
        ({ countResult, songs } = await fetchSongsByKindLegacy(
          env,
          kindFilter,
          limit,
          offset
        ));
      } else {
        throw e;
      }
    }

    // 为每首歌附加歌谱和音频信息
    const songList = await Promise.all(songs.results.map(async (song) => {
      const sheets = await env.ASC_DB.prepare(
        'SELECT * FROM sheet_images WHERE song_id = ? ORDER BY sort_order'
      ).bind(song.id).all();

      const tracks = await env.ASC_DB.prepare(
        'SELECT * FROM audio_tracks WHERE song_id = ?'
      ).bind(song.id).all();

      // 生成文件访问 URL
      const baseUrl = url.origin;
      return {
        ...song,
        sheets: sheets.results.map(s => ({
          ...s,
          url: `${baseUrl}/api/files/${s.file_key}`,
        })),
        tracks: tracks.results.map(t => ({
          ...t,
          url: `${baseUrl}/api/files/${t.file_key}`,
        })),
      };
    }));

    return json({
      data: songList,
      pagination: {
        page,
        limit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit),
      },
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// 创建新歌曲
export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const body = await request.json();
    const { title, artist, description, song_kind: rawKind, album_id: albumId } = body;

    if (!title) {
      return json({ error: '歌曲标题不能为空' }, 400);
    }

    const songKind = rawKind === 'album' ? 'album' : 'practice';
    if (songKind === 'album') {
      if (!albumId) {
        return json({ error: '专辑歌曲必须指定所属专辑' }, 400);
      }
      const album = await env.ASC_DB.prepare('SELECT id FROM albums WHERE id = ?').bind(albumId).first();
      if (!album) {
        return json({ error: '专辑不存在' }, 404);
      }
    }

    const id = generateId();
    try {
      await env.ASC_DB.prepare(
        'INSERT INTO songs (id, title, artist, description, song_kind) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(id, title, artist || '', description || '', songKind)
        .run();
    } catch (e) {
      if (!isMissingSongKindColumnError(e)) throw e;
      await env.ASC_DB.prepare(
        'INSERT INTO songs (id, title, artist, description) VALUES (?, ?, ?, ?)'
      )
        .bind(id, title, artist || '', description || '')
        .run();
    }

    if (songKind === 'album' && albumId) {
      const maxOrder = await env.ASC_DB.prepare(
        'SELECT MAX(sort_order) as max_order FROM album_songs WHERE album_id = ?'
      ).bind(albumId).first();
      const sortOrder = (maxOrder?.max_order ?? -1) + 1;
      await env.ASC_DB.prepare(
        'INSERT INTO album_songs (album_id, song_id, sort_order) VALUES (?, ?, ?)'
      ).bind(albumId, id, sortOrder).run();
    }

    let song = await env.ASC_DB.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first();
    if (song && song.song_kind == null) {
      song = { ...song, song_kind: songKind };
    }
    return json({ data: song }, 201);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
