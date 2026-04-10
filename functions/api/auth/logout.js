// POST /api/auth/logout - 管理员登出

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(part => {
    const [key, ...val] = part.trim().split('=');
    if (key) cookies[key.trim()] = val.join('=').trim();
  });
  return cookies;
}

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const cookies = parseCookies(request.headers.get('Cookie'));
    const token = cookies['asc_token'];

    if (token) {
      // 删除会话记录
      await env.ASC_DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
    }

    // 清除 Cookie
    const clearCookie = 'asc_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';

    return new Response(JSON.stringify({ message: '已退出登录' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': clearCookie,
        ...corsHeaders(),
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
}
