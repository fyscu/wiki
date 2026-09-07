# 部署与恢复

正式入口：https://wiki.feiyang.ac.cn/。服务器连接方式见 [环境速查](ENVIRONMENT.md)。

## 运行目录

站点目录：`/opt/1panel/apps/openresty/openresty/www/sites/wiki.feiyang.ac.cn`。

| 资源 | 位置 |
| --- | --- |
| 静态版本 | 站点目录下 `releases/mkdocs-<hash>`，由 `index` 链接选定 |
| API 代理 | 站点目录下 `community-api.conf` |
| Nginx 配置 | `/opt/1panel/apps/openresty/openresty/conf/conf.d/feiyang-wiki-production.conf` |
| Answer 配置与数据 | `/opt/feiyang-wiki/compose.yaml`、`/opt/feiyang-wiki/qa/data` |
| 发布备份 | `/opt/feiyang-wiki/backups/`，root 私有目录 |

## 发布静态站

本机执行：

```powershell
npm test
npm run build
node scripts/nginx-api.mjs
node scripts/package-site.mjs
```

将以下文件上传到服务器 `/var/tmp/feiyang-wiki-bootstrap/`：

- `.cache/wiki-dist.tar.gz`
- `deploy/wiki-production.conf`、`deploy/community-api-production.conf`
- `deploy/feiyang-wiki-certificate.service`、`deploy/feiyang-wiki-certificate.timer`、`deploy/feiyang-wiki.logrotate`
- `scripts/publish-production.py`、`scripts/sync-wiki-certificate.py`

服务器执行：

```sh
sudo python3 /var/tmp/feiyang-wiki-bootstrap/publish-production.py
```

脚本备份 Wiki 数据库和配置，建立静态版本，通过 `nginx -t` 后平滑重载；检查失败时恢复原配置和版本链接。

`scripts/configure-production.mjs --apply` 用于初始化正式 URL，并关闭注册。注册开关和 SMTP 操作见 [账号与邮件](REGISTRATION.md)。

## 证书与日志

1Panel 管理通配符证书 ID 4，`feiyang-wiki-certificate.timer` 每日同步到站点 `ssl/` 目录，检查有效期和密钥匹配后重载 Nginx。

同步日志：

```sh
journalctl -u feiyang-wiki-certificate.service
```

访问日志记录请求路径，省略查询参数。`/etc/logrotate.d/feiyang-wiki` 每日检查轮转，保留 14 份压缩日志；大小阈值为 20 MiB。Answer 容器日志上限为 10 MiB × 3。

## 后端构建

源码版本和二进制校验值见 [upstream.lock.json](upstream.lock.json)，用户名登录补丁位于 `patches/answer-username-login.patch`。

准备固定版本的 Answer 源码、Go 1.25.x 和 pnpm 后执行：

```powershell
./scripts/build-answer-login.ps1 -TargetOS windows
./scripts/build-answer-login.ps1 -TargetOS linux
```

Windows 产物用于本机测试，Linux 产物打包为 `.cache/answer-runtime-login.tar.gz`。

将构建包和 `scripts/deploy-answer-login.py` 上传到服务器引导目录，依次执行：

```sh
sudo python3 /var/tmp/feiyang-wiki-bootstrap/deploy-answer-login.py --sha256 <完整摘要>
sudo python3 /var/tmp/feiyang-wiki-bootstrap/deploy-answer-login.py --sha256 <完整摘要> --activate
```

第一步构建镜像并检查审核插件，第二步备份数据并替换 `answer` 服务。启动或配置检查失败时自动恢复原镜像。

## 验证与恢复

准备管理员凭据及 9080 SSH 转发后，运行正式站回归：

```powershell
$env:WIKI_BASE_URL='https://wiki.feiyang.ac.cn'
npm run test:e2e
```

测试会创建并清理专用账号与内容。本机认证和邮件测试使用 `npm run test:mail`。

静态回滚：根据备份中的 `previous-release.txt` 恢复 `index`，同时恢复该次 Nginx/API 配置，检查后重载。

后端回滚：恢复备份中的 Compose 并重建 `answer` 服务，前端切换到匹配版本。数据库恢复前先核对备份后新增的数据。

现有备份保存在服务器本机；异机备份和恢复演练列为后续运维事项。
