// POST /api/albums/:id/songs - 添加歌曲到专辑
// DELETE /api/albums/:id/songs - 从专辑移除歌曲
// PUT /api/albums/:id/songs - 更新歌曲排序

import { effectiveSongKind } from '../../_songKind.js';

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

// 添加歌曲到专辑
export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { id } = params;

  try {
    const album = await env.ASC_DB.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first();
    if (!album) {
      return json({ error: '专辑不存在' }, 404);
    }

    const body = await request.json();
    const { song_ids } = body; // 数组: ["song_id_1", "song_id_2", ...]

    if (!Array.isArray(song_ids) || song_ids.length === 0) {
      return json({ error: 'song_ids 必须是非空数组' }, 400);
    }

    // 获取当前最大排序值
    const maxOrder = await env.ASC_DB.prepare(
      'SELECT MAX(sort_order) as max_order FROM album_songs WHERE album_id = ?'
    ).bind(id).first();
    let sortOrder = (maxOrder?.max_order ?? -1) + 1;

    const stmts = [];
    for (const songId of song_ids) {
      const song = await env.ASC_DB.prepare('SELECT * FROM songs WHERE id = ?').bind(songId).first();
      if (!song) {
        return json({ error: `歌曲不存在: ${songId}` }, 400);
      }
      const kind = await effectiveSongKind(env, song);
      if (kind !== 'album') {
        return json({ error: '只能将「专辑歌曲」加入专辑，练唱歌曲请使用练唱管理' }, 400);
      }

      // 检查是否已存在
      const existing = await env.ASC_DB.prepare(
        'SELECT 1 FROM album_songs WHERE album_id = ? AND song_id = ?'
      ).bind(id, songId).first();
      if (existing) continue;

      stmts.push(
        env.ASC_DB.prepare(
          'INSERT INTO album_songs (album_id, song_id, sort_order) VALUES (?, ?, ?)'
        ).bind(id, songId, sortOrder++)
      );
    }

    if (stmts.length > 0) {
      await env.ASC_DB.batch(stmts);
    }

    return json({ message: `成功添加 ${stmts.length} 首歌曲`, added: stmts.length });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// 更新歌曲排序
export async function onRequestPut(context) {
  const { env, params, request } = context;
  const { id } = params;

  try {
    const body = await request.json();
    const { order } = body; // 数组: ["song_id_1", "song_id_2", ...]

    if (!Array.isArray(order)) {
      return json({ error: 'order 必须是数组' }, 400);
    }

    const stmts = order.map((songId, index) =>
      env.ASC_DB.prepare('UPDATE album_songs SET sort_order = ? WHERE album_id = ? AND song_id = ?')
        .bind(index, id, songId)
    );

    await env.ASC_DB.batch(stmts);

    return json({ message: '排序更新成功' });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// 从专辑移除歌曲
export async function onRequestDelete(context) {
  const { env, params, request } = context;
  const { id } = params;

  try {
    const body = await request.json();
    const { song_ids } = body;

    if (!Array.isArray(song_ids) || song_ids.length === 0) {
      return json({ error: 'song_ids 必须是非空数组' }, 400);
    }

    const stmts = song_ids.map(songId =>
      env.ASC_DB.prepare('DELETE FROM album_songs WHERE album_id = ? AND song_id = ?')
        .bind(id, songId)
    );

    await env.ASC_DB.batch(stmts);

    return json({ message: `已移除 ${song_ids.length} 首歌曲` });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
