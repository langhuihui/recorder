// POST /api/albums/:id/cover - 上传专辑封面

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { id } = params;

  try {
    const album = await env.ASC_DB.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first();
    if (!album) {
      return json({ error: '专辑不存在' }, 404);
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return json({ error: '没有上传文件' }, 400);
    }

    if (!file.type.startsWith('image/')) {
      return json({ error: '封面必须是图片文件' }, 400);
    }

    // 删除旧封面
    if (album.cover_file_key) {
      await env.ASC_BUCKET.delete(album.cover_file_key);
    }

    const ext = file.name.split('.').pop().toLowerCase();
    const fileKey = `albums/${id}/cover.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    await env.ASC_BUCKET.put(fileKey, arrayBuffer, {
      httpMetadata: { contentType: file.type },
    });

    // 更新数据库
    await env.ASC_DB.prepare(
      'UPDATE albums SET cover_file_key = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(fileKey, id).run();

    const url = new URL(request.url);
    return json({
      data: {
        cover_file_key: fileKey,
        cover_url: `${url.origin}/api/files/${fileKey}`,
      },
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
