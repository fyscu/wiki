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
