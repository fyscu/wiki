# 正式部署与运维

2026-09-07：正式入口为 https://wiki.feiyang.ac.cn/，A 记录指向 `45.40.247.178`，TTL 600。使用 OI Wiki 原主题，问答和审核位于同一域名。

## 当前功能

公开文章、中文搜索和已审核问答可直接阅读。已有账号可登录、提问、互相回答、讨论、投票和采纳；管理员在 `/review/` 审核。当前审核策略为首帖先审。

飞书 SMTP 已配置，用户已确认测试邮件进入 Gmail 收件箱。自助注册、重发验证和邮件找回已开放，邮箱验证保持必需。注册、激活与重置流程已通过隔离 SMTP 收信测试，开放后的 4 项桌面/手机账号入口及权限检查通过；详见 `REGISTRATION.md`。

## 运行位置

| 资源 | 位置 |
| --- | --- |
| 正式站点 | `/opt/1panel/apps/openresty/openresty/www/sites/wiki.feiyang.ac.cn` |
| 当前静态版本 | 站点目录的 `index` 符号链接，指向 `releases/mkdocs-<hash>` |
| Nginx 主配置 | `/opt/1panel/apps/openresty/openresty/conf/conf.d/feiyang-wiki-production.conf` |
| 同域 API 白名单 | 站点目录的 `community-api.conf` |
| 邮件接口开关 | 站点目录的 `mail-gate.conf`，当前已移除邮件接口拦截 |
| 页面邮件状态 | 站点目录的 `account-status.json`，当前 `mail_ready=true` |
| Answer | `/opt/feiyang-wiki/compose.yaml`，容器 `feiyang-wiki-answer`，回环端口 9080 |
| 数据库 | 现有 MySQL 容器内的独立库 `feiyang_wiki_qa` |
| 发布备份 | `/opt/feiyang-wiki/backups/production-<UTC时间>`，仅 root 可读 |
| 本机管理员凭据 | `runtime/credentials.json`，不进入 Git 或静态产物 |

## 发布

本机执行 `npm run build`、`npm test`、`node scripts/nginx-api.mjs`、`node scripts/package-site.mjs`。将以下文件传到 `/var/tmp/feiyang-wiki-bootstrap/`：

- `.cache/wiki-dist.tar.gz`
- `deploy/wiki-production.conf`、`deploy/community-api-production.conf`
- `deploy/feiyang-wiki-certificate.service`、`deploy/feiyang-wiki-certificate.timer`、`deploy/feiyang-wiki.logrotate`
- `scripts/publish-production.py`、`scripts/sync-wiki-certificate.py`

服务器执行 `sudo python3 /var/tmp/feiyang-wiki-bootstrap/publish-production.py`。脚本先备份 Wiki 数据库和配置数据，再建立独立静态版本，执行 `nginx -t` 后平滑 reload。不会重启 Answer、MySQL 或其他业务容器；配置检查失败自动恢复原配置和版本链接。

`scripts/configure-production.mjs --apply` 仅用于首次上线或明确需要关闭注册时：它更新 Answer 正式 URL，并关闭注册；SMTP 后续开放后不要在常规静态发布中重复执行它。

## 证书与日志

证书来自 1Panel 管理的通配符证书 ID 4，覆盖 `*.feiyang.ac.cn`，本次证书有效期至 2026-11-10。私钥只存放在服务器站点的受保护 `ssl/` 目录。

`feiyang-wiki-certificate.timer` 每日同步 1Panel 已续期的证书，检查域名、有效期和密钥匹配，然后通过 Nginx 检查再 reload。证书签发和续期仍由 1Panel 管理；同步失败可用 `journalctl -u feiyang-wiki-certificate.service` 查看，不要打印私钥。

Wiki 访问日志不记录查询字符串，避免保存邮件验证代码。`/etc/logrotate.d/feiyang-wiki` 每日检查轮转，保留 14 份并压缩；单日志超过 20 MiB 时在下一次 logrotate 检查时轮转。Answer Docker 日志限制为 10 MiB × 3。

## 注册邮件配置

配置模板见 `deploy/smtp.example.json`。实际配置放在受保护的 `runtime/smtp.json` 或服务器 root 私有目录，不要放进 `docs/`。需要发件邮箱、SMTP 主机、端口、加密方式、用户名和客户端授权密码；465 通常使用 SSL，587 通常使用 TLS，最终以邮箱服务商文档为准。

当前根域 MX 使用飞书邮箱，SPF 已包含飞书发件授权。已核实 SMTP 为 `smtp.feishu.cn:465`（SSL），服务器 TLS 连接及认证正常；发件邮箱为 `noreply@feiyang.ac.cn`，专用密码通过受保护配置保存。未修改邮箱 DNS 记录，已按用户指定的收件人发送一封外部测试邮件。

接入顺序：

1. 通过 SSH 转发的内部 Answer 管理接口 `PUT /answer/admin/api/setting/smtp` 写入模板对应字段，使用管理员 Bearer token。密码不写入命令参数或日志。
2. 使用用户指定的测试收件人验证真实投递，再检查发件域的 SPF/DKIM/DMARC 和垃圾邮件归类。
3. 确认 `site_url=https://wiki.feiyang.ac.cn`，验证 `/users/account-activation?code=...` 与 `/users/password-reset?code=...` 的完整流程；反复尝试触发的验证码流程也须联调。
4. 验证完成后再开启后台 `allow_new_registrations`、`allow_email_registrations`，保持 `require_email_verification=true`。
5. 同步将正式站点 `account-status.json` 的 `mail_ready` 设置为 true，清空 `mail-gate.conf` 的拦截指令，经 `nginx -t` 后 reload。

## 验证与恢复

用户名登录版本：静态站 `mkdocs-b3bf6c13fdf2`，后端 `feiyang/answer-runtime:2.0.2-login-b43aa249b983`。已验证管理员用户名和邮箱登录对应同一个账号，审核插件、SMTP 和注册设置保留。此次仅重建 Wiki Answer 容器，其他业务容器未重启。最终通过 20 项正式站浏览器回归、8 项隔离认证/邮件流程、12 项 JavaScript 单元测试及 Go 登录/注册策略测试。

本次注册模块发布版本为 `mkdocs-fc94421ae1a9`。10 项单元测试、8 项正式站桌面/手机浏览器测试及 2 项隔离邮件流程测试全部通过；正式站验证使用正常 DNS 解析和 TLS 校验。覆盖公开阅读、搜索、登录退出、问题审核、普通用户回答审核、管理员回答、讨论、投票、采纳、文章回链、越权拒绝、注册开关以及邮件激活与重置。桌面和手机截图已检查。

通知链接修复版本为 `mkdocs-0fad31ec276a`：补齐 Answer 原生问题/回答地址兼容及退订页面，链接指向的回答即使不在首页也会按 ID 加载，并检查所属问题。验证通过 12 项单元测试、12 项正式站账号与通知路由浏览器测试，以及 2 项隔离通知邮件及退订流程测试。用户提供的实际问题和回答已在桌面、手机只读验证，未改动其内容或订阅。

设置 `WIKI_BASE_URL=https://wiki.feiyang.ac.cn` 后执行 `npm run test:e2e`。桌面和手机测试会创建明确标识的测试账号与内容，并在结束时软删除。DNS 缓存更新前可额外设置 `WIKI_TEST_ADDRESS=45.40.247.178`，仅覆盖测试进程解析，不跳过 TLS 校验，也不修改本机 hosts。

静态回滚可依据备份的 `previous-release.txt` 恢复 `index` 符号链接，同时恢复同次备份的 Nginx/API 配置，检查后 reload。数据库恢复只针对 `feiyang_wiki_qa`，需要先确认备份后产生的数据；静态发布回退通常不需要恢复数据库。

当前备份为每次发布前的本机磁盘备份，尚未配置异机备份和完整恢复演练。

## 后端构建与回退

用户名登录补丁及 Go 测试保存在 `patches/answer-username-login.patch`，源码基准和 Linux 二进制校验值记录于 `upstream.lock.json`。`scripts/build-answer-login.ps1 -TargetOS windows` 生成本机测试程序；`-TargetOS linux` 生成 Linux 程序及 `.cache/answer-runtime-login.tar.gz`。

将运行镜像构建包和 `scripts/deploy-answer-login.py` 放到服务器引导目录后，先执行脚本的 `--sha256 <完整摘要>` 模式封装镜像并检查审核插件；测试通过后追加 `--activate` 切换。脚本会备份 Wiki 库、数据目录和 Compose，再只替换 `answer` 服务，确认登录及插件设置未改变；启动或检查失败自动恢复原镜像配置。

本次后端升级备份为 `/opt/feiyang-wiki/backups/username-login-20260907T124115Z`，原镜像 `feiyang/answer-runtime:2.0.2-reviewer` 仍保留。由于无数据库结构变更，回退后端通常只需恢复该备份中的 Compose 并重建 Wiki Answer 容器，不应覆盖升级后用户产生的数据。旧后端不支持用户名，回退时还应切换到旧版登录页面。
