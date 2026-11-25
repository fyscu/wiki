# 飞扬问答社区初始化

## 官方容器与邮件

- [ ] 在 Linux 主机将 `app.yml.example` 放到 `/var/discourse/containers/app.yml`。填写论坛域名、管理员邮箱及企业邮箱提供的 SMTP 主机、端口、账号和授权码，通知发件地址使用供应商允许的地址。端口 `587` 用 STARTTLS，`465` 用隐式 TLS。运行 `cd /var/discourse && sudo ./launcher rebuild app`。 [官方容器配置](https://github.com/discourse/discourse_docker/blob/main/samples/standalone.yml)
- [ ] Caddy 负责公网 `80/443` 和 TLS。用 `docker network inspect bridge --format '{{ (index .IPAM.Config 0).Gateway }}'` 核对 Docker 默认桥接网关。若结果有别于 `172.17.0.1`，更新 `expose` 及 `set_real_ip_from` 中的地址。通过 Caddy 登录后核对访问日志中的客户端 IP。若仍显示代理地址，将 `set_real_ip_from` 更新为实际的 Caddy 代理来源地址。 [Docker 网关地址](https://docs.docker.com/reference/cli/dockerd/#configure-host-gateway-ip) · [Discourse 反代真实 IP 配置](https://meta.discourse.org/t/handling-the-chain-of-trust-of-the-end-users-real-ip/406372)
- [ ] 打开 `https://bbs.feiyang.ac.cn/` 完成首位管理员注册。测试激活邮件和密码重置邮件，确认邮件链接使用 HTTPS 论坛域名。

## 主题、配色与 Wiki 回链

- [ ] 在后台 **外观 → 主题**（`/admin/config/customize/themes`）将内置 **Horizon** 设为默认主题。退出登录后刷新论坛，确认访客页面也应用了 Horizon。 [Horizon 说明](https://meta.discourse.org/t/horizon-theme/360486)
- [ ] 在后台 **外观 → 徽标**（`/admin/config/logo`）将[标准 Logo](标准logo.png)上传为主要徽标。
- [ ] 如需自定义飞扬配色，在 **外观 → 颜色**（`/admin/config/colors`）以 Horizon 的配色为基础建立下表两套色板，分别设为主题默认浅色和深色。 [官方配色配置](https://meta.discourse.org/t/customize-your-site-branding/258307)

| 字段 | 飞扬浅色 | 飞扬深色 |
| --- | --- | --- |
| `primary`、`header_primary`（正文、顶栏文字） | `#242632` | `#ebedf2` |
| `secondary`（内容区、卡片底色） | `#ffffff` | `#252834` |
| `header_background`（顶栏底色） | `#ffffff` | `#1e2129` |
| `tertiary`（链接与主操作色） | `#4051b5` | `#5488e8` |

- [ ] 用管理员账号打开论坛侧栏，点击底部的 **添加自定义版块**。新建「资源」，添加「维修知识库」，勾选「对所有人可见」并保存。独立域名部署时地址填实际 `WIKI_SITE_URL`。Wiki 和论坛共用同一主机名、通过端口区分时，地址填 `/_wiki/`，由 Caddy 转到 Wiki。退出登录后从侧栏点击链接，确认能打开 Wiki。 [官方侧栏配置](https://meta.discourse.org/t/using-the-discourse-sidebar/258478)

## 分类、采纳与文章讨论

- [ ] 确认后台 **插件 → Solved** 已开启。按下表设置公开分类，已有 `site-feedback` 可直接改名。在求助类的分类设置勾选「Allow topic owner and staff to mark a reply as the solution」，随后用普通账号发帖并采纳一条回复。 [官方 Solved 使用说明](https://meta.discourse.org/t/discourse-solved/30155)

| 分类 | URL slug | 开启采纳 |
| --- | --- | --- |
| 硬件与拆装 | `hardware` | 是 |
| 系统与引导 | `boot` | 是 |
| 网络与校园网 | `network` | 是 |
| 软件与环境 | `software` | 是 |
| 经验分享 | `experience` | 否 |
| 站务与建议 | `site-feedback` | 否 |

- [ ] 在后台 **Customize → Embedding**（`/admin/customize/embedding`）添加 `wiki.feiyang.ac.cn` 为嵌入主机，指定「经验分享」为讨论归档分类，以及具备发帖权限的现有账号作为嵌入话题作者。确认论坛可访问 Wiki 文章的公开规范链接。 [官方嵌入配置](https://meta.discourse.org/t/embedding-discourse-comments-via-javascript/31963)
- [ ] 用生产域名开启 `extra.discourse_url` 并重新构建 Wiki。访问 `/handbook/startup/` 确认讨论嵌入出现，点到论坛后确认讨论可回链到该文章。上线前预览可保持该配置留空。
