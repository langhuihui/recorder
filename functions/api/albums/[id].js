// GET /api/albums/:id - 获取专辑详情
// PUT /api/albums/:id - 更新专辑信息
// DELETE /api/albums/:id - 删除专辑

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

// 获取专辑详情（含歌曲列表）
export async function onRequestGet(context) {
  const { env, params, request } = context;
  const { id } = params;
  const url = new URL(request.url);
  const baseUrl = url.origin;

  try {
    const album = await env.DB.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first();
    if (!album) {
      return json({ error: '专辑不存在' }, 404);
    }

    // 获取专辑内所有歌曲（含歌谱和音轨信息）
    const albumSongs = await env.DB.prepare(
      `SELECT s.*, as2.sort_order as album_sort_order
       FROM album_songs as2
       JOIN songs s ON s.id = as2.song_id
       WHERE as2.album_id = ?
       ORDER BY as2.sort_order`
    ).bind(id).all();

    const songs = await Promise.all(albumSongs.results.map(async (song) => {
      const sheets = await env.DB.prepare(
        'SELECT * FROM sheet_images WHERE song_id = ? ORDER BY sort_order'
      ).bind(song.id).all();

      const tracks = await env.DB.prepare(
        'SELECT * FROM audio_tracks WHERE song_id = ?'
      ).bind(song.id).all();

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
      data: {
        ...album,
        cover_url: album.cover_file_key ? `${baseUrl}/api/files/${album.cover_file_key}` : '',
        songs,
      },
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// 更新专辑信息
export async function onRequestPut(context) {
  const { env, params, request } = context;
  const { id } = params;

  try {
    const album = await env.DB.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first();
    if (!album) {
      return json({ error: '专辑不存在' }, 404);
    }

    const body = await request.json();
    const { title, description } = body;

    await env.DB.prepare(
      `UPDATE albums SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        updated_at = datetime('now')
      WHERE id = ?`
    ).bind(title || null, description || null, id).run();

    const updated = await env.DB.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first();
    return json({ data: updated });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// 删除专辑
export async function onRequestDelete(context) {
  const { env, params } = context;
  const { id } = params;

  try {
    const album = await env.DB.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first();
    if (!album) {
      return json({ error: '专辑不存在' }, 404);
    }

    // 如果有封面图片，从 R2 删除
    if (album.cover_file_key) {
      await env.SONG_BUCKET.delete(album.cover_file_key);
    }

    // 删除专辑（CASCADE 会自动删除 album_songs 关联记录，但不会删除歌曲本身）
    await env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(id).run();

    return json({ message: '删除成功' });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
