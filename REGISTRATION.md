# 账号与邮件

## 账号规则

登录支持邮箱或用户名，实际用户名可在右上角用户菜单查看。注册后须验证邮箱才能发布内容，邮箱也用于密码找回。

验证和重置链接有效期为 10 分钟，使用后失效；重发会替换旧链接。管理员通过 `/review/` 审核首帖。

| 页面 | 路径 |
| --- | --- |
| 登录、注册 | `/login/`、`/register/` |
| 邮箱验证 | `/users/account-activation/` |
| 密码重置 | `/users/password-reset/` |
| 邮件退订 | `/users/unsubscribe/`，点击确认后生效 |

初始化管理员为 `feiyang-admin`，登录邮箱为 `wiki-admin@feiyang.local`。密码位于 `runtime/credentials.json` 的 `admin_password`。

## 飞书 SMTP

| 配置 | 值 |
| --- | --- |
| 发件邮箱 | `noreply@feiyang.ac.cn` |
| 主机 | `smtp.feishu.cn` |
| 端口与加密 | `465`、SSL |
| 认证 | 完整邮箱地址和客户端专用密码 |
| 本机配置 | `runtime/smtp.feishu.json` |

配置模板见 [smtp.example.json](deploy/smtp.example.json)，参数说明见 [飞书文档](https://www.feishu.cn/hc/zh-CN/articles/221905160046)。

专用密码由邮箱管理员或成员生成：

- 公共邮箱：管理后台 → 产品设置 → 邮箱 → 地址管理 → 公共邮箱 → 编辑 → 开启 IMAP/SMTP 服务。
- 成员邮箱：客户端设置 → 邮箱 → 第三方邮箱客户端登录 → 立即设置。

将配置填入 `runtime/smtp.feishu.json`，通过 9080 SSH 转发执行：

```powershell
# 校验配置
node scripts/configure-smtp.mjs --config runtime/smtp.feishu.json
# 保存配置
node scripts/configure-smtp.mjs --config runtime/smtp.feishu.json --apply
```

发送测试邮件时追加 `--test-recipient <收件邮箱>`，随后核对收件箱和服务器发送日志。

域名 SPF 已配置为 `v=spf1 +include:_netblocks.m.feishu.cn -all`。调整时合并现有 SPF；DKIM 使用飞书提供的记录值，DMARC 按域名发信策略配置。

## 注册开关

确认邮件投递后开启注册：

```powershell
node scripts/set-registration.mjs --enable
```

关闭时使用 `--disable`。脚本同步后台注册设置与正式站的 `account-status.json`、`mail-gate.conf`，保留邮箱验证要求，并在检查失败时回退。

## 实现与测试

用户名登录沿用 `e_mail` 请求字段，复用 Answer 的密码校验、账号状态检查和会话签发；补丁见 `patches/answer-username-login.patch`。登录会清理前后空白，并兼容注册时生成的小写用户名。

通知链接规则位于 `lib/answer-links.mjs`。发送接口按 IP 限流；图形验证码界面随后台插件状态显示。

`npm run test:mail` 使用独立 SQLite 实例和本机 SMTP 收件器，覆盖登录、邮箱验证、密码重置、通知链接及退订。测试地址使用 `@wiki-mail.test`。

## 统一登录（2026-11-13，影子验证通过，待上线）

登录页新增「云上飞扬统一登录」入口，提供三种方式：云上飞扬扫码（复用 `qrlogin_*`）、邮箱验证码（复用 `emailsend.php` / `emaillogin.php`）、Wiki 账户密码（沿用本页原生登录）。前两种走标准 OAuth2 授权码，由 Answer 官方 `connector-basic` 插件完成建号/绑定与会话签发；本仓不签发 Answer token、不改 Answer Go 源码。

**组件**

| 位置 | 职责 |
| --- | --- |
| `lib/sso-core.mjs` | 票据/断言/授权码的 HMAC 签名、定长填充防枚举、`state` 原样回传 |
| `scripts/sso-provider.mjs` | OAuth2 Provider：`/authorize`、`/api/*`、`/token`、`/userinfo` |
| `scripts/sso-login-page.mjs` | 自包含统一登录页（无外部资源、无构建步骤） |
| `community/AuthLanding.vue` | 接 `/users/auth-landing/?access_token=` 落地会话 |
| `deploy/sso-connector.conf.example` | nginx 白名单（放行 connector 三条路径 + `sso` 子域） |
| `scripts/build-answer-sso.ps1` | 在队友 login 补丁构建的镜像里补编官方 connector 插件 |
| `scripts/bind-existing-users.sh` | 上线前把存量 Wiki 账号预绑定主表 uid（dry-run 默认） |

配置复制 `sso.config.example.json` 为 `sso.local.json`（已 gitignore）。foc 侧新增 `v1/sso/lookup.php`、`v1/sso/identity.php`，凭据走 `utils/sso.local.php`（`*.local.php` 已忽略）。

**顺序（不可颠倒）**

1. 影子验证：`node --test tests/sso-core.test.mjs tests/sso-provider.test.mjs`（16 项）+ 物理机影子库/影子 PHP 端点联调 + 真实进程模拟 Go `oauth2` 客户端（15 项）。
2. 构建带 `connector-basic` 的二进制，`<binary> plugin` 必须同时列出 `basic_reviewer` 与 connector；用 `scripts/deploy-answer-login.py --sha256 <hash>` 先 `--` 建镜像、再 `--activate` 换容器（脚本自带备份与回滚）。
3. `scripts/bind-existing-users.sh` 先 dry-run 再 `--apply`：存量用户没有 `user_external_login` 记录时，Answer 的 `ExternalLogin` 会因邮箱已存在直接拒绝。
4. 后台启用 connector 并填 `sso.config.example.json` 注释里的字段；`check_email_verified=true`、`email_verified_json_path=email_verified`。
5. 加 `sso.feiyang.ac.cn` 的 DNS 与 server 块（通配证已覆盖），放开 nginx 白名单，起 Provider 服务。
6. 用真实账号走三种方式各一次；异常时停用 connector 即回到原有密码登录，无需回滚数据。

**安全边界**：账号探测响应结构与长度恒定，真实命中结果只进 HMAC 票据；扫码/邮箱码验证后强制核对「foc 账号邮箱 === 票据锁定邮箱」，防止 A 填邮箱、B 扫码顶号；`external_id` 一律用主表 uid。
