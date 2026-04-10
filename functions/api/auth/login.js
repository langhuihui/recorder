// POST /api/auth/login - 管理员登录

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extraHeaders },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// SHA-256 哈希
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 生成会话令牌
function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return json({ error: '用户名和密码不能为空' }, 400);
    }

    // 查询用户
    const user = await env.ASC_DB.prepare(
      'SELECT * FROM admin_users WHERE username = ?'
    ).bind(username).first();

    if (!user) {
      return json({ error: '用户名或密码错误' }, 401);
    }

    // 验证密码
    const passwordHash = await sha256(password);
    if (passwordHash !== user.password_hash) {
      return json({ error: '用户名或密码错误' }, 401);
    }

    // 生成会话令牌
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7天过期

    // 存储会话（使用 admin_sessions 表）
    await env.ASC_DB.prepare(
      'INSERT INTO admin_sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(token, user.id, expiresAt).run();

    // 设置 HttpOnly Cookie
    const cookie = `asc_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`;

    return json(
      { message: '登录成功', user: { id: user.id, username: user.username } },
      200,
      { 'Set-Cookie': cookie }
    );
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
