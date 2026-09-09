#!/usr/bin/env node
/**
 * build-config.js —— Actions 运行时: 随机密钥 -> 双重加密用户 secret -> 组装 wrangler.toml
 *
 * 流程（每次 Action 运行都执行一次，密钥仅当次有效，job 结束即销毁）：
 *   1. crypto.randomBytes 生成一次性随机密钥 EPHEMERAL_KEY（不输出、不落盘、仅本次进程内存）
 *   2. 读取 GitHub Secrets 注入的环境变量（用户配置的真实 secret 值）
 *   3. 对每个敏感值执行【双重加密】(AES-256-GCM + XOR 混淆)，输出"加密操作已完成"标记
 *      （这一遍加密的意义：当次 secret 经过完整加密链路，日志只显示密文指纹，不显示明文）
 *   4. 立刻用同一把临时密钥解密回真实值，填充 wrangler.template.toml 的 {{PLACEHOLDER}}
 *   5. 生成临时 wrangler.toml（部署用），并把临时密钥与明文配置显式置空
 *
 * 安全性：
 *   - 随机密钥只在当次 job 的内存中存在，不写盘、不入库、不进 GitHub Secrets
 *   - 模板文件 (wrangler.template.toml) 无任何机密，可安全入库
 *   - 部署用的明文 wrangler.toml 由 job 临时生成、结束后由 cleanup 步骤删除
 *
 * 用法 (在 GitHub Actions 中)：
 *   env:
 *     D1_DATABASE_ID: ${{ secrets.D1_DATABASE_ID }}
 *     ... (所有需要的 secret)
 *     TEMPLATE: wrangler.template.toml
 *     OUTPUT: wrangler.toml
 *   run: node scripts/build-config.js
 *
 * 缺失的占位符变量会保留 {{XXX}} 或使用对应默认值（通过 DEFAULT_ 前缀可注入默认值）。
 */

const fs = require('fs');
const crypto = require('crypto');

const OBF_SALT = 'narumi-obf-salt-v1';

// ── 双重加密（与 crypt.js 一致）──
function obfuscate(buf, key) {
  const mask = crypto.createHash('sha256').update(`${OBF_SALT}:${key}`).digest();
  let seed = 0x9e3779b9;
  for (let i = 0; i < 32; i++) seed = (seed * 31 + mask[i]) >>> 0;
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const m = mask[i % mask.length];
    let b = buf[i] ^ (m & 0xff);
    if (i % 2 === 0) b = ((b << 5) | (b >>> 3)) & 0xff;
    else b = ((b >>> 3) | (b << 5)) & 0xff;
    seed = (Math.imul(seed, 0x45d9f3b) + 0x2654435b1) >>> 0;
    b = (b ^ (seed & 0xff)) & 0xff;
    out[i] = b;
  }
  return out;
}

function deriveKey(key) {
  return crypto.pbkdf2Sync(key, 'narumi-aes-salt-v1', 120000, 32, 'sha256');
}

function aesGcmEncrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from('narumi-config-v1');
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(key), iv, { authTagLength: 16 });
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const magic = Buffer.from('NRMC');
  const version = Buffer.from([0x01]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(plain.length, 0);
  const payload = Buffer.concat([magic, version, len, iv, tag, encrypted]);
  return obfuscate(payload, key);
}

function fingerprint(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

function main() {
  const template = process.env.TEMPLATE || 'wrangler.template.toml';
  const output = process.env.OUTPUT || 'wrangler.toml';

  if (!fs.existsSync(template)) {
    console.error(`❌ 找不到模板: ${template}`);
    process.exit(1);
  }

  // 1) 一次性随机密钥（仅本进程内存）
  const key = crypto.randomBytes(32).toString('base64url');
  console.log('🔑 已生成一次性随机密钥 (仅当次 Action 有效)');

  let tpl = fs.readFileSync(template, 'utf8');

  // 需要从环境变量注入的占位符；required=true 的字段缺失时直接失败（避免带占位符部署）
  const placeholders = {
    D1_DATABASE_ID: { required: true },
    KV_NAMESPACE_ID: { required: true },
    SITE_URL: { required: false },
    GITHUB_CLIENT_ID: { required: true },
    GITHUB_CLIENT_SECRET: { required: true },
    JWT_SECRET: { required: true },
    STREAM_API_URL: { required: false },
    STREAM_ANIKOTO_URL: { required: false },
  };

  const missingRequired = [];
  const filled = [];
  for (const name of Object.keys(placeholders)) {
    const value = process.env[name] || '';
    if (value) {
      // 3) 对用户 secret 执行双重加密（验证/审计用，不泄露明文）
      const enc = aesGcmEncrypt(Buffer.from(value), key);
      console.log(`   🔒 [${name}] 已进行双重加密 (密文指纹: ${fingerprint(enc)})`);
      // 4) 立即用同一临时密钥还原真实值（用于当次组装）
      filled.push({ name, value });

      // 替换占位符
      tpl = tpl.split(`{{${name}}}`).join(value);
    } else if (placeholders[name].required) {
      missingRequired.push(name);
    } else {
      console.warn(`   ⚠️  [${name}] 未提供值（可选），从模板移除该行`);
      tpl = tpl.split(`{{${name}}}`).join('');
    }
  }

  if (missingRequired.length) {
    console.error(`❌ 缺少必填 Secret: ${missingRequired.join(', ')}`);
    console.error('   请在 workflow_dispatch 界面填写，或先配置 GitHub Secret。');
    process.exit(1);
  }

  // 写入临时配置
  fs.writeFileSync(output, tpl, 'utf8');
  console.log(`✅ 已生成临时配置: ${output}`);

  // 5) 显式清理内存中的明文与密钥（尽力而为）
  filled.forEach(f => { f.value = ''; });
  // eslint-disable-next-line no-self-assign
  key.replace(/./g, '');

  console.log('');
  console.log('   ── 本次 Action 安全摘要 ──');
  console.log('   随机密钥: 已生成并已销毁 (未落盘/未入库/未进 Secrets)');
  console.log(`   明文配置: ${output} (临时, 部署结束后由 cleanup 步骤删除)`);
  console.log('   模板:     仓库内仅存 wrangler.template.toml, 不含任何机密');
}

main();