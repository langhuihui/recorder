// GET /api/public/songs/:id/download - 公开 API：下载歌曲资源
// 支持 ?type=sheet|vocal|accompaniment&part_name=xxx 筛选

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

  // 筛选参数
  const typeFilter = url.searchParams.get('type') || ''; // sheet, vocal, accompaniment
  const partName = url.searchParams.get('part_name') || ''; // 筛选特定声部

  try {
    const song = await env.ASC_DB.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first();
    if (!song) {
      return json({ error: '歌曲不存在' }, 404);
    }
    if (song.song_kind !== 'practice') {
      return json({ error: '该资源为专辑欣赏内容，请从专辑页面收听' }, 404);
    }

    const resources = [];

    // 获取歌谱
    if (!typeFilter || typeFilter === 'sheet') {
      const sheets = await env.ASC_DB.prepare(
        'SELECT * FROM sheet_images WHERE song_id = ? ORDER BY sort_order'
      ).bind(id).all();

      for (const s of sheets.results) {
        resources.push({
          type: 'sheet',
          part_name: null,
          part_label: null,
          url: `${baseUrl}/api/files/${s.file_key}`,
          file_key: s.file_key,
          sort_order: s.sort_order,
        });
      }
    }

    // 获取音频轨道
    if (!typeFilter || typeFilter === 'vocal' || typeFilter === 'accompaniment') {
      let trackQuery = 'SELECT * FROM audio_tracks WHERE song_id = ?';
      const trackBindings = [id];

      if (typeFilter) {
        trackQuery += ' AND track_type = ?';
        trackBindings.push(typeFilter);
      }
      if (partName) {
        trackQuery += ' AND part_name = ?';
        trackBindings.push(partName);
      }

      const tracks = await env.ASC_DB.prepare(trackQuery).bind(...trackBindings).all();

      for (const t of tracks.results) {
        resources.push({
          type: t.track_type,
          part_name: t.part_name,
          part_label: t.part_label || t.part_name,
          url: `${baseUrl}/api/files/${t.file_key}`,
          file_key: t.file_key,
          file_size: t.file_size,
          duration: t.duration,
        });
      }
    }

    // 如果只要单个资源的直接下载，且筛选后只有一个结果，直接返回文件流
    const directDownload = url.searchParams.get('direct') === 'true';
    if (directDownload && resources.length === 1) {
      const res = resources[0];
      const object = await env.ASC_BUCKET.get(res.file_key);
      if (!object) {
        return json({ error: '文件不存在' }, 404);
      }
      // 生成下载文件名
      const ext = res.file_key.split('.').pop();
      const typeLabel = res.type === 'sheet' ? '歌谱' : (res.type === 'vocal' ? '范唱' : '伴奏');
      const partLabel = res.part_label ? `_${res.part_label}` : '';
      const filename = `${song.title}_${typeLabel}${partLabel}.${ext}`;

      return new Response(object.body, {
        status: 200,
        headers: {
          'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'Content-Length': object.size,
          ...corsHeaders(),
        },
      });
    }

    // 返回资源列表（带下载 URL）
    return json({
      data: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        resources,
        total: resources.length,
      },
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
