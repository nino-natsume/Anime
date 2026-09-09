# Narumi - 日漫追番

Cloudflare Workers + D1 + KV 构建的日漫追番平台，Push 自动部署。

## 功能

- 日漫专精（TV / 剧场版 / OVA / ONA / 特别篇）
- Bangumi 智能搜索 + 流媒体播放（AniKoto / Consumet）
- 追番管理（在看 / 看完 / 搁置 / 弃番 / 想看）
- 用户系统（注册 / 登录 / GitHub OAuth）
- 暗色毛玻璃 UI，全端适配

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Cloudflare Workers |
| 前端 | Vanilla JS SPA |
| 数据库 | Cloudflare D1 |
| 缓存 | Cloudflare KV |
| 数据 | Bangumi API |
| 认证 | JWT + GitHub OAuth |

## 部署

配置 GitHub Secrets 后 Push 到 `main` 即自动部署。

`CLOUDFLARE_API_TOKEN` · `CLOUDFLARE_ACCOUNT_ID` · `D1_DATABASE_ID` · `KV_NAMESPACE_ID` · `GITHUB_CLIENT_ID` · `GITHUB_CLIENT_SECRET` · `JWT_SECRET`

首次部署先运行 `setup.yml` 生成 D1 / KV 资源 ID。

## Android APK

`android/` 为 WebView 封装（零白屏启动）。GitHub Actions 自动构建，见 `android/README.md`。

## License

MIT
