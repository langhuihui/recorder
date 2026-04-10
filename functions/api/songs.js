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

// 获取歌曲列表
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const offset = (page - 1) * limit;

  try {
    const countResult = await env.ASC_DB.prepare('SELECT COUNT(*) as total FROM songs').first();
    const songs = await env.ASC_DB.prepare(
      'SELECT * FROM songs ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(limit, offset).all();

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
    const { title, artist, description } = body;

    if (!title) {
      return json({ error: '歌曲标题不能为空' }, 400);
    }

    const id = generateId();
    await env.ASC_DB.prepare(
      'INSERT INTO songs (id, title, artist, description) VALUES (?, ?, ?, ?)'
    ).bind(id, title, artist || '', description || '').run();

    const song = await env.ASC_DB.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first();
    return json({ data: song }, 201);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
