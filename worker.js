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

      // Bangumi API 代理 (中文数据, 带 KV 缓存)
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

// ─── 动漫数据代理 (Bangumi / bgm.tv API, 免费无 key; 兼容原 Jikan 响应结构, 中文优先) ───

const BGM_API = 'https://api.bgm.tv';

const BGM_TYPE_MAP = {
  TV: 'TV',
  剧场版: 'Movie',
  电影: 'Movie',
  OVA: 'OVA',
  ONA: 'ONA',
  WEB: 'ONA',
  特别篇: 'Special',
  SP: 'Special',
  其他: 'TV',
};

const SEASON_ORDER = ['winter', 'spring', 'summer', 'fall'];

function currentSeason(offset = 0) {
  const d = new Date();
  const month = d.getMonth() + 1; // 1-12
  let idx = 0;
  if (month >= 1 && month <= 3) idx = 0;
  else if (month >= 4 && month <= 6) idx = 1;
  else if (month >= 7 && month <= 9) idx = 2;
  else idx = 3;
  idx += offset;
  let year = d.getFullYear() + Math.floor(idx / 4);
  idx = ((idx % 4) + 4) % 4;
  return { season: SEASON_ORDER[idx], year };
}

function seasonFromDate(dateStr) {
  if (!dateStr) return null;
  const m = parseInt(dateStr.slice(5, 7), 10);
  if (m >= 1 && m <= 3) return 'winter';
  if (m >= 4 && m <= 6) return 'spring';
  if (m >= 7 && m <= 9) return 'summer';
  return 'fall';
}

function secureImg(url) {
  return url ? url.replace(/^http:\/\//, 'https://') : '';
}

// Bangumi 条目 -> Jikan 兼容结构 (标题优先中文 name_cn)
function bgmToJikan(item) {
  if (!item) return null;
  const nameCn = item.name_cn || '';
  const name = item.name || '';
  const platform = item.platform || 'TV';
  const dateStr = item.date || item.air_date || null;
  return {
    mal_id: item.id,
    bgm_id: item.id,
    url: `https://bgm.tv/subject/${item.id}`,
    title: nameCn || name || 'Unknown',
    title_english: nameCn || null,
    title_japanese: name || null,
    type: BGM_TYPE_MAP[platform] || platform || 'TV',
    status: null,
    episodes: item.total_episodes || item.eps || null,
    score: item.rating?.score ?? null,
    year: dateStr ? parseInt(dateStr.slice(0, 4), 10) : null,
    season: seasonFromDate(dateStr),
    synopsis: item.summary || '',
    genres: (item.tags || []).map(t => ({ name: t?.name })).filter(g => g.name),
    images: {
      jpg: {
        image_url: secureImg(item.images?.large || item.images?.common || ''),
        large_image_url: secureImg(item.images?.large || item.images?.common || ''),
        small_image_url: secureImg(item.images?.small || item.images?.grid || ''),
      },
    },
    trailer: null,
    relations: [],
  };
}

async function bgmFetch(path, retries = 2) {
  const res = await fetch(`${BGM_API}${path}`, {
    headers: { 'User-Agent': 'Narumi-Anime-Tracker/1.0', 'Accept': 'application/json' },
  });
  if (res.status === 429 && retries > 0) {
    await new Promise(r => setTimeout(r, 1200));
    return bgmFetch(path, retries - 1);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Bangumi ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json();
}

async function handleAnimeProxy(request, env, corsHeaders) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/anime', '');
  const search = url.searchParams;
  const cacheKey = `bgm:${path}:${url.search}`;
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

  let result;

  try {
    // ── 热门排行: /top/anime?page=1&limit=25 → v0/subjects?type=2&sort=rank ──
    if (path === '/top/anime') {
      const page = Math.max(parseInt(search.get('page') || '1', 10), 1);
      const limit = Math.min(parseInt(search.get('limit') || '25', 10), 50);
      const offset = (page - 1) * limit;
      const data = await bgmFetch(`/v0/subjects?type=2&sort=rank&limit=${limit}&offset=${offset}`);
      const list = data.data || [];
      result = {
        data: list.map(bgmToJikan),
        pagination: { has_next_page: offset + list.length < (data.total ?? offset + list.length) },
      };
    }

    // ── 当季新番: /seasons/now?limit=60 → /calendar (本周放送, 按评分排序) ──
    else if (path === '/seasons/now') {
      const limit = Math.min(parseInt(search.get('limit') || '60', 10), 100);
      const cal = await bgmFetch('/calendar');
      const list = [];
      for (const day of cal || []) {
        if (Array.isArray(day.items)) list.push(...day.items);
      }
      list.sort((a, b) => (b.rating?.score || 0) - (a.rating?.score || 0));
      result = {
        data: list.slice(0, limit).map(bgmToJikan),
        pagination: { has_next_page: list.length > limit },
      };
    }

    // ── 即将开播: /seasons/upcoming?limit=10 → v0/subjects?type=2&sort=date ──
    else if (path === '/seasons/upcoming') {
      const limit = Math.min(parseInt(search.get('limit') || '10', 10), 50);
      const data = await bgmFetch(`/v0/subjects?type=2&sort=date&limit=${limit}`);
      result = {
        data: (data.data || []).map(bgmToJikan),
        pagination: { has_next_page: false },
      };
    }

    // ── 周播表: /schedule → /calendar (按星期分组的放送列表) ──
    else if (path === '/schedule') {
      const cal = await bgmFetch('/calendar');
      result = {
        data: (cal || []).map(day => {
          const items = (day.items || []).map(it => {
            const a = bgmToJikan(it);
            if (a) a.air_date = it.air_date || null;
            return a;
          }).filter(Boolean);
          return { weekday: day.weekday || null, items };
        }),
        pagination: { has_next_page: false },
      };
    }

    // ── 搜索: /anime?q=xxx&limit=20 → /search/subject/{q}?type=2&responseGroup=large ──
    else if (path === '/anime' && search.get('q')) {
      const limit = Math.min(parseInt(search.get('limit') || '20', 10), 40);
      const q = encodeURIComponent(search.get('q'));
      const data = await bgmFetch(`/search/subject/${q}?type=2&responseGroup=large&max_results=${limit}`);
      result = {
        data: (data.list || []).map(bgmToJikan),
        pagination: { has_next_page: false },
      };
    }

    // ── 剧集列表: /anime/{id}/episodes → /v0/episodes?subject_id={id}&type=0 ──
    else if (/^\/anime\/\d+\/episodes$/.test(path)) {
      const id = parseInt(path.split('/')[2], 10);
      if (isNaN(id)) throw new Error('Bad id');
      const page = Math.max(parseInt(search.get('page') || '1', 10), 1);
      const limit = Math.min(parseInt(search.get('limit') || '100', 10), 300);
      const offset = (page - 1) * limit;
      const data = await bgmFetch(`/v0/episodes?subject_id=${id}&type=0&limit=${limit}&offset=${offset}`);
      const list = data.data || [];
      result = {
        data: list.map(ep => ({
          mal_id: ep.ep || ep.sort || ep.id,
          bgm_episode_id: ep.id,
          title: ep.name_cn || ep.name || `第${ep.ep ?? ep.sort ?? '?'}集`,
          aired: ep.airdate || null,
          length: ep.duration || null,
          episode: ep.ep || ep.sort || null,
        })),
        pagination: { has_next_page: offset + list.length < (data.total ?? offset + list.length) },
      };
    }

    // ── 详情: /anime/{id}/full → /v0/subjects/{id} ──
    else if (/^\/anime\/\d+\/full$/.test(path)) {
      const id = parseInt(path.split('/')[2], 10);
      if (isNaN(id)) throw new Error('Bad id');
      const detail = await bgmFetch(`/v0/subjects/${id}`);
      const anime = bgmToJikan(detail);
      if (anime && (!anime.genres || !anime.genres.length) && detail.meta_tags) {
        anime.genres = detail.meta_tags.map(name => ({ name }));
      }
      result = { data: anime };
    }

    else {
      return jsonResponse({ error: 'Unknown endpoint' }, 404, corsHeaders);
    }
  } catch (err) {
    console.error('Bangumi proxy error:', err);
    return jsonResponse({ error: 'Bangumi API 请求失败', message: err.message }, 502, corsHeaders);
  }

  // 写入缓存
  try {
    await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: cacheTTL });
  } catch (e) {
    // KV 不可用，忽略
  }

  return jsonResponse(result, 200, corsHeaders);
}

// ─── 流媒体 API 代理 ───
// 通过环境变量 STREAM_API_URL 配置上游 (consumet-style gogoanime, 例如 https://api.consumet.org/anime/gogoanime)
// 支持多个上游: 用英文逗号分隔, 逐个故障转移 (免费公共源不稳定, 多源更稳)

const DEFAULT_STREAM_SOURCES = [
  'https://api.consumet.org/anime/gogoanime',
  'https://anime-api.hanifz.com/anime/gogoanime',
];

function listStreamBases(env) {
  const raw = env.STREAM_API_URL || DEFAULT_STREAM_SOURCES.join(',');
  return raw.split(/[,，]/).map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

async function tryStreamUpstreams(env, buildPath) {
  const bases = listStreamBases(env);
  let lastErr = '未配置任何流媒体源 (STREAM_API_URL)';
  for (const base of bases) {
    try {
      const res = await buildPath(base);
      if (res && res.ok) {
        return { ok: true, status: res.status, data: null, raw: res };
      }
      if (res) lastErr = `上游 ${base} 返回 ${res.status}`;
    } catch (err) {
      lastErr = `上游 ${base} 连接失败: ${err.message}`;
    }
  }
  return { ok: false, error: lastErr };
}

async function handleStreamProxy(request, env, corsHeaders) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/stream', '');
  const search = url.searchParams;

  // 若配置了 AniKotoAPI 专属源, 优先走 AniKoto 取源链路 (接口契约不同)
  if (env.STREAM_ANIKOTO_URL) {
    return handleStreamProxyAnikoto(request, env, corsHeaders);
  }

  const streamHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Accept': 'application/json',
  };

  // ── 获取番剧剧集列表: /info/{animeId}-episode-{ep}?q=标题(可选) ──
  const infoMatch = path.match(/^\/info\/(\d+)-episode-(\d+)$/);
  if (infoMatch) {
    const animeId = infoMatch[1];
    const targetEp = parseInt(infoMatch[2], 10);

    // 优先使用前端传入的中文标题, 否则从 Bangumi 拉取
    let title = search.get('q') || '';
    if (!title) {
      try {
        const detail = await bgmFetch(`/v0/subjects/${animeId}`);
        title = detail?.name_cn || detail?.name || '';
      } catch { /* 忽略 */ }
    }

    // 用标题搜索各上游拿 gogoId
    let gogoId = null;
    let searchError = '标题为空, 无法搜索';
    const searchResult = await tryStreamUpstreams(env, async (base) => {
      if (!title) return null;
      const res = await fetch(`${base}/search/${encodeURIComponent(title)}?page=1`, { headers: streamHeaders });
      if (res.ok) {
        const data = await res.json();
        const results = data?.results || [];
        // 标题弱匹配, 提高命中准确度
        const norm = (s) => (s || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
        let matched = results[0]?.id || null;
        if (results.length > 1) {
          const target = norm(title).slice(0, 10);
          const found = results.find(r => norm(r.title).includes(target));
          if (found) matched = found.id;
        }
        if (matched) gogoId = matched;
      }
      return res;
    });
    if (searchResult.error) searchError = searchResult.error;

    if (!gogoId) {
      return jsonResponse({ error: '未在播放源中找到该番剧', search: searchError, fallback: true }, 404, corsHeaders);
    }

    // 拉取剧集列表 (多源故障转移)
    let infoData = null;
    let infoUpstream = null;
    const infoResult = await tryStreamUpstreams(env, async (base) => {
      const res = await fetch(`${base}/info/${gogoId}`, { headers: streamHeaders });
      if (res.ok) {
        const data = await res.json();
        const episodes = (data?.episodes || []).map(ep => ({
          id: ep.id,
          number: parseInt(ep.number, 10) || ep.number,
          title: ep.title || (ep.number ? `第 ${ep.number} 集` : ''),
        }));
        if (episodes.length) {
          infoData = episodes;
          infoUpstream = base;
        }
      }
      return res;
    });
    if (infoData) {
      return jsonResponse({
        episodes: infoData,
        gogoanime_id: gogoId,
        target_episode: targetEp,
        anime_title: title,
        upstream: infoUpstream,
      }, 200, corsHeaders);
    }
    return jsonResponse({
      error: '剧集列表获取失败, 流媒体源不可用',
      detail: infoResult.error,
      fallback: true,
    }, 502, corsHeaders);
  }

  // ── 获取播放源: /episode/{episodeId} ──
  const episodeMatch = path.match(/^\/episode\/(.+)$/);
  if (episodeMatch) {
    const episodeId = episodeMatch[1];
    let watchData = null;
    let watchUpstream = null;
    const watchResult = await tryStreamUpstreams(env, async (base) => {
      const res = await fetch(`${base}/watch/${encodeURIComponent(episodeId)}`, { headers: streamHeaders });
      if (res.ok) {
        watchData = await res.json();
        watchUpstream = base;
      }
      return res;
    });
    if (watchData) return jsonResponse({ ...watchData, upstream: watchUpstream }, 200, corsHeaders);
    return jsonResponse({ error: '播放源获取失败, 流媒体源不可用', detail: watchResult.error, fallback: true }, 502, corsHeaders);
  }

  return jsonResponse({ error: 'Unknown stream endpoint' }, 404, corsHeaders);
}

// ─── AniKotoAPI 流媒体适配层 ───
// AniKotoAPI (anikoto.107211.xyz) 不是 consumet 契约, 而是自己的一套:
//   search  : GET /api/search?keyword={标题}        -> { results:{ data:[{slug,animeId,title,...}] } }
//   episodes: GET /api/episodes/{animeId}           -> { results:{ episodes:[{episode_no,server_ids,...}] } }
//   servers : GET /api/servers?ids={server_ids}     -> { results:[{type:'sub',link_id,...}] }
//   stream  : GET /api/stream?id={link_id}          -> { results:{ url:<megaplay player 页> } }
// 播放源返回的是 megaplay 等播放器页面 URL (无 X-Frame-Options, 可 iframe 直接嵌入播放)。
async function handleStreamProxyAnikoto(request, env, corsHeaders) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/stream', '');
  const search = url.searchParams;
  const base = (env.STREAM_ANIKOTO_URL || 'https://anikoto.107211.xyz').replace(/\/+$/, '');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Accept': 'application/json',
  };

  // ── 获取番剧剧集列表: /info/{bgmId}-episode-{ep}?q=标题 ──
  const infoMatch = path.match(/^\/info\/(\d+)-episode-(\d+)$/);
  if (infoMatch) {
    const bgmId = infoMatch[1];
    const targetEp = parseInt(infoMatch[2], 10);

    try {
      // 收集候选标题: 优先 Bangumi 日文原名(AniKoto 中文搜不到), 再兜底前端传的中文 q
      const titles = [];
      try {
        const detail = await bgmFetch(`/v0/subjects/${bgmId}`);
        if (detail?.name) titles.push(detail.name);          // 日文原名
        if (detail?.name_cn) titles.push(detail.name_cn);    // 中文
      } catch { /* 忽略 */ }
      const q = search.get('q') || '';
      if (q && !titles.includes(q)) titles.push(q);

      // 逐个标题搜 AniKoto 拿 animeId
      let animeId = null;
      for (const t of titles) {
        const res = await fetch(`${base}/api/search?keyword=${encodeURIComponent(t)}`, { headers });
        if (!res.ok) continue;
        const data = await res.json();
        const list = data?.results?.data || [];
        if (!list.length) continue;
        const norm = (s) => (s || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
        const target = norm(t).slice(0, 10);
        const hit = list.find(r =>
          norm(r.title).includes(target) || norm(r.japaneseTitle || '').includes(target));
        animeId = hit?.animeId || list[0].animeId;
        if (animeId) break;
      }
      if (!animeId) {
        return jsonResponse({ error: '未在播放源中找到该番剧', fallback: true }, 404, corsHeaders);
      }

      // 拉剧集列表
      const epRes = await fetch(`${base}/api/episodes/${animeId}`, { headers });
      if (!epRes.ok) {
        return jsonResponse({ error: '剧集列表获取失败, 流媒体源不可用', fallback: true }, epRes.status, corsHeaders);
      }
      const epData = await epRes.json();
      const episodes = (epData?.results?.episodes || []).map(e => ({
        id: e.server_ids,                                   // 供 /episode/{server_ids} 使用
        number: parseInt(e.episode_no, 10) || e.episode_no,
        title: e.title || (e.episode_no ? `第 ${e.episode_no} 集` : ''),
      })).filter(e => e.id);
      if (!episodes.length) {
        return jsonResponse({ error: '未获取到剧集列表', fallback: true }, 404, corsHeaders);
      }

      return jsonResponse({
        episodes,
        anikoto_anime_id: animeId,
        target_episode: targetEp,
        upstream: base,
      }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: '流媒体服务连接失败', fallback: true, message: err.message }, 502, corsHeaders);
    }
  }

  // ── 获取播放源: /episode/{serverIds} ──
  const epMatch = path.match(/^\/episode\/(.+)$/);
  if (epMatch) {
    const serverIds = epMatch[1];
    try {
      // 1) 由 server_ids 拿服务器列表
      const svRes = await fetch(`${base}/api/servers?ids=${encodeURIComponent(serverIds)}`, { headers });
      if (!svRes.ok) {
        return jsonResponse({ error: '播放源获取失败, 流媒体源不可用', fallback: true }, svRes.status, corsHeaders);
      }
      const svData = await svRes.json();
      const servers = svData?.results || [];
      const sub = servers.find(s => s.type === 'sub') || servers[0];
      if (!sub?.link_id) {
        return jsonResponse({ error: '未找到可用播放服务器', fallback: true }, 404, corsHeaders);
      }

      // 2) 拿播放器页面 URL
      const stRes = await fetch(`${base}/api/stream?id=${encodeURIComponent(sub.link_id)}`, { headers });
      if (!stRes.ok) {
        return jsonResponse({ error: '播放源获取失败, 流媒体源不可用', fallback: true }, stRes.status, corsHeaders);
      }
      const stData = await stRes.json();
      const playerUrl = stData?.results?.url;
      if (!playerUrl) {
        return jsonResponse({ error: '播放源获取失败, 未返回播放地址', fallback: true }, 502, corsHeaders);
      }

      // 返回可直接 iframe 嵌入的播放器页面 (无 X-Frame-Options)
      return jsonResponse({
        sources: [{ url: playerUrl, quality: 'default', type: 'iframe' }],
        upstream: base,
        server: sub.name,
      }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ error: '流媒体服务连接失败', fallback: true, message: err.message }, 502, corsHeaders);
    }
  }

  return jsonResponse({ error: 'Unknown stream endpoint' }, 404, corsHeaders);
}
