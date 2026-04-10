// GET /api/songs/:id - 获取歌曲详情
// PUT /api/songs/:id - 更新歌曲信息
// DELETE /api/songs/:id - 删除歌曲

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

// 获取歌曲详情
export async function onRequestGet(context) {
  const { env, params, request } = context;
  const { id } = params;
  const url = new URL(request.url);
  const baseUrl = url.origin;

  try {
    const song = await env.ASC_DB.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first();
    if (!song) {
      return json({ error: '歌曲不存在' }, 404);
    }

    const sheets = await env.ASC_DB.prepare(
      'SELECT * FROM sheet_images WHERE song_id = ? ORDER BY sort_order'
    ).bind(id).all();

    const tracks = await env.ASC_DB.prepare(
      'SELECT * FROM audio_tracks WHERE song_id = ?'
    ).bind(id).all();

    return json({
      data: {
        ...song,
        sheets: sheets.results.map(s => ({
          ...s,
          url: `${baseUrl}/api/files/${s.file_key}`,
        })),
        tracks: tracks.results.map(t => ({
          ...t,
          url: `${baseUrl}/api/files/${t.file_key}`,
        })),
      },
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// 更新歌曲信息
export async function onRequestPut(context) {
  const { env, params, request } = context;
  const { id } = params;

  try {
    const song = await env.ASC_DB.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first();
    if (!song) {
      return json({ error: '歌曲不存在' }, 404);
    }

    const body = await request.json();
    const { title, artist, description } = body;

    await env.ASC_DB.prepare(
      `UPDATE songs SET 
        title = COALESCE(?, title),
        artist = COALESCE(?, artist),
        description = COALESCE(?, description),
        updated_at = datetime('now')
      WHERE id = ?`
    ).bind(title || null, artist || null, description || null, id).run();

    const updated = await env.ASC_DB.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first();
    return json({ data: updated });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// 删除歌曲
export async function onRequestDelete(context) {
  const { env, params } = context;
  const { id } = params;

  try {
    const song = await env.ASC_DB.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first();
    if (!song) {
      return json({ error: '歌曲不存在' }, 404);
    }

    // 获取所有关联文件
    const sheets = await env.ASC_DB.prepare('SELECT file_key FROM sheet_images WHERE song_id = ?').bind(id).all();
    const tracks = await env.ASC_DB.prepare('SELECT file_key FROM audio_tracks WHERE song_id = ?').bind(id).all();

    // 从 R2 删除文件
    const fileKeys = [
      ...sheets.results.map(s => s.file_key),
      ...tracks.results.map(t => t.file_key),
    ];
    await Promise.all(fileKeys.map(key => env.ASC_BUCKET.delete(key)));

    // 从 D1 删除记录（CASCADE 会自动删除关联记录）
    await env.ASC_DB.prepare('DELETE FROM songs WHERE id = ?').bind(id).run();

    return json({ message: '删除成功' });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
