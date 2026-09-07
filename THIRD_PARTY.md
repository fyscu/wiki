# 上游来源与许可

## 页面与主题

| 来源 | 固定版本 |
| --- | --- |
| [OI Wiki 配置参考](https://github.com/OI-wiki/OI-wiki) | `2c7d9e82d9504de980c3edbd34270dd71413f08e` |
| [OI Wiki Material 主题](https://github.com/OI-wiki/mkdocs-material) | `b80fbeb86b02065fcfdc4ffe74f2cbbb577121f6` |
| Material 本地搜索 | `9.6.15` |

主题模板和样式保存在 `vendor/oi-material/material/templates`，MIT 许可证见 [vendor/oi-material/LICENSE](vendor/oi-material/LICENSE)。`docs/_static/css/oi-extra.css` 来源于上述 OI Wiki 版本。

搜索使用 Material 的本地中文检索模块，对应 wheel SHA-256：`ac969c94d4fe5eb7c924b6d2f43d7db41159ea91553d18a9afc4780c34f2717a`。

站点覆盖集中在 `overrides/`、`hooks/site.py` 和飞扬样式文件；Fira 字体通过 `@fontsource` 自托管。

## 问答后台

Apache Answer `2.0.2`，Apache-2.0，源码基准 `3b9f1370612e690a0b7f230f05e688930db4c6d3`。审核使用官方 `reviewer-basic` 插件，固定提交 `27f129f9ef49d2e49b0fae20292ab36963cd016a`。

项目增加了问答组件、同域 API 代理和用户名登录补丁，构建入口为 `scripts/build-answer-login.ps1`。版本记录见 [upstream.lock.json](upstream.lock.json)。

## 文章来源

维修示例引用四川大学飞扬俱乐部《维修手册》，页码、图片来源和文件校验值见 [manual-source.json](manual-source.json)。
