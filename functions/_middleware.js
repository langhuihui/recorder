// Cloudflare Pages Functions Middleware
// 保护 /admin 页面和 /api 写操作路由

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(part => {
    const [key, ...val] = part.trim().split('=');
    if (key) cookies[key.trim()] = val.join('=').trim();
  });
  return cookies;
}

async function validateSession(env, token) {
  if (!token) return null;
  const session = await env.ASC_DB.prepare(
    'SELECT s.*, u.username FROM admin_sessions s JOIN admin_users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime(\'now\')'
  ).bind(token).first();
  return session;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // 公开路由 - 不需要认证
  // 1. 登录页面和登录API
  if (path === '/login' || path === '/api/auth/login') {
    return next();
  }

  // 2. 前台页面（非 admin）
  if (!path.startsWith('/admin') && !path.startsWith('/api/')) {
    return next();
  }

  // 3. API 的 GET 请求（读取操作）和 OPTIONS 请求公开
  if (path.startsWith('/api/') && (request.method === 'GET' || request.method === 'OPTIONS')) {
    // 文件服务公开
    if (path.startsWith('/api/files/')) {
      return next();
    }
    // 公开 API 完全公开（歌曲列表、资源列表、下载等）
    if (path.startsWith('/api/public/')) {
      return next();
    }
    // 其他 GET API 也公开（歌曲列表、专辑列表等）
    return next();
  }

  // 需要认证的路由：/admin/* 和 /api 的写操作 (POST/PUT/DELETE)
  const cookies = parseCookies(request.headers.get('Cookie'));
  const token = cookies['asc_token'];
  const session = await validateSession(env, token);

  if (!session) {
    // API 请求返回 401 JSON
    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: '未登录，请先登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // 页面请求重定向到登录页
    return Response.redirect(new URL('/login', request.url).toString(), 302);
  }

  // 认证通过，将用户信息注入 context
  context.data = context.data || {};
  context.data.user = {
    id: session.user_id,
    username: session.username,
  };

  return next();
}
