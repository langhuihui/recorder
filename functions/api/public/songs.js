// GET /api/public/songs - 公开 API：获取歌曲列表（含资源概要）

import {
  fetchSongsByKindLegacy,
  isMissingSongKindColumnError,
} from '../_songKind.js';

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
  const { env, request } = context;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const offset = (page - 1) * limit;
  const baseUrl = url.origin;

  try {
    let countResult;
    let songs;
    try {
      countResult = await env.ASC_DB.prepare(
        "SELECT COUNT(*) as total FROM songs WHERE song_kind = 'practice'"
      ).first();
      songs = await env.ASC_DB.prepare(
        "SELECT * FROM songs WHERE song_kind = 'practice' ORDER BY created_at DESC LIMIT ? OFFSET ?"
      )
        .bind(limit, offset)
        .all();
    } catch (e) {
      if (!isMissingSongKindColumnError(e)) throw e;
      ({ countResult, songs } = await fetchSongsByKindLegacy(
        env,
        'practice',
        limit,
        offset
      ));
    }

    const songList = await Promise.all(songs.results.map(async (song) => {
      // 获取歌谱数量
      const sheetCount = await env.ASC_DB.prepare(
        'SELECT COUNT(*) as count FROM sheet_images WHERE song_id = ?'
      ).bind(song.id).first();

      // 获取第一张歌谱作为封面
      const firstSheet = await env.ASC_DB.prepare(
        'SELECT file_key FROM sheet_images WHERE song_id = ? ORDER BY sort_order LIMIT 1'
      ).bind(song.id).first();

      // 获取音频轨道概要：按 track_type 和 part_name 分组
      const tracks = await env.ASC_DB.prepare(
        'SELECT track_type, part_name, part_label FROM audio_tracks WHERE song_id = ?'
      ).bind(song.id).all();

      // 整理成 vocal/accompaniment 各有哪些声部
      const vocalParts = tracks.results
        .filter(t => t.track_type === 'vocal')
        .map(t => ({ part_name: t.part_name, part_label: t.part_label || t.part_name }));

      const accompanimentParts = tracks.results
        .filter(t => t.track_type === 'accompaniment')
        .map(t => ({ part_name: t.part_name, part_label: t.part_label || t.part_name }));

      return {
        id: song.id,
        title: song.title,
        artist: song.artist,
        description: song.description,
        cover_url: firstSheet ? `${baseUrl}/api/files/${firstSheet.file_key}` : '',
        resources: {
          sheets: sheetCount.count,
          vocal_parts: vocalParts,
          accompaniment_parts: accompanimentParts,
        },
        created_at: song.created_at,
        updated_at: song.updated_at,
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
