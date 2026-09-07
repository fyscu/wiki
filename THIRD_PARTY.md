# 上游来源

## Wiki 页面与主题

页面使用 OI Wiki 正在使用的 Material 主题模板与 CSS，不是重新仿写布局。

| 来源 | 固定版本 |
| --- | --- |
| OI Wiki 配置参考 | `OI-wiki/OI-wiki`，`2c7d9e82d9504de980c3edbd34270dd71413f08e` |
| 模板、布局、主题 CSS | `OI-wiki/mkdocs-material`，`b80fbeb86b02065fcfdc4ffe74f2cbbb577121f6` |
| 本地搜索运行库 | Material for MkDocs `9.6.15` |

主题文件原样保存在 `vendor/oi-material/material/templates`，MIT 许可保存在 `vendor/oi-material/LICENSE`。上游仓库：https://github.com/OI-wiki/mkdocs-material 。

OI Wiki 的分支默认调用它自己的搜索服务，因此本项目使用同版本 Material 的标准本地搜索脚本和中文检索模块。对应 wheel 的 SHA-256 是 `ac969c94d4fe5eb7c924b6d2f43d7db41159ea91553d18a9afc4780c34f2717a`。

本项目仅在 `overrides`、`hooks/site.py` 中覆盖站点元信息、字体来源、署名和问答挂载点。上游 Google Analytics、外部字体、OI 专属评论和 PWA 注册未接入。Fira 字体通过 `@fontsource` 自托管。

`docs/_static/css/oi-extra.css` 来源于上述 OI Wiki 仓库，保留为单独文件。新增样式只用于飞扬标识和问答控件。

未复制 OI Wiki 的知识文章。维修示例引用用户提供的飞扬俱乐部手册，出处见 `manual-source.json`；主题代码许可不等同于文章内容许可。

## 问答后台

Apache Answer `2.0.2`，Apache-2.0，源码基准 `3b9f1370612e690a0b7f230f05e688930db4c6d3`。首帖审核使用官方 `reviewer-basic` 插件，固定提交 `27f129f9ef49d2e49b0fae20292ab36963cd016a`。

问答交互组件和同域 API 整合为本项目新增代码。后端另有一个最小用户名登录补丁 `patches/answer-username-login.patch`，扩展账号查找和请求校验，继续复用上游密码校验、状态检查和会话逻辑；构建入口为 `scripts/build-answer-login.ps1`。文档布局、内容编译、搜索、明暗主题和问答业务规则均复用上游实现。
