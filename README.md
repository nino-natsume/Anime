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

打开 GitHub 仓库 → **Actions** → **Manual Deploy (手动部署 · 输入 Secret 即可)** → **Run workflow**，在弹出的表单里填入 Secret 值：

| 表单字段 | 类型 | 说明 |
|----------|------|------|
| `CLOUDFLARE_ACCOUNT_ID` | 文本 | Cloudflare 账户 ID（必填） |
| `CLOUDFLARE_API_TOKEN` | 密文 | Cloudflare API Token（必填，自动打码） |
| `D1_DATABASE_ID` | 文本 | D1 数据库 ID（必填） |
| `KV_NAMESPACE_ID` | 文本 | KV 命名空间 ID（必填） |
| `SITE_URL` | 文本 | 站点地址（可选） |
| `CLIENT_ID` | 文本 | GitHub OAuth Client ID（必填） |
| `CLIENT_SECRET` | 密文 | GitHub OAuth Client Secret（必填，自动打码） |
| `JWT_SECRET` | 密文 | JWT 签名密钥（必填，自动打码） |
| `STREAM_API_URL` / `STREAM_ANIKOTO_URL` | 文本 | 参考[AniKotoAPI](https://github.com/Shineii86/AniKotoAPI)，部署后填入 |

点击 Run 后 **Actions**即可

## Android APK

GitHub Actions 自动构建，见 `android/README.md`。

可在 Release 内下载

## License

MIT
