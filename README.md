# Narumi - 日漫追番

基于 **Cloudflare Workers + D1 + KV** 构建的日漫追番平台，通过 **GitHub Actions** 自动部署。Push 到 `main` 分支即自动上线。

## ✨ 功能特性

- **日漫专精** — 仅收录日本动画（TV / 剧场版 / OVA / ONA / 特别篇）
- **智能搜索** — 实时搜索 + 类型过滤，数据源 MyAnimeList
- **番剧播放** — 支持接入 Consumet 等流媒体 API
- **追番管理** — 在看 / 看完 / 搁置 / 弃番 / 想看 多状态
- **用户系统** — 注册 / 登录 + GitHub OAuth 一键登录
- **观看历史** — 自动记录观看进度
- **精美 UI** — 暗色毛玻璃 + 流畅动画，桌面 / 平板 / 手机全适配

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Cloudflare Workers |
| 前端 | Vanilla JS SPA + CSS3 |
| 数据库 | Cloudflare D1 |
| 缓存 | Cloudflare KV |
| 数据 | Jikan (MyAnimeList) API |
| 认证 | JWT + GitHub OAuth |
| 部署 | GitHub Actions → Wrangler |

## 📁 项目结构

```
narumi/
├── .github/workflows/
│   ├── deploy.yml        # Push 自动部署
│   └── setup.yml         # 一次性初始化云资源
├── worker.js             # Worker 后端
├── wrangler.toml         # Cloudflare 配置
├── schema.sql            # D1 数据库建表
├── scripts/set-secrets.sh# GitHub Secrets 写入脚本
└── public/               # 前端静态资源
```

## ⚠️ 部署注意

部署需要配置以下 GitHub Secrets（`Settings → Secrets → Actions`）：

`CLOUDFLARE_API_TOKEN` · `CLOUDFLARE_ACCOUNT_ID` · `D1_DATABASE_ID` · `KV_NAMESPACE_ID` · `GITHUB_CLIENT_ID` · `GITHUB_CLIENT_SECRET` · `JWT_SECRET`

首次部署请先运行 `setup.yml` 工作流生成 D1 / KV 资源 ID。

## 🔀 后续更新

每次 `git push origin main` 自动重新部署。

## 📄 License

MIT
