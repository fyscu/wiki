# 参与协作

在新分支提交修改，通过 Pull Request 审阅后合并到 `main`。

## 网页编辑

在 [仓库](https://github.com/fyscu/wiki) 的 `docs/` 目录打开文章，点击编辑，选择新建分支并提交 PR。多文件编辑可在仓库页按 `.` 打开 github.dev。

文章模板和目录规则见 [内容维护](CONTENT_WORKFLOW.md)。

## 本机提交

按 [README](README.md#本机运行) 准备环境后创建分支：

```powershell
git switch -c content/your-topic
```

完成修改后检查并提交：

```powershell
npm test
npm run content:check
npm run build
git add docs mkdocs.yml
git commit -m "docs: update your topic"
git push -u origin content/your-topic
```

在 GitHub 发起 PR，由维护者核对内容和检查结果后合并。

## 检查与发布

`Wiki Checks` 在 PR 和 `main` 推送时运行测试、元数据校验、代理配置检查及构建，预览包保留 7 天。维护者按 [部署说明](DEPLOYMENT.md) 发布到正式站。

凭据和运行数据存放在 `runtime/`，构建缓存存放在 `.cache/`，两者均由 `.gitignore` 排除。
