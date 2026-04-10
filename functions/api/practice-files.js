// GET /api/practice-files - list practice files
// POST /api/practice-files - upload a practice file

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
  const offset = (page - 1) * limit;

  try {
    let countQuery = 'SELECT COUNT(*) as total FROM practice_files';
    let listQuery = 'SELECT * FROM practice_files';
    const bindings = [];

    if (category) {
      countQuery += ' WHERE category = ?';
      listQuery += ' WHERE category = ?';
      bindings.push(category);
    }

    listQuery += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

    const countResult = await env.DB.prepare(countQuery)
      .bind(...bindings)
      .first();

    const files = await env.DB.prepare(listQuery)
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
    await env.SONG_BUCKET.put(fileKey, arrayBuffer, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });

    await env.DB.prepare(
      'INSERT INTO practice_files (id, name, description, category, file_key, size) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, file.name, description, category, fileKey, file.size).run();

    const record = await env.DB.prepare('SELECT * FROM practice_files WHERE id = ?').bind(id).first();
    return json({
      data: { ...record, url: `${baseUrl}/api/files/${fileKey}` },
    }, 201);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
