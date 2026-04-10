// GET /api/public/songs/:id - 公开 API：获取歌曲详情（含全部资源 URL）

import { effectiveSongKind } from '../../_songKind.js';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
    const kind = await effectiveSongKind(env, song);
    if (kind !== 'practice') {
      return json({ error: '该资源为专辑欣赏内容，请从专辑页面收听' }, 404);
    }

    // 获取歌谱图片
    const sheets = await env.ASC_DB.prepare(
      'SELECT id, file_key, sort_order, width, height FROM sheet_images WHERE song_id = ? ORDER BY sort_order'
    ).bind(id).all();

    // 获取音频轨道
    const tracks = await env.ASC_DB.prepare(
      'SELECT id, track_type, part_name, part_label, file_key, file_size, duration FROM audio_tracks WHERE song_id = ?'
    ).bind(id).all();

    // 整理歌谱资源
    const sheetResources = sheets.results.map(s => ({
      id: s.id,
      type: 'sheet',
      url: `${baseUrl}/api/files/${s.file_key}`,
      sort_order: s.sort_order,
      width: s.width,
      height: s.height,
    }));

    // 整理音频资源，按 vocal/accompaniment 分组
    const vocalTracks = tracks.results
      .filter(t => t.track_type === 'vocal')
      .map(t => ({
        id: t.id,
        type: 'vocal',
        part_name: t.part_name,
        part_label: t.part_label || t.part_name,
        url: `${baseUrl}/api/files/${t.file_key}`,
        file_size: t.file_size,
        duration: t.duration,
      }));

    const accompanimentTracks = tracks.results
      .filter(t => t.track_type === 'accompaniment')
      .map(t => ({
        id: t.id,
        type: 'accompaniment',
        part_name: t.part_name,
        part_label: t.part_label || t.part_name,
        url: `${baseUrl}/api/files/${t.file_key}`,
        file_size: t.file_size,
        duration: t.duration,
      }));

    return json({
      data: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        description: song.description,
        created_at: song.created_at,
        updated_at: song.updated_at,
        resources: {
          sheets: sheetResources,
          vocal: vocalTracks,
          accompaniment: accompanimentTracks,
        },
      },
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
