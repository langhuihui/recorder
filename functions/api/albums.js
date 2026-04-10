// GET /api/albums - 获取专辑列表
// POST /api/albums - 创建新专辑

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

// 获取专辑列表
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const offset = (page - 1) * limit;

  try {
    const countResult = await env.ASC_DB.prepare('SELECT COUNT(*) as total FROM albums').first();
    const albums = await env.ASC_DB.prepare(
      'SELECT * FROM albums ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(limit, offset).all();

    const baseUrl = url.origin;

    // 为每个专辑附加歌曲数量和封面信息
    const albumList = await Promise.all(albums.results.map(async (album) => {
      const songCount = await env.ASC_DB.prepare(
        'SELECT COUNT(*) as count FROM album_songs WHERE album_id = ?'
      ).bind(album.id).first();

      // 获取专辑内前 4 首歌的封面（用于网格预览）
      const previewSongs = await env.ASC_DB.prepare(
        `SELECT s.id, s.title, s.artist, si.file_key
         FROM album_songs as2
         JOIN songs s ON s.id = as2.song_id
         LEFT JOIN sheet_images si ON si.song_id = s.id AND si.sort_order = 0
         WHERE as2.album_id = ?
         ORDER BY as2.sort_order
         LIMIT 4`
      ).bind(album.id).all();

      return {
        ...album,
        cover_url: album.cover_file_key ? `${baseUrl}/api/files/${album.cover_file_key}` : '',
        song_count: songCount.count,
        preview_covers: previewSongs.results.map(ps => ({
          song_id: ps.id,
          title: ps.title,
          cover_url: ps.file_key ? `${baseUrl}/api/files/${ps.file_key}` : '',
        })),
      };
    }));

    return json({
      data: albumList,
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

// 创建新专辑
export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const body = await request.json();
    const { title, description } = body;

    if (!title) {
      return json({ error: '专辑标题不能为空' }, 400);
    }

    const id = generateId();
    await env.ASC_DB.prepare(
      'INSERT INTO albums (id, title, description) VALUES (?, ?, ?)'
    ).bind(id, title, description || '').run();

    const album = await env.ASC_DB.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first();
    return json({ data: album }, 201);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
