// GET /api/files/* - 从 R2 读取文件

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const { env, params, request } = context;
  const filePath = params.path.join('/');

  if (!filePath) {
    return new Response(JSON.stringify({ error: '文件路径不能为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  try {
    // 支持 Range 请求（音频播放需要）
    const range = request.headers.get('Range');

    const object = await env.ASC_BUCKET.get(filePath, {
      range: range ? parseRange(range) : undefined,
    });

    if (!object) {
      return new Response(JSON.stringify({ error: '文件不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    const headers = {
      ...corsHeaders(),
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
      'ETag': object.httpEtag,
    };

    if (object.range) {
      headers['Content-Range'] = `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`;
      headers['Content-Length'] = object.range.length;
      return new Response(object.body, { status: 206, headers });
    }

    headers['Content-Length'] = object.size;
    return new Response(object.body, { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
}

function parseRange(rangeHeader) {
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) return undefined;

  const offset = parseInt(match[1]);
  const end = match[2] ? parseInt(match[2]) : undefined;

  if (end !== undefined) {
    return { offset, length: end - offset + 1 };
  }
  return { offset };
}
