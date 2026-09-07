# 协作与内容贡献

代码和文章统一在 https://github.com/fyscu/wiki 管理，`main` 保存可发布版本。建议从新分支提交修改，再通过 Pull Request 审核合并。

## 直接在 GitHub 编辑

小幅修订可以打开 `docs/` 中对应 Markdown 文件，点击编辑，在提交时选择创建分支并发起 Pull Request。也可以在仓库页按 `.` 打开 github.dev，同时修改文章、图片路径和导航。

新增文章和板块的模板及具体操作见 [CONTENT_WORKFLOW.md](CONTENT_WORKFLOW.md)。保留已有文章的 `doc_id`，以维持问答关联。新增文章应填写 `title`、`doc_id`、`owners`，并更新 `mkdocs.yml` 的导航。

## 本机开发

需要 Node.js 24 和 Python 3.12。首次克隆后：

```powershell
git clone https://github.com/fyscu/wiki.git
cd wiki
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
npm ci
npm run dev
```

本机预览默认地址为 `http://127.0.0.1:5173/`。静态页面和搜索可以独立预览；问答接口需要可访问的 Answer 实例，默认 `127.0.0.1:9080`。仅有服务器访问权限的维护者才应使用 SSH 连接脚本。

```powershell
git switch -c content/your-topic
npm test
npm run content:check
npm run build
git add docs mkdocs.yml
git commit -m "docs: update your topic"
git push -u origin content/your-topic
```

## 自动检查与发布

推送到 `main` 或提交 Pull Request 后，`Wiki Checks` 自动执行单元测试、文章元数据检查、代理配置一致性检查及完整 MkDocs 构建，并保存 7 天的静态预览包。

检查不连接生产服务器，不读取管理员凭据，不运行需要真实账号的浏览器测试。它不会自动发布到正式站。当前正式发布仍由维护者按 [DEPLOYMENT.md](DEPLOYMENT.md) 执行。

合并前建议由其他维护者检查内容和 CI 结果。当前仓库未设置强制分支保护，尚不能依靠平台规则强制落实这一流程。

## 仓库边界

仓库包含文章、必要图片、主题原文件、前后端整合代码、Answer 补丁及部署脚本。`runtime/`、`.cache/`、数据库、私钥、SMTP 密码、管理员密码和编译产物不提交。第三方来源和许可证见 [THIRD_PARTY.md](THIRD_PARTY.md)；后端定制构建另需准备固定版本的上游源码和工具链。
