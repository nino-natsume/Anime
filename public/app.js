/**
 * Narumi - 日漫追番  |  前端应用
 * SPA 路由 / API 调用 / DOM 渲染 / 动画
 */

(function () {
  'use strict';

  // ─── 配置 ───
  const API_BASE = window.location.origin;
  const JIKAN_BASE = 'https://api.jikan.moe/v4';
  const PER_PAGE = 24;

  // ─── 状态 ───
  const state = {
    user: null,
    token: localStorage.getItem('narumi_token'),
    currentPage: 'home',
    searchFilter: 'tv',
    searchQuery: '',
    heroIndex: 0,
    heroTimer: null,
    watchlistData: [],
  };

  // ─── DOM 引用 ───
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const dom = {
    loader: $('#loader'),
    app: $('#app'),
    navbar: $('#navbar'),
    searchPanel: $('#searchPanel'),
    searchInput: $('#searchInput'),
    searchResults: $('#searchResults'),
    authModal: $('#authModal'),
    playerOverlay: $('#playerOverlay'),
    toastContainer: $('#toastContainer'),
    userAvatarBtn: $('#userAvatarBtn'),
    userDropdown: $('#userDropdown'),
    dropdownContent: $('#dropdownContent'),
    mobileMenu: $('#mobileMenu'),
    bottomNav: $('#bottomNav'),
  };

  // ─── 工具函数 ───
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function apiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    try {
      const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    } catch (err) {
      throw err;
    }
  }

  async function jikanFetch(path) {
    const res = await fetch(`${JIKAN_BASE}${path}`, {
      headers: { 'User-Agent': 'Narumi-Tracker/1.0' },
    });
    if (res.status === 429) {
      await delay(1000);
      return jikanFetch(path);
    }
    if (!res.ok) throw new Error('Jikan API error');
    return res.json();
  }

  function showToast(message, type = 'info') {
    const iconSvg = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<div class="toast-icon">${iconSvg[type]}</div><span>${message}</span>`;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short' });
  }

  function truncate(str, len = 18) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
  }

  // ─── 路由 ───
  function getRoute() {
    const hash = window.location.hash || '#/';
    const [path, query] = hash.slice(1).split('?');
    const params = {};
    if (query) {
      query.split('&').forEach(p => {
        const [k, v] = p.split('=');
        params[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }
    return { path, params };
  }

  async function navigate() {
    const { path, params } = getRoute();

    // 更新导航高亮
    $$('.nav-link').forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + path));
    $$('.mobile-nav-link').forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + path));
    $$('.bottom-nav-item').forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + path));

    window.scrollTo(0, 0);

    if (path === '/' || path === '') {
      await renderHomePage();
    } else if (path === '/seasonal') {
      await renderSeasonalPage();
    } else if (path === '/trending') {
      await renderTrendingPage();
    } else if (path === '/watchlist') {
      await renderWatchlistPage();
    } else if (path.startsWith('/anime/')) {
      const id = path.split('/anime/')[1];
      await renderDetailPage(id);
    } else if (path === '/auth-callback') {
      handleAuthCallback(params);
    } else {
      dom.app.innerHTML = `<div class="section page-transition"><div class="empty-state"><div class="icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 15h8M9 9h.01M15 9h.01"/></svg></div><h3>页面不存在</h3><p>请检查 URL 是否正确</p></div></div>`;
    }
  }

  function handleAuthCallback(params) {
    if (params.token) {
      state.token = params.token;
      localStorage.setItem('narumi_token', params.token);
      try {
        state.user = JSON.parse(decodeURIComponent(params.user || '{}'));
      } catch { state.user = null; }
      showToast('GitHub 登录成功！', 'success');
      window.location.hash = '#/';
    }
  }

  // ─── 页面渲染 ───

  // 首页
  async function renderHomePage() {
    dom.app.innerHTML = renderSkeletonHome();

    try {
      const [topRes, seasonalRes, upcomingRes] = await Promise.all([
        jikanFetch('/top/anime?filter=bypopularity&limit=10'),
        jikanFetch('/seasons/now?page=1&limit=10&filter=tv'),
        jikanFetch('/seasons/upcoming?page=1&limit=10&filter=tv'),
      ]);

      const topAnime = topRes.data || [];
      const seasonalAnime = seasonalRes.data || [];
      const upcomingAnime = upcomingRes.data || [];

      dom.app.innerHTML = `
        <div class="page-transition">
          ${renderHero(topAnime)}
          <div class="section">
            <div class="section-header">
              <h2 class="section-title"><span class="icon"></span>当季新番</h2>
              <a href="#/seasonal" class="section-link">查看全部 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></a>
            </div>
            <div class="anime-grid">${seasonalAnime.map(renderAnimeCard).join('')}</div>
          </div>
          <div class="section">
            <div class="section-header">
              <h2 class="section-title"><span class="icon"></span>热门排行</h2>
              <a href="#/trending" class="section-link">查看全部 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></a>
            </div>
            <div class="anime-grid">${topAnime.slice(0, 12).map(renderAnimeCard).join('')}</div>
          </div>
          <div class="section">
            <div class="section-header">
              <h2 class="section-title"><span class="icon"></span>即将开播</h2>
            </div>
            <div class="anime-grid">${upcomingAnime.slice(0, 8).map(renderAnimeCard).join('')}</div>
          </div>
        </div>
      `;

      initHeroSlider();
      observeCards();
    } catch (err) {
      dom.app.innerHTML = `<div class="section"><div class="empty-state"><div class="icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 15h8M9 9h.01M15 9h.01"/></svg></div><h3>加载失败</h3><p>${err.message}，请稍后重试</p></div></div>`;
    }
  }

  // 新番页
  async function renderSeasonalPage() {
    dom.app.innerHTML = `
      <div class="section page-transition">
        <div class="section-header"><h2 class="section-title"><span class="icon"></span>当季新番</h2></div>
        <div class="anime-grid">${renderSkeletonCards(12)}</div>
      </div>
    `;
    try {
      let allAnime = [];
      let page = 1;
      while (page <= 3) {
        const res = await jikanFetch(`/seasons/now?page=${page}&limit=25&filter=tv`);
        if (res.data) allAnime = allAnime.concat(res.data);
        if (!res.pagination || !res.pagination.has_next_page) break;
        page++;
        if (page > 1) await delay(400);
      }

      dom.app.innerHTML = `
        <div class="section page-transition">
          <div class="section-header"><h2 class="section-title"><span class="icon"></span>当季新番 <span style="font-size:0.6em;color:var(--text-muted);font-weight:400">${allAnime.length} 部</span></h2></div>
          <div class="anime-grid">${allAnime.map(renderAnimeCard).join('')}</div>
        </div>
      `;
      observeCards();
    } catch (err) {
      dom.app.innerHTML = `<div class="section"><div class="empty-state"><p>加载失败: ${err.message}</p></div></div>`;
    }
  }

  // 热门页
  async function renderTrendingPage() {
    dom.app.innerHTML = `
      <div class="section page-transition">
        <div class="section-header"><h2 class="section-title"><span class="icon"></span>热门排行</h2></div>
        <div class="anime-grid">${renderSkeletonCards(12)}</div>
      </div>
    `;
    try {
      let allAnime = [];
      for (let page = 1; page <= 3; page++) {
        const res = await jikanFetch(`/top/anime?page=${page}&limit=25&filter=bypopularity`);
        if (res.data) allAnime = allAnime.concat(res.data);
        if (!res.pagination || !res.pagination.has_next_page) break;
        if (page < 3) await delay(400);
      }

      dom.app.innerHTML = `
        <div class="section page-transition">
          <div class="section-header"><h2 class="section-title"><span class="icon"></span>热门排行 <span style="font-size:0.6em;color:var(--text-muted);font-weight:400">${allAnime.length} 部</span></h2></div>
          <div class="anime-grid">${allAnime.map((a, i) => renderAnimeCard(a, i)).join('')}</div>
        </div>
      `;
      observeCards();
    } catch (err) {
      dom.app.innerHTML = `<div class="section"><div class="empty-state"><p>加载失败: ${err.message}</p></div></div>`;
    }
  }

  // 详情页
  async function renderDetailPage(id) {
    dom.app.innerHTML = `
      <div class="detail-page page-transition">
        <div class="detail-hero"><div class="skeleton" style="width:100%;height:100%"></div></div>
        <div class="detail-content">
          <div class="detail-poster"><div class="skeleton" style="width:100%;height:340px;border-radius:16px"></div></div>
          <div class="detail-info">
            <div class="skeleton" style="width:60%;height:32px;margin-bottom:12px"></div>
            <div class="skeleton" style="width:40%;height:16px;margin-bottom:20px"></div>
            <div class="skeleton" style="width:100%;height:80px;margin-bottom:20px"></div>
          </div>
        </div>
      </div>
    `;

    try {
      const [detailRes, episodesRes] = await Promise.all([
        jikanFetch(`/anime/${id}/full`),
        jikanFetch(`/anime/${id}/episodes`),
      ]);

      const anime = detailRes.data;
      const episodes = episodesRes.data || [];

      const inWatchlist = state.user ? state.watchlistData.some(w => String(w.anime_id) === String(id)) : false;

      dom.app.innerHTML = `
        <div class="detail-page page-transition">
          <div class="detail-hero">
            <div class="detail-bg" style="background-image:url('${anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || ''}')"></div>
            <div class="detail-bg-overlay"></div>
          </div>
          <div class="detail-content">
            <div class="detail-poster">
              <img src="${anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url}" alt="${anime.title}" loading="lazy">
            </div>
            <div class="detail-info">
              <h1 class="detail-title">
                ${anime.title}
                <span class="detail-title-en">${anime.title_english || anime.title_japanese || ''}</span>
              </h1>
              <div class="detail-meta">
                ${anime.score ? `<div class="detail-meta-tag rating"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${anime.score}</div>` : ''}
                ${anime.type ? `<div class="detail-meta-tag">${anime.type}</div>` : ''}
                ${anime.episodes ? `<div class="detail-meta-tag">${anime.episodes} 集</div>` : ''}
                ${anime.status ? `<div class="detail-meta-tag">${anime.status}</div>` : ''}
                ${anime.year ? `<div class="detail-meta-tag">${anime.year}年</div>` : ''}
                ${anime.season ? `<div class="detail-meta-tag">${({ winter: '冬', spring: '春', summer: '夏', fall: '秋' })[anime.season] || anime.season}季</div>` : ''}
              </div>

              ${anime.genres?.length ? `
                <div class="detail-genres">
                  ${anime.genres.map(g => `<span class="genre-tag">${g.name}</span>`).join('')}
                </div>
              ` : ''}

              <p class="detail-synopsis">${anime.synopsis || '暂无简介'}</p>

              <div class="detail-actions">
                <a href="#/watch?anime=${id}" class="btn-primary" onclick="window.Narumi.openPlayer(${id}, 1, '${(anime.title || '').replace(/'/g, "\\'")}')">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  开始播放
                </a>
                ${state.user ? `
                  <button class="btn-secondary" onclick="window.Narumi.toggleWatchlist(${id}, '${(anime.title || '').replace(/'/g, "\\'")}', '${(anime.images?.jpg?.image_url || '').replace(/'/g, "\\'")}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="${inWatchlist ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    ${inWatchlist ? '已追番' : '追番'}
                  </button>
                ` : `
                  <button class="btn-secondary" onclick="window.Narumi.showAuth()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    登录后追番
                  </button>
                `}
              </div>

              ${anime.trailer?.url ? `
                <div style="margin-top:20px">
                  <a href="${anime.trailer.url}" target="_blank" class="btn-secondary btn-sm" style="text-decoration:none">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    PV / 预告片
                  </a>
                </div>
              ` : ''}
            </div>
          </div>

          ${episodes.length ? `
            <div class="episodes-section">
              <div class="section-header"><h2 class="section-title"><span class="icon"></span>剧集列表</h2></div>
              <div class="episodes-grid">
                ${episodes.map(ep => `
                  <div class="episode-card" onclick="window.Narumi.openPlayer(${id}, ${ep.mal_id}, '${(anime.title || '').replace(/'/g, "\\'")}')">
                    <div class="ep-number">${ep.mal_id}</div>
                    <div class="ep-title">${ep.title || `第${ep.mal_id}集`}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${anime.relations?.length ? `
            <div class="section">
              <div class="section-header"><h2 class="section-title"><span class="icon"></span>相关作品</h2></div>
              <div class="recommendations-row">
                ${anime.relations.filter(r => r.entry?.length).slice(0, 8).map(r => r.entry.slice(0, 3).map(e => `
                  <div class="rec-card" onclick="location.hash='#/anime/${e.mal_id}'">
                    <div class="poster"><div class="skeleton" style="width:100%;height:100%"></div></div>
                    <div class="title">${truncate(e.name, 20)}</div>
                  </div>
                `).join('')).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    } catch (err) {
      dom.app.innerHTML = `<div class="section"><div class="empty-state"><p>加载失败: ${err.message}</p></div></div>`;
    }
  }

  // 追番页
  async function renderWatchlistPage() {
    if (!state.user) {
      dom.app.innerHTML = `
        <div class="section page-transition">
          <div class="watchlist-empty">
            <div class="empty-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <h3>请先登录</h3>
            <p>登录后即可管理你的追番列表</p>
            <button class="btn-primary" onclick="window.Narumi.showAuth()">登录 / 注册</button>
          </div>
        </div>
      `;
      return;
    }

    dom.app.innerHTML = `
      <div class="watchlist-page page-transition">
        <div class="section-header"><h2 class="section-title"><span class="icon"></span>我的追番</h2></div>
        <div class="watchlist-tabs" id="watchlistTabs">
          <button class="watchlist-tab active" data-status="">全部</button>
          <button class="watchlist-tab" data-status="watching">在看</button>
          <button class="watchlist-tab" data-status="completed">看完</button>
          <button class="watchlist-tab" data-status="on_hold">搁置</button>
          <button class="watchlist-tab" data-status="dropped">弃番</button>
          <button class="watchlist-tab" data-status="plan_to_watch">想看</button>
        </div>
        <div id="watchlistContent">
          <div style="text-align:center;padding:40px"><div class="loader-ring small" style="margin:0 auto"><div class="loader-ring-inner"></div></div></div>
        </div>
      </div>
    `;

    // Tab 事件
    $$('#watchlistTabs .watchlist-tab').forEach(tab => {
      tab.addEventListener('click', async () => {
        $$('#watchlistTabs .watchlist-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        await loadWatchlist(tab.dataset.status);
      });
    });

    await loadWatchlist('');
  }

  async function loadWatchlist(status) {
    try {
      const params = status ? `?status=${status}` : '';
      const data = await apiFetch(`/api/user/watchlist${params}`);
      state.watchlistData = data.watchlist || [];
      const container = $('#watchlistContent');

      if (!state.watchlistData.length) {
        container.innerHTML = `
          <div class="watchlist-empty">
            <div class="empty-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </div>
            <h3>还没有追番</h3>
            <p>去发现精彩的日漫吧！</p>
            <a href="#/" class="btn-primary" style="text-decoration:none">去首页看看</a>
          </div>
        `;
        return;
      }

      container.innerHTML = state.watchlistData.map((item, i) => `
        <div class="watchlist-item" style="animation-delay:${i * 0.05}s">
          <div class="poster" onclick="location.hash='#/anime/${item.anime_id}'">
            <img src="${item.anime_image || ''}" alt="${item.anime_title}" loading="lazy">
          </div>
          <div class="info">
            <div class="title" onclick="location.hash='#/anime/${item.anime_id}'">${item.anime_title}</div>
            <div class="meta">
              ${item.status ? `<span>${{ watching: '在看', completed: '看完', on_hold: '搁置', dropped: '弃番', plan_to_watch: '想看' }[item.status] || item.status}</span>` : ''}
              ${item.episodes_watched ? `<span>已看 ${item.episodes_watched} 集</span>` : ''}
              ${item.score ? `<span>评分 ${item.score}</span>` : ''}
            </div>
            <div class="actions">
              <button class="btn-secondary btn-sm" onclick="location.hash='#/anime/${item.anime_id}'">查看详情</button>
              <button class="btn-secondary btn-sm" style="color:#ff6b6b;border-color:rgba(255,107,107,0.2)" onclick="window.Narumi.removeWatchlist('${item.anime_id}')">移除</button>
            </div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      showToast('加载追番列表失败', 'error');
    }
  }

  // ─── 组件渲染 ───

  function renderHero(animeList) {
    if (!animeList || !animeList.length) return '';
    return `
      <div class="hero" id="hero">
        ${animeList.slice(0, 5).map((a, i) => `
          <div class="hero-slide ${i === 0 ? 'active' : ''}" data-index="${i}">
            <div class="hero-bg" style="background-image:url('${a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || ''}')"></div>
            <div class="hero-gradient"></div>
            <div class="hero-content">
              <div class="hero-info">
                <div class="hero-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  TOP ${i + 1}
                </div>
                <h2 class="hero-title">
                  ${a.title}
                  <span class="hero-title-en">${a.title_english || ''}</span>
                </h2>
                <div class="hero-meta">
                  ${a.score ? `<span class="hero-meta-item rating"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${a.score}</span>` : ''}
                  ${a.type ? `<span class="hero-meta-item">${a.type}</span>` : ''}
                  ${a.episodes ? `<span class="hero-meta-item">${a.episodes} 集</span>` : ''}
                </div>
                <p class="hero-synopsis">${a.synopsis || ''}</p>
                <div class="hero-actions">
                  <a href="#/anime/${a.mal_id}" class="btn-primary" style="text-decoration:none">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    详情
                  </a>
                </div>
              </div>
            </div>
          </div>
        `).join('')}
        <div class="hero-dots" id="heroDots">
          ${animeList.slice(0, 5).map((_, i) => `<div class="hero-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>`).join('')}
        </div>
      </div>
    `;
  }

  function renderAnimeCard(anime, index = 0) {
    const title = anime.title || '未知';
    const image = anime.images?.jpg?.image_url || '';
    const score = anime.score;
    const type = anime.type || '';
    const episodes = anime.episodes;

    return `
      <div class="anime-card" style="animation-delay:${Math.min(index * 0.04, 0.5)}s" onclick="location.hash='#/anime/${anime.mal_id}'">
        <div class="poster">
          <img src="${image}" alt="${title}" loading="lazy">
          <div class="poster-overlay"></div>
          <div class="play-hint">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          ${type ? `<div class="card-badge">${type}</div>` : ''}
          ${score ? `<div class="card-score"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${score}</div>` : ''}
        </div>
        <div class="card-info">
          <div class="card-title">${title}</div>
          <div class="card-meta">
            ${episodes ? `<span>${episodes}集</span>` : ''}
            ${anime.year ? `<span class="dot"></span><span>${anime.year}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function renderSkeletonCards(count) {
    return Array.from({ length: count }, () => `
      <div class="skeleton-card">
        <div class="skeleton skeleton-poster"></div>
        <div class="skeleton-info">
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>
      </div>
    `).join('');
  }

  function renderSkeletonHome() {
    return `
      <div class="page-transition">
        <div style="height:520px;background:var(--bg-secondary);position:relative;overflow:hidden">
          <div class="skeleton" style="width:100%;height:100%"></div>
        </div>
        <div class="section">
          <div class="section-header"><div class="skeleton" style="width:160px;height:24px"></div></div>
          <div class="anime-grid">${renderSkeletonCards(10)}</div>
        </div>
        <div class="section">
          <div class="section-header"><div class="skeleton" style="width:120px;height:24px"></div></div>
          <div class="anime-grid">${renderSkeletonCards(10)}</div>
        </div>
      </div>
    `;
  }

  // ─── Hero 滑块 ───
  function initHeroSlider() {
    const hero = $('#hero');
    if (!hero) return;
    const slides = $$('.hero-slide', hero);
    const dots = $$('.hero-dot', hero);
    if (!slides.length) return;

    clearInterval(state.heroTimer);
    state.heroIndex = 0;

    function goTo(index) {
      slides.forEach(s => s.classList.remove('active'));
      dots.forEach(d => d.classList.remove('active'));
      slides[index]?.classList.add('active');
      dots[index]?.classList.add('active');
      state.heroIndex = index;
    }

    state.heroTimer = setInterval(() => {
      goTo((state.heroIndex + 1) % slides.length);
    }, 5000);

    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const idx = parseInt(dot.dataset.index);
        goTo(idx);
        clearInterval(state.heroTimer);
        state.heroTimer = setInterval(() => goTo((state.heroIndex + 1) % slides.length), 5000);
      });
    });
  }

  // ─── 滚动观察动画 ───
  function observeCards() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.animationPlayState = 'running';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    $$('.anime-card').forEach(card => {
      card.style.animationPlayState = 'paused';
      observer.observe(card);
    });
  }

  // ─── 搜索 ───
  let searchDebounce = null;

  function initSearch() {
    dom.searchInput?.addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      const q = e.target.value.trim();
      if (!q) {
        dom.searchResults.innerHTML = `
          <div class="search-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <p>输入关键词开始搜索</p>
          </div>
        `;
        return;
      }

      searchDebounce = setTimeout(() => performSearch(q), 400);
    });

    // 过滤器
    $$('#searchFilters .filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('#searchFilters .filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.searchFilter = chip.dataset.filter;
        if (dom.searchInput.value.trim()) {
          performSearch(dom.searchInput.value.trim());
        }
      });
    });
  }

  async function performSearch(query) {
    state.searchQuery = query;
    dom.searchResults.innerHTML = `
      <div style="text-align:center;padding:40px">
        <div class="loader-ring small" style="margin:0 auto"><div class="loader-ring-inner"></div></div>
        <p style="margin-top:12px;color:var(--text-muted);font-size:0.85rem">搜索中...</p>
      </div>
    `;

    try {
      const filterParam = state.searchFilter !== 'tv' ? `&type=${state.searchFilter}` : '';
      const res = await jikanFetch(`/anime?q=${encodeURIComponent(query)}&limit=20${filterParam}&sfw=true`);
      const results = res.data || [];

      if (!results.length) {
        dom.searchResults.innerHTML = `
          <div class="search-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <p>没有找到相关结果</p>
          </div>
        `;
        return;
      }

      dom.searchResults.innerHTML = results.map((a, i) => `
        <div class="search-result-item" style="animation-delay:${i * 0.05}s" onclick="window.Narumi.closeSearch();location.hash='#/anime/${a.mal_id}'">
          <div class="thumb">
            <img src="${a.images?.jpg?.image_url || ''}" alt="${a.title}" loading="lazy">
          </div>
          <div class="info">
            <div class="title">${a.title}</div>
            <div class="meta">
              ${a.score ? `<span class="rating">★ ${a.score}</span>` : ''}
              ${a.type ? `<span>${a.type}</span>` : ''}
              ${a.episodes ? `<span>${a.episodes}集</span>` : ''}
              ${a.year ? `<span>${a.year}</span>` : ''}
            </div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      dom.searchResults.innerHTML = `<div class="search-placeholder"><p style="color:#ff6b6b">搜索失败: ${err.message}</p></div>`;
    }
  }

  // ─── 播放器 ───
  function openPlayer(animeId, episode, title) {
    dom.playerOverlay.classList.add('show');
    document.body.classList.add('no-scroll');
    $('#playerTitle').textContent = title || '';
    $('#playerEpisodeInfo').textContent = `第 ${episode} 集`;
    $('#playerLoading').style.display = 'flex';

    // 使用嵌入式播放源 (goganime 风格)
    // 注意: 实际使用需要配置可用的流媒体 API
    const iframe = $('#playerFrame');
    iframe.src = '';

    // 尝试获取流媒体信息
    fetch(`${API_BASE}/api/stream/info/${animeId}-episode-${episode}`)
      .then(r => r.json())
      .then(data => {
        if (data.episodes && data.episodes.length) {
          const ep = data.episodes.find(e => parseInt(e.number) === episode) || data.episodes[episode - 1];
          if (ep?.id) {
            return fetch(`${API_BASE}/api/stream/episode/${ep.id}`);
          }
        }
        throw new Error('no_source');
      })
      .then(r => r.json())
      .then(data => {
        if (data.sources && data.sources.length) {
          const source = data.sources.find(s => s.quality === 'default') || data.sources[0];
          if (source?.url) {
            iframe.src = source.url;
            $('#playerLoading').style.display = 'none';
            return;
          }
        }
        throw new Error('no_source');
      })
      .catch(() => {
        // 降级: 使用内嵌浏览器播放
        $('#playerLoading').innerHTML = `
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
          <p>流媒体源暂时不可用</p>
          <p style="font-size:0.75rem;margin-top:4px">可配置 STREAM_API_URL 环境变量接入流媒体 API</p>
        `;
      });

    // 生成剧集按钮
    const episodesHtml = Array.from({ length: Math.min(episode + 5, 24) }, (_, i) => {
      const ep = i + 1;
      return `<div class="player-ep-btn ${ep === episode ? 'active' : ''}" onclick="window.Narumi.openPlayer(${animeId}, ${ep}, '${(title || '').replace(/'/g, "\\'")}')">第 ${ep} 集</div>`;
    }).join('');
    $('#playerEpisodes').innerHTML = episodesHtml;
  }

  function closePlayer() {
    dom.playerOverlay.classList.remove('show');
    document.body.classList.remove('no-scroll');
    $('#playerFrame').src = '';
  }

  // ─── 认证 ───
  function showAuth(tab = 'login') {
    dom.authModal.classList.add('show');
    document.body.classList.add('no-scroll');
    switchAuthTab(tab);
  }

  function hideAuth() {
    dom.authModal.classList.remove('show');
    document.body.classList.remove('no-scroll');
    $('#authError').classList.add('hidden');
  }

  function switchAuthTab(tab) {
    $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const indicator = $('.auth-tab-indicator');
    if (indicator) {
      indicator.style.transform = tab === 'register' ? 'translateX(100%)' : 'translateX(0)';
    }
    $('#loginForm').classList.toggle('hidden', tab !== 'login');
    $('#registerForm').classList.toggle('hidden', tab !== 'register');
    $('#authError').classList.add('hidden');
  }

  async function handleLogin(e) {
    e.preventDefault();
    const btn = $('#loginBtn');
    const span = btn.querySelector('span');
    const loader = btn.querySelector('.btn-loader');

    btn.disabled = true;
    span.style.display = 'none';
    loader.style.display = 'inline-block';

    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          login: $('#loginUsername').value,
          password: $('#loginPassword').value,
        }),
      });

      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('narumi_token', data.token);
      hideAuth();
      showToast('登录成功！欢迎回来', 'success');
      updateUserUI();
      loadWatchlistData();
    } catch (err) {
      const errorEl = $('#authError');
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      span.style.display = '';
      loader.style.display = 'none';
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    const btn = $('#registerBtn');
    const span = btn.querySelector('span');
    const loader = btn.querySelector('.btn-loader');

    btn.disabled = true;
    span.style.display = 'none';
    loader.style.display = 'inline-block';

    try {
      const data = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: $('#regUsername').value,
          email: $('#regEmail').value,
          password: $('#regPassword').value,
        }),
      });

      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('narumi_token', data.token);
      hideAuth();
      showToast('注册成功！欢迎加入 Narumi', 'success');
      updateUserUI();
    } catch (err) {
      const errorEl = $('#authError');
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      span.style.display = '';
      loader.style.display = 'none';
    }
  }

  function handleLogout() {
    state.token = null;
    state.user = null;
    state.watchlistData = [];
    localStorage.removeItem('narumi_token');
    updateUserUI();
    showToast('已退出登录', 'info');
    window.location.hash = '#/';
  }

  async function checkAuth() {
    if (!state.token) return;
    try {
      const data = await apiFetch('/api/auth/me');
      state.user = data.user;
      updateUserUI();
      loadWatchlistData();
    } catch {
      state.token = null;
      state.user = null;
      localStorage.removeItem('narumi_token');
    }
  }

  async function loadWatchlistData() {
    if (!state.user) return;
    try {
      const data = await apiFetch('/api/user/watchlist');
      state.watchlistData = data.watchlist || [];
    } catch { /* ignore */ }
  }

  function updateUserUI() {
    const avatarBtn = dom.userAvatarBtn;
    const avatar = $('#userAvatar');

    if (state.user) {
      if (state.user.avatar_url) {
        avatar.innerHTML = `<img src="${state.user.avatar_url}" alt="${state.user.username}">`;
      } else {
        avatar.innerHTML = state.user.username[0].toUpperCase();
      }
      dom.dropdownContent.innerHTML = `
        <div class="dropdown-user-info">
          <div class="name">${state.user.username}</div>
          <div class="email">${state.user.email || ''}</div>
        </div>
        <button class="dropdown-item" onclick="location.hash='#/watchlist';window.Narumi.closeDropdown()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          我的追番
        </button>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item danger" onclick="window.Narumi.logout()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          退出登录
        </button>
      `;
    } else {
      avatar.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
      dom.dropdownContent.innerHTML = `
        <button class="dropdown-item" onclick="window.Narumi.showAuth('login');window.Narumi.closeDropdown()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
          登录
        </button>
        <button class="dropdown-item" onclick="window.Narumi.showAuth('register');window.Narumi.closeDropdown()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          注册
        </button>
      `;
    }
  }

  // ─── 追番管理 ───
  async function toggleWatchlist(animeId, title, image) {
    if (!state.user) { showAuth(); return; }

    const existing = state.watchlistData.find(w => String(w.anime_id) === String(animeId));
    if (existing) {
      await removeWatchlist(animeId);
    } else {
      try {
        await apiFetch('/api/user/watchlist', {
          method: 'POST',
          body: JSON.stringify({
            anime_id: animeId,
            anime_title: title,
            anime_image: image,
            status: 'plan_to_watch',
          }),
        });
        state.watchlistData.push({ anime_id: animeId, anime_title: title });
        showToast('已添加到追番列表', 'success');
        // 刷新详情页按钮
        const { path } = getRoute();
        if (path.startsWith('/anime/')) {
          renderDetailPage(path.split('/anime/')[1]);
        }
      } catch (err) {
        showToast('操作失败: ' + err.message, 'error');
      }
    }
  }

  async function removeWatchlist(animeId) {
    try {
      await apiFetch(`/api/user/watchlist/${animeId}`, { method: 'DELETE' });
      state.watchlistData = state.watchlistData.filter(w => String(w.anime_id) !== String(animeId));
      showToast('已从追番列表移除', 'info');
      // 如果在追番页，刷新
      const { path } = getRoute();
      if (path === '/watchlist') {
        loadWatchlist('');
      } else if (path.startsWith('/anime/')) {
        renderDetailPage(path.split('/anime/')[1]);
      }
    } catch (err) {
      showToast('操作失败: ' + err.message, 'error');
    }
  }

  // ─── 事件绑定 ───
  function bindEvents() {
    // 路由
    window.addEventListener('hashchange', navigate);

    // 搜索
    $('#searchToggle')?.addEventListener('click', () => {
      dom.searchPanel.classList.add('show');
      dom.searchInput.focus();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (dom.searchPanel.classList.contains('show')) {
          dom.searchPanel.classList.remove('show');
        } else if (dom.authModal.classList.contains('show')) {
          hideAuth();
        } else if (dom.playerOverlay.classList.contains('show')) {
          closePlayer();
        }
      }
      // Ctrl/Cmd + K 搜索
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        dom.searchPanel.classList.toggle('show');
        if (dom.searchPanel.classList.contains('show')) dom.searchInput.focus();
      }
    });

    // 关闭搜索 (点击背景)
    dom.searchPanel?.addEventListener('click', (e) => {
      if (e.target === dom.searchPanel) {
        dom.searchPanel.classList.remove('show');
      }
    });

    // 用户菜单
    dom.userAvatarBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.userDropdown.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      dom.userDropdown?.classList.remove('show');
    });

    // 移动端菜单
    $('#mobileMenuToggle')?.addEventListener('click', () => {
      dom.mobileMenu.classList.add('show');
      $('#mobileMenuToggle').classList.add('active');
      document.body.classList.add('no-scroll');
    });

    $('#mobileMenuClose')?.addEventListener('click', closeMobileMenu);
    $('.mobile-menu-backdrop')?.addEventListener('click', closeMobileMenu);

    $$('.mobile-nav-link').forEach(link => {
      link.addEventListener('click', closeMobileMenu);
    });

    // 导航栏滚动效果
    let lastScroll = 0;
    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;
      dom.navbar.classList.toggle('scrolled', scrollY > 20);
      lastScroll = scrollY;
    }, { passive: true });

    // Auth
    $$('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
    });

    $('#loginForm')?.addEventListener('submit', handleLogin);
    $('#registerForm')?.addEventListener('submit', handleRegister);
    $('#authClose')?.addEventListener('click', hideAuth);
    $('#authBackdrop')?.addEventListener('click', hideAuth);

    // 播放器
    $('#playerBack')?.addEventListener('click', closePlayer);

    // 搜索初始化
    initSearch();
  }

  function closeMobileMenu() {
    dom.mobileMenu.classList.remove('show');
    $('#mobileMenuToggle')?.classList.remove('active');
    document.body.classList.remove('no-scroll');
  }

  // ─── 全局 API ───
  window.Narumi = {
    showAuth,
    closeSearch: () => dom.searchPanel.classList.remove('show'),
    closeDropdown: () => dom.userDropdown.classList.remove('show'),
    logout: handleLogout,
    openPlayer,
    closePlayer,
    toggleWatchlist,
    removeWatchlist,
  };

  // ─── 启动 ───
  async function init() {
    bindEvents();
    await checkAuth();
    await navigate();

    // 隐藏加载动画
    await delay(600);
    dom.loader.classList.add('hidden');
  }

  // 开始
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
