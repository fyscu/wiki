# 环境速查

| 项目 | 配置 |
| --- | --- |
| 正式站点 | https://wiki.feiyang.ac.cn/ |
| 服务器 | `45.40.247.178`，SSH 用户 `ubuntu` |
| 本机预览 | `http://127.0.0.1:5173/` |
| Answer | 服务器回环端口 `9080` |
| 内容管理 | `/editor/`，服务回环端口 `9090`，API 前缀 `/_editor/` |
| 静态预览 | 服务器回环端口 `9081` |
| 问答容器 | `feiyang-wiki-answer` |
| 数据库 | MySQL 8.4.3，库 `feiyang_wiki_qa`，用户 `fy_wiki_qa` |
| 容器限额 | 内存 512 MiB，CPU 0.75，日志 10 MiB × 3 |
| 内容服务限额 | 内存 1 GiB，CPU 1 核，构建任务串行执行 |
| 开发依赖 | Node.js 24、Python 3.12、Git、OpenSSH |

有服务器权限的维护者运行 `scripts/connect-server.ps1` 启动本机预览和 SSH 转发，使用 `scripts/stop-dev.ps1` 停止。

凭据保存在 `runtime/credentials.json`。部署路径与恢复步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)，镜像版本和校验值见 [upstream.lock.json](upstream.lock.json)。
