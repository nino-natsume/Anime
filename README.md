# Narumi

有问题才维护，小问题将就用

## 功能

- 日漫专精（TV / 剧场版 / OVA / ONA / 特别篇）
- Bangumi 智能搜索 + 流媒体播放（AniKoto / Consumet）
- 追番管理（在看 / 看完 / 搁置 / 弃番 / 想看）
- 用户系统（注册 / 登录 / GitHub OAuth）
- 暗色毛玻璃 UI，全端适配

## 部署

**无需配置 GitHub Secrets**，所有配置在 Actions 界面填写即可。

### 部署站点

打开 GitHub 仓库 → **Actions** → **Manual Deploy (手动部署 · 输入 Secret 即可)** → **Run workflow**，在弹出的表单里填入配置值：

[Oauth相关](https://github.com/settings/developers) ，下表图例：`*`：必填 `/`：选填 `-`：建议填

| 表单字段 |  | 说明 |
|----------|------|------|
| `CLOUDFLARE_ACCOUNT_ID` | * | Cloudflare 账户 ID |
| `CLOUDFLARE_API_TOKEN` | * | Cloudflare API Token |
| `D1_DATABASE_ID` | * | D1 数据库 ID |
| `KV_NAMESPACE_ID` | * | KV 命名空间 ID |
| `SITE_URL` | / | 站点地址 |
| `CLIENT_ID` | - | GitHub OAuth Client ID |
| `CLIENT_SECRET` | - | GitHub OAuth Client Secret |
| `JWT_SECRET` | * | JWT 签名密钥 |
| `STREAM_API_URL` / `STREAM_ANIKOTO_URL` | / | 参考[AniKotoAPI](https://github.com/Shineii86/AniKotoAPI)，部署后填入 |

点击 Run 后等待 Actions 完成即可。

### 重置数据库

打开 GitHub 仓库 → **Actions** → **D1 Reset (清空数据库)** → **Run workflow**，填入：

| 表单字段 | 类型 | 说明 |
|----------|------|------|
| `CLOUDFLARE_ACCOUNT_ID` | 文本 | Cloudflare 账户 ID（必填） |
| `CLOUDFLARE_API_TOKEN` | 密文 | Cloudflare API Token（必填，自动打码） |
| `D1_DATABASE_ID` | 文本 | D1 数据库 ID（必填） |
| `confirm` | 文本 | 输入 `RESET` 确认清空 |

## Android APK

GitHub Actions 自动构建，可在 [Release](https://github.com/nino-natsume/Anime/releases) 内下载

## License

MIT
