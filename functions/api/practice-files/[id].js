// GET /api/practice-files/:id
// PUT /api/practice-files/:id
// DELETE /api/practice-files/:id

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
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
    const file = await env.ASC_DB.prepare('SELECT * FROM practice_files WHERE id = ?').bind(id).first();
    if (!file) return json({ error: '文件不存在' }, 404);
    return json({ data: { ...file, url: `${baseUrl}/api/files/${file.file_key}` } });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { env, params, request } = context;
  const { id } = params;

  try {
    const file = await env.ASC_DB.prepare('SELECT * FROM practice_files WHERE id = ?').bind(id).first();
    if (!file) return json({ error: '文件不存在' }, 404);

    const body = await request.json();
    const { name, description, category } = body;
    const validCategories = ['sheet', 'audio', 'video', 'doc', 'other'];
    if (category !== undefined && category !== null && !validCategories.includes(category)) {
      return json({ error: '无效的文件分类' }, 400);
    }

    await env.ASC_DB.prepare(
      `UPDATE practice_files SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        category = COALESCE(?, category)
      WHERE id = ?`
    ).bind(
      name !== undefined ? name : null,
      description !== undefined ? description : null,
      category !== undefined ? category : null,
      id,
    ).run();

    const updated = await env.ASC_DB.prepare('SELECT * FROM practice_files WHERE id = ?').bind(id).first();
    const url = new URL(request.url);
    return json({ data: { ...updated, url: `${url.origin}/api/files/${updated.file_key}` } });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const { id } = params;

  try {
    const file = await env.ASC_DB.prepare('SELECT * FROM practice_files WHERE id = ?').bind(id).first();
    if (!file) return json({ error: '文件不存在' }, 404);

    await env.ASC_BUCKET.delete(file.file_key);
    await env.ASC_DB.prepare('DELETE FROM practice_files WHERE id = ?').bind(id).run();

    return json({ message: '删除成功' });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
