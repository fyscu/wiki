# 飞扬 Wiki

基于 **OI Wiki 的 MkDocs / Material 主题**，将文档、问答、登录、提问、回答和审核放在同一站点中。Answer 是内部后台，不再作为第二个前台入口。

## 访问

- 代码与文章仓库：https://github.com/fyscu/wiki
- 正式站点：https://wiki.feiyang.ac.cn/
- 服务器统一预览：http://127.0.0.1:9081/
- 本机开发：http://127.0.0.1:5173/
- 问答位于统一站点的 `/questions/`，提问为 `/ask/`，登录为 `/login/`，审核为 `/review/`。

正式站点已启用 HTTPS、自助注册及邮件找回。飞书 SMTP 已配置，测试邮件已由用户确认进入 Gmail 收件箱。新用户须验证邮箱后才能发布内容。9080/9081 仅通过 SSH 私有访问，9080 是内部 Answer 接口地址。

管理员凭据位于 `runtime/credentials.json`，已加入 Git 忽略并限制本机访问权限。不要复制进文档或构建产物。

## 复用边界

OI Wiki 原主题固定在 `b80fbeb86b02065fcfdc4ffe74f2cbbb577121f6`，模板和样式位于 `vendor/oi-material`。我们没有重写 Wiki 布局，来源和许可见 `THIRD_PARTY.md` 与 `upstream.lock.json`。

主题默认的 OI 搜索服务改为 Material 9.6.15 的标准本地搜索。其余覆盖集中在标识、署名、站内问答挂载点和自托管字体。

## 安装与开发

需要 Python 3.12、Node.js 24、npm、Git；连接服务器时还需要 OpenSSH。

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
npm ci
npm run dev
```

`npm run dev` 编译社区组件和 MkDocs，然后在 5173 提供统一页面与 API 代理。静态页面和搜索无需生产凭据；问答接口默认连接本机 9080。文件修改后自动重建，刷新浏览器查看。有服务器访问权限的维护者可运行 `scripts/connect-server.ps1` 维护 9080/9081 SSH 转发；停止本次本机进程使用 `scripts/stop-dev.ps1`。

```powershell
npm run build
npm test
npm run test:e2e
npm run health
```

`npm run build` 的最终产物是独立的 `.cache/site-build-<id>/`，当前版本记录在 `.cache/site-current.json`。仅在完整构建通过验证后切换指针，避免 Windows 目录占用或热更新造成半成品预览。Vue/Vite 仅编译问答交互组件，不承担 Wiki 页面框架。

## 结构

```text
mkdocs.yml                OI Wiki 配置基础上的站点配置
vendor/oi-material/       固定版本的原主题与许可证
overrides/                小范围模板覆盖
hooks/site.py             文章上下文、搜索和账号挂载
docs/                     文章与站内页面
community/                共用样式的问答、登录和审核组件
lib/api-routes.mjs        同域 API 白名单
scripts/community-api.mjs 本机 API 代理
deploy/community-api.conf 从白名单生成的服务器代理
runtime/                  私有凭据与进程记录，不进 Git
```

## 统一问答

普通用户在 Wiki 内提问和回答，管理员/版主在 `/review/` 审核。`reviewer-basic` 已启用首帖先审。提问者采纳与管理员内容审核是不同状态。

编辑器、回答、讨论和采纳使用 Answer 的真实接口。关联文章通过稳定 `doc_id` 标签和原文链接保留。无关联文章的问题使用 `general` 标签。

会话仅保存在当前标签页的 `sessionStorage`，请求使用调用者的 Bearer token；没有把管理员凭据嵌入前端。服务端仍检查权限。公开文章问答不发送凭据，所有 API 响应禁止缓存。

用户的声望/投票权限由 Answer 原生规则判断，不在前端绕过。飞书注册邮件已启用；开发验证使用隔离环境，生产回归只创建明确标识的测试账号。

邮件激活和重置页面已接入统一主题，正式飞书投递已验收。首帖先审并不等于每一帖都要审批，如需全量先审，应调整审核插件设置。

注册模块现已通过独立 SMTP 收件器完成邮件与账号状态联调，包含跨标签页激活、链接失效和密码重置。正式发信已配置飞书 SMTP，具体分工和配置见 `REGISTRATION.md`。本机邮件验证运行 `npm run test:mail`，不会连接生产数据库。

Answer 通知邮件的原生 `/questions/<问题ID>/<回答ID>` 地址已兼容到统一 Wiki，并支持带标题的链接和回答定位。旧邮件链接仍可使用。`/users/unsubscribe/` 同样使用统一主题，需明确确认后才退订相应类型的通知。

## 部署

服务器新库为 `feiyang_wiki_qa`，容器为 `feiyang-wiki-answer`。当前镜像为 `feiyang/answer-runtime:2.0.2-login-b43aa249b983`，源版本仍为 Answer 2.0.2，包含固定版本官方审核插件和用户名登录补丁。

当前构建脚本为 `scripts/build-answer-login.ps1`，需要固定版本 Answer 源码、Go 1.25.x 和 pnpm。Windows 产物用于隔离测试，Linux 产物用于服务器；编译在本机执行，服务器只封装已编译的运行镜像。

```powershell
node scripts/nginx-api.mjs
node scripts/package-site.mjs
```

将构建包、`deploy/wiki-staging.conf`、`deploy/community-api.conf` 和发布脚本放入 `/var/tmp/feiyang-wiki-bootstrap/` 后，执行 `scripts/publish-staging.py`。发布创建内容哈希命名的版本目录；先执行 `nginx -t`，成功后再 reload，配置失败时回退。

正式站点的部署、备份、证书同步和后续邮件接入见 `DEPLOYMENT.md`。正式发布使用 `scripts/publish-production.py`，不依赖预览站的可变链接。

运行目录与之前保持一致，原有五个业务容器和业务库未迁移。旧版本静态构建及升级前问答库备份仍保留，可用于回滚。

## 验证

浏览器测试覆盖桌面和手机：本地中文搜索、模板来源、站内登录、普通用户提问、待审内容隔离、管理员审核与回答、采纳及文章回链。测试只创建并软删除自己的问答和账号，不发送邮件，也不修改原有业务数据。

已有一篇维修手册联调样例；内容扩充与环境/界面开发分开进行。

## 内容维护

新增文章、板块、导航、图片和文章问答关联的现有操作方式，以及 Git 自动发布和网页编辑后台的后续选择，见 `CONTENT_WORKFLOW.md`。当前内容范围不限于维修知识，尚未接入网页文章管理后台。

协作步骤见 [CONTRIBUTING.md](CONTRIBUTING.md)。GitHub Actions 为推送和 Pull Request 执行基础检查及完整构建，生成可下载的静态预览包；生产发布仍由维护者执行。
