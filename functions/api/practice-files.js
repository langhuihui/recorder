// GET /api/practice-files - list practice files (optional song_id)
// POST /api/practice-files - upload a practice file (requires song_id, practice song)

import { effectiveSongKind } from './_songKind.js';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
  const category = url.searchParams.get('category') || '';
  const songId = url.searchParams.get('song_id') || '';
  const offset = (page - 1) * limit;

  try {
    let countQuery = 'SELECT COUNT(*) as total FROM practice_files';
    let listQuery = 'SELECT * FROM practice_files';
    const bindings = [];
    const conditions = [];

    if (category) {
      conditions.push('category = ?');
      bindings.push(category);
    }
    if (songId) {
      conditions.push('song_id = ?');
      bindings.push(songId);
    }
    if (conditions.length) {
      const where = ` WHERE ${conditions.join(' AND ')}`;
      countQuery += where;
      listQuery += where;
    }

    listQuery += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

    const countResult = await env.ASC_DB.prepare(countQuery)
      .bind(...bindings)
      .first();

    const files = await env.ASC_DB.prepare(listQuery)
      .bind(...bindings, limit, offset)
      .all();

    const baseUrl = url.origin;
    const fileList = files.results.map(f => ({
      ...f,
      url: `${baseUrl}/api/files/${f.file_key}`,
    }));

    return json({
      data: fileList,
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

export async function onRequestPost(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const baseUrl = url.origin;

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const category = formData.get('category') || 'other';
    const description = formData.get('description') || '';
    const songId = (formData.get('song_id') || '').toString().trim();

    if (!songId) {
      return json({ error: '必须指定所属练唱歌曲（song_id）' }, 400);
    }

    const song = await env.ASC_DB.prepare('SELECT * FROM songs WHERE id = ?').bind(songId).first();
    if (!song) {
      return json({ error: '歌曲不存在' }, 404);
    }
    const kind = await effectiveSongKind(env, song);
    if (kind !== 'practice') {
      return json({ error: '练习文件只能关联到练唱歌曲' }, 400);
    }

    if (!file || !(file instanceof File)) {
      return json({ error: '请提供文件' }, 400);
    }

    const validCategories = ['sheet', 'audio', 'video', 'doc', 'other'];
    if (!validCategories.includes(category)) {
      return json({ error: '无效的文件分类' }, 400);
    }

    const id = crypto.randomUUID();
    const ext = file.name.split('.').pop() || 'bin';
    const fileKey = `practice/${id}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    await env.ASC_BUCKET.put(fileKey, arrayBuffer, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });

    await env.ASC_DB.prepare(
      'INSERT INTO practice_files (id, name, description, category, file_key, size, song_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, file.name, description, category, fileKey, file.size, songId).run();

    const record = await env.ASC_DB.prepare('SELECT * FROM practice_files WHERE id = ?').bind(id).first();
    return json({
      data: { ...record, url: `${baseUrl}/api/files/${fileKey}` },
    }, 201);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
