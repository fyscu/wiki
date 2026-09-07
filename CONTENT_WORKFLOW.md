# 文章与板块维护

文章存放在 `docs/`，图片存放在 `docs/images/`，导航由 `mkdocs.yml` 的 `nav` 配置。板块可按维修、软件、编程、网络或俱乐部事务划分。

## 新增文章

1. 创建 Markdown 文件，如 `docs/software/windows-update.md`。路径使用小写英文字母、数字和连字符。
2. 生成文档 ID，填写文章信息。
3. 将文章加入 `nav`。

生成 ID：

```powershell
node --input-type=module -e "import {ulid} from 'ulid'; console.log(ulid().toLowerCase())"
```

文章模板：

```markdown
---
title: Windows 更新问题处理
doc_id: <生成的26位小写ULID>
owners: [software-team]
tags: [Windows, 软件使用]
updated: 2026-09-07
---

# Windows 更新问题处理

## 适用范围

## 操作步骤

## 参考资料
```

`title`、`doc_id`、`owners` 为必填项。`doc_id` 用于关联问答，`owners` 记录维护负责人；页面目录由正文标题自动生成。

## 新增板块

创建板块概述页，如 `docs/software/index.md`，在 `nav` 中加入：

```yaml
  - 软件使用:
      - 软件使用概述: software/index.md
      - Windows 更新问题处理: software/windows-update.md
```

一级导航显示为顶部板块，嵌套条目显示在左侧目录。

## 更新与发布

- 修改正文时保留 `doc_id`，更新日期和来源。
- 文章改名或移动后，同步导航并为旧地址配置重定向。
- 新增问答标签由维护者运行 `npm run qa:setup` 创建；已有标签的显示名由维护者更新。
- 删除文章前确定归档方式和旧链接去向。

提交前运行 `npm run content:check` 和 `npm run build`，校验元数据并生成文章清单、搜索索引和页面。修改 `mkdocs.yml` 后需手动构建或重启预览进程。

通过 [PR 审阅](CONTRIBUTING.md) 后，由维护者[发布静态包](DEPLOYMENT.md#发布静态站)。

## 后续管理方案

| 方案 | 用途 | 接入工作 |
| --- | --- | --- |
| GitHub 网页 / github.dev | 直接修改文章、图片和导航 | 已可使用 |
| 模板生成与自动发布 | 自动填写 ID、维护导航、同步标签并发布 | 增加生成工具和发布任务 |
| [Decap CMS](https://decapcms.org/) | 通过表单编辑文章、分类、图片和草稿 | 配置 GitHub OAuth、编辑权限和字段规则 |

建议先增加模板生成和自动发布，再按编辑需求接入 Decap CMS。编辑后台可设在 `/editor/`，导航独立为普通 YAML 文件，公开页面沿用 OI Wiki 主题。
