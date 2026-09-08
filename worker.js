/**
 * Narumi - 日漫追番 Cloudflare Worker
 * 后端: 认证 / 用户数据 / Jikan API代理 / 流媒体代理
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    };

    try {
      // ─── API 路由 ───

      // 认证: 注册
      if (path === '/api/auth/register' && method === 'POST') {
        return handleRegister(request, env, corsHeaders);
      }

      // 认证: 登录
      if (path === '/api/auth/login' && method === 'POST') {
        return handleLogin(request, env, corsHeaders);
      }

      // 认证: GitHub OAuth 登录
      if (path === '/api/auth/github' && method === 'GET') {
        return handleGithubAuth(env, corsHeaders);
      }

      // 认证: GitHub OAuth 回调
      if (path === '/api/auth/github/callback' && method === 'GET') {
        return handleGithubCallback(request, env, corsHeaders);
      }

      // 认证: 获取当前用户
      if (path === '/api/auth/me' && method === 'GET') {
        return handleGetMe(request, env, corsHeaders);
      }

      // 用户: 更新资料
      if (path === '/api/user/profile' && method === 'PUT') {
        return handleUpdateProfile(request, env, corsHeaders);
      }

      // 追番列表
      if (path === '/api/user/watchlist' && method === 'GET') {
        return handleGetWatchlist(request, env, corsHeaders);
      }
      if (path === '/api/user/watchlist' && method === 'POST') {
        return handleAddWatchlist(request, env, corsHeaders);
      }
      if (path.startsWith('/api/user/watchlist/') && method === 'DELETE') {
        return handleRemoveWatchlist(request, env, corsHeaders);
      }

      // 观看历史
      if (path === '/api/user/history' && method === 'GET') {
        return handleGetHistory(request, env, corsHeaders);
      }
      if (path === '/api/user/history' && method === 'POST') {
        return handleAddHistory(request, env, corsHeaders);
      }

      // Jikan API 代理 (带 KV 缓存)
      if (path.startsWith('/api/anime/')) {
        return handleAnimeProxy(request, env, corsHeaders);
      }

      // 流媒体 API 代理
      if (path.startsWith('/api/stream/')) {
        return handleStreamProxy(request, env, corsHeaders);
      }

      // 健康检查
      if (path === '/api/health') {
        return jsonResponse({ status: 'ok', version: '1.0.0' }, 200, corsHeaders);
      }

      // ─── 静态资源 (所有非 API 路由都走 ASSETS) ───
      // 如果有 [site] 配置，会自动从 public/ 目录获取文件
      // 如果没有 ASSETS 绑定，返回 404
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return jsonResponse({ error: 'Not Found' }, 404, corsHeaders);
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: 'Internal Server Error', message: err.message }, 500, corsHeaders);
    }
  },
};

// ─── 工具函数 ───

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function getRequestBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function getAuthToken(request) {
  const auth = request.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return null;
}

// 简易 JWT
function createJWT(payload, secret, expiresIn = 7 * 24 * 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = { ...payload, iat: now, exp: now + expiresIn };

  const base64 = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${base64(header)}.${base64(tokenPayload)}`;

  // Web Crypto API for HMAC-SHA256
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  ).then(async (key) => {
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${signingInput}.${sigB64}`;
  });
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigB64 = parts[2].replace(/-/g, '+').replace(/_/g, '/');
    const sigPadded = sigB64 + '='.repeat((4 - sigB64.length % 4) % 4);
    const sig = Uint8Array.from(atob(sigPadded), c => c.charCodeAt(0));

    const valid = await crypto.subtle.verify('HMAC', key, sig, encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;

    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payloadPadded = payloadB64 + '='.repeat((4 - payloadB64.length % 4) % 4);
    const payload = JSON.parse(atob(payloadPadded));

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password) {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(password)).then((hash) => {
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  });
}

async function authenticateUser(request, env) {
  const token = getAuthToken(request);
  if (!token) return null;
  return await verifyJWT(token, env.JWT_SECRET || 'narumi-default-secret-change-me');
}

// ─── 认证处理器 ───

async function handleRegister(request, env, corsHeaders) {
  const { username, email, password } = await getRequestBody(request);

  if (!username || !email || !password) {
    return jsonResponse({ error: '请填写所有必填字段' }, 400, corsHeaders);
  }

  if (username.length < 2 || username.length > 20) {
    return jsonResponse({ error: '用户名长度需在2-20之间' }, 400, corsHeaders);
  }

  if (password.length < 6) {
    return jsonResponse({ error: '密码至少6位' }, 400, corsHeaders);
  }

  // 检查用户名和邮箱是否已存在
  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ? OR email = ?')
    .bind(username, email).first();

  if (existing) {
    return jsonResponse({ error: '用户名或邮箱已被注册' }, 409, corsHeaders);
  }

  const passwordHash = await hashPassword(password);
  const avatarUrl = `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(username)}`;

  const result = await env.DB.prepare(
    'INSERT INTO users (username, email, password_hash, avatar_url) VALUES (?, ?, ?, ?)'
  ).bind(username, email, passwordHash, avatarUrl).run();

  const userId = result.meta.last_row_id;
  const token = await createJWT({ userId, username, email }, env.JWT_SECRET || 'narumi-default-secret-change-me');

  return jsonResponse({
    token,
    user: { id: userId, username, email, avatar_url: avatarUrl },
  }, 201, corsHeaders);
}

async function handleLogin(request, env, corsHeaders) {
  const { login, password } = await getRequestBody(request);

  if (!login || !password) {
    return jsonResponse({ error: '请填写用户名/邮箱和密码' }, 400, corsHeaders);
  }

  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE username = ? OR email = ?'
  ).bind(login, login).first();

  if (!user) {
    return jsonResponse({ error: '用户不存在' }, 401, corsHeaders);
  }

  const passwordHash = await hashPassword(password);
  if (user.password_hash !== passwordHash) {
    return jsonResponse({ error: '密码错误' }, 401, corsHeaders);
  }

  const token = await createJWT(
    { userId: user.id, username: user.username, email: user.email },
    env.JWT_SECRET || 'narumi-default-secret-change-me'
  );

  return jsonResponse({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar_url: user.avatar_url,
    },
  }, 200, corsHeaders);
}

async function handleGithubAuth(env, corsHeaders) {
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return jsonResponse({ error: 'GitHub OAuth 未配置' }, 500, corsHeaders);
  }

  const redirectUri = `${env.SITE_URL || ''}/api/auth/github/callback`;
  const githubUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email`;

  return Response.redirect(githubUrl, 302);
}

async function handleGithubCallback(request, env, corsHeaders) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return jsonResponse({ error: '缺少授权码' }, 400, corsHeaders);
  }

  try {
    // 交换 token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      return jsonResponse({ error: 'GitHub 授权失败', detail: tokenData.error_description }, 401, corsHeaders);
    }

    // 获取用户信息
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent': 'Narumi-App',
      },
    });
    const ghUser = await userRes.json();

    // 获取邮箱
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent': 'Narumi-App',
      },
    });
    const emails = await emailRes.json();
    const primaryEmail = Array.isArray(emails) ? emails.find(e => e.primary)?.email || emails[0]?.email : '';

    const githubId = String(ghUser.id);
    const username = ghUser.login;
    const email = primaryEmail || `${username}@github.local`;
    const avatarUrl = ghUser.avatar_url;

    // 查找或创建用户
    let user = await env.DB.prepare('SELECT * FROM users WHERE github_id = ?').bind(githubId).first();

    if (!user) {
      // 检查用户名冲突
      const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
      if (existing) {
        // 加后缀
        const newUsername = `${username}_${githubId.slice(-4)}`;
        await env.DB.prepare(
          'INSERT INTO users (username, email, github_id, avatar_url, auth_provider) VALUES (?, ?, ?, ?, ?)'
        ).bind(newUsername, email, githubId, avatarUrl, 'github').run();
        user = await env.DB.prepare('SELECT * FROM users WHERE github_id = ?').bind(githubId).first();
      } else {
        await env.DB.prepare(
          'INSERT INTO users (username, email, github_id, avatar_url, auth_provider) VALUES (?, ?, ?, ?, ?)'
        ).bind(username, email, githubId, avatarUrl, 'github').run();
        user = await env.DB.prepare('SELECT * FROM users WHERE github_id = ?').bind(githubId).first();
      }
    }

    const jwtToken = await createJWT(
      { userId: user.id, username: user.username, email: user.email },
      env.JWT_SECRET || 'narumi-default-secret-change-me'
    );

    // 重定向回前端，带上 token
    const siteUrl = env.SITE_URL || url.origin;
    return Response.redirect(`${siteUrl}/#auth-callback?token=${jwtToken}&user=${encodeURIComponent(JSON.stringify({
      id: user.id,
      username: user.username,
      email: user.email,
      avatar_url: user.avatar_url,
    }))}`, 302);
  } catch (err) {
    return jsonResponse({ error: 'GitHub 认证处理失败', message: err.message }, 500, corsHeaders);
  }
}

async function handleGetMe(request, env, corsHeaders) {
  const payload = await authenticateUser(request, env);
  if (!payload) {
    return jsonResponse({ error: '未登录' }, 401, corsHeaders);
  }

  const user = await env.DB.prepare(
    'SELECT id, username, email, avatar_url, created_at FROM users WHERE id = ?'
  ).bind(payload.userId).first();

  if (!user) {
    return jsonResponse({ error: '用户不存在' }, 404, corsHeaders);
  }

  return jsonResponse({ user }, 200, corsHeaders);
}

// ─── 用户数据处理器 ───

async function handleUpdateProfile(request, env, corsHeaders) {
  const payload = await authenticateUser(request, env);
  if (!payload) return jsonResponse({ error: '未登录' }, 401, corsHeaders);

  const { username, email, avatar_url } = await getRequestBody(request);
  if (username) {
    await env.DB.prepare('UPDATE users SET username = ? WHERE id = ?').bind(username, payload.userId).run();
  }
  if (email) {
    await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, payload.userId).run();
  }
  if (avatar_url) {
    await env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatar_url, payload.userId).run();
  }

  const user = await env.DB.prepare(
    'SELECT id, username, email, avatar_url FROM users WHERE id = ?'
  ).bind(payload.userId).first();

  return jsonResponse({ user }, 200, corsHeaders);
}

async function handleGetWatchlist(request, env, corsHeaders) {
  const payload = await authenticateUser(request, env);
  if (!payload) return jsonResponse({ error: '未登录' }, 401, corsHeaders);

  const url = new URL(request.url);
  const status = url.searchParams.get('status'); // watching, completed, on_hold, dropped, plan_to_watch

  let query = 'SELECT * FROM watchlist WHERE user_id = ?';
  const params = [payload.userId];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY updated_at DESC';

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ watchlist: results }, 200, corsHeaders);
}

async function handleAddWatchlist(request, env, corsHeaders) {
  const payload = await authenticateUser(request, env);
  if (!payload) return jsonResponse({ error: '未登录' }, 401, corsHeaders);

  const { anime_id, anime_title, anime_image, status, score, episodes_watched, total_episodes } = await getRequestBody(request);

  if (!anime_id || !anime_title) {
    return jsonResponse({ error: '缺少必要字段' }, 400, corsHeaders);
  }

  // Upsert
  const existing = await env.DB.prepare(
    'SELECT id FROM watchlist WHERE user_id = ? AND anime_id = ?'
  ).bind(payload.userId, anime_id).first();

  if (existing) {
    await env.DB.prepare(`
      UPDATE watchlist SET status = ?, score = ?, episodes_watched = ?, anime_image = ?, updated_at = datetime('now')
      WHERE user_id = ? AND anime_id = ?
    `).bind(
      status || 'plan_to_watch',
      score || null,
      episodes_watched || 0,
      anime_image || null,
      payload.userId,
      anime_id
    ).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO watchlist (user_id, anime_id, anime_title, anime_image, status, score, episodes_watched, total_episodes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      payload.userId,
      anime_id,
      anime_title,
      anime_image || null,
      status || 'plan_to_watch',
      score || null,
      episodes_watched || 0,
      total_episodes || null
    ).run();
  }

  return jsonResponse({ success: true }, 200, corsHeaders);
}

async function handleRemoveWatchlist(request, env, corsHeaders) {
  const payload = await authenticateUser(request, env);
  if (!payload) return jsonResponse({ error: '未登录' }, 401, corsHeaders);

  const url = new URL(request.url);
  const animeId = url.pathname.split('/').pop();

  await env.DB.prepare('DELETE FROM watchlist WHERE user_id = ? AND anime_id = ?')
    .bind(payload.userId, animeId).run();

  return jsonResponse({ success: true }, 200, corsHeaders);
}

async function handleGetHistory(request, env, corsHeaders) {
  const payload = await authenticateUser(request, env);
  if (!payload) return jsonResponse({ error: '未登录' }, 401, corsHeaders);

  const { results } = await env.DB.prepare(
    'SELECT * FROM watch_history WHERE user_id = ? ORDER BY watched_at DESC LIMIT 50'
  ).bind(payload.userId).all();

  return jsonResponse({ history: results }, 200, corsHeaders);
}

async function handleAddHistory(request, env, corsHeaders) {
  const payload = await authenticateUser(request, env);
  if (!payload) return jsonResponse({ error: '未登录' }, 401, corsHeaders);

  const { anime_id, anime_title, anime_image, episode, episode_title, progress } = await getRequestBody(request);

  // 更新或插入历史
  const existing = await env.DB.prepare(
    'SELECT id FROM watch_history WHERE user_id = ? AND anime_id = ? AND episode = ?'
  ).bind(payload.userId, anime_id, episode || 0).first();

  if (existing) {
    await env.DB.prepare(`
      UPDATE watch_history SET progress = ?, watched_at = datetime('now')
      WHERE user_id = ? AND anime_id = ? AND episode = ?
    `).bind(progress || 0, payload.userId, anime_id, episode || 0).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO watch_history (user_id, anime_id, anime_title, anime_image, episode, episode_title, progress)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      payload.userId,
      anime_id,
      anime_title,
      anime_image || null,
      episode || 0,
      episode_title || null,
      progress || 0
    ).run();
  }

  return jsonResponse({ success: true }, 200, corsHeaders);
}

// ─── Jikan API 代理 ───

async function handleAnimeProxy(request, env, corsHeaders) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/anime', '');
  const cacheKey = `jikan:${path}:${url.search}`;
  const cacheTTL = 3600; // 1 hour

  // 尝试从 KV 读取缓存
  try {
    const cached = await env.CACHE.get(cacheKey, 'json');
    if (cached) {
      return jsonResponse(cached, 200, corsHeaders);
    }
  } catch (e) {
    // KV 不可用，忽略
  }

  // 代理请求到 Jikan API
  const jikanUrl = `https://api.jikan.moe/v4${path}${url.search}`;
  const jikanRes = await fetch(jikanUrl, {
    headers: { 'User-Agent': 'Narumi-Anime-Tracker/1.0' },
  });

  if (!jikanRes.ok) {
    return jsonResponse({ error: 'Jikan API 请求失败' }, jikanRes.status, corsHeaders);
  }

  const data = await jikanRes.json();

  // 写入缓存
  try {
    await env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: cacheTTL });
  } catch (e) {
    // KV 不可用，忽略
  }

  return jsonResponse(data, 200, corsHeaders);
}

// ─── 流媒体 API 代理 ───

async function handleStreamProxy(request, env, corsHeaders) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/stream', '');

  // 使用可配置的流媒体 API
  const streamApiBase = env.STREAM_API_URL || 'https://api.consumet.org/anime/gogoanime';

  const streamUrl = `${streamApiBase}${path}${url.search}`;

  try {
    const streamRes = await fetch(streamUrl, {
      headers: {
        'User-Agent': 'Narumi-Anime-Tracker/1.0',
        'Accept': 'application/json',
      },
    });

    if (!streamRes.ok) {
      return jsonResponse({ error: '流媒体服务暂时不可用', fallback: true }, streamRes.status, corsHeaders);
    }

    const data = await streamRes.json();
    return jsonResponse(data, 200, corsHeaders);
  } catch (err) {
    return jsonResponse({ error: '流媒体服务连接失败', fallback: true, message: err.message }, 502, corsHeaders);
  }
}
