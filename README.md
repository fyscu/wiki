# 飞扬 Wiki

四川大学飞扬俱乐部知识库，使用 OI Wiki Material 主题和 Apache Answer 问答服务。

[访问网站](https://wiki.feiyang.ac.cn/) · [GitHub 仓库](https://github.com/fyscu/wiki)

文章公开阅读，用户验证邮箱后可参与问答，管理员审核首帖。登录支持邮箱或用户名。

管理员可在[内容管理](https://wiki.feiyang.ac.cn/editor/)编辑文章、调整板块并一键发布，操作见[内容维护](CONTENT_WORKFLOW.md)。

## 本机运行

依赖 Node.js 24、Python 3.12 和 Git。以下命令适用于 PowerShell：

```powershell
git clone https://github.com/fyscu/wiki.git
cd wiki
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
npm ci
npm run dev
```

预览地址为 `http://127.0.0.1:5173/`，问答接口默认连接 `127.0.0.1:9080`。修改文章后自动重建，刷新页面查看。

## 项目目录

| 目录或文件 | 内容 |
| --- | --- |
| `docs/` | 文章、图片和站内页面 |
| `mkdocs.yml`、`navigation.yml` | 站点配置、文章导航 |
| `community/` | 账号、问答和内容编辑界面 |
| `editor/` | 草稿、图片、预览与 Git 发布服务 |
| `vendor/oi-material/` | OI Wiki 主题 |
| `overrides/`、`hooks/` | 模板覆盖和构建钩子 |
| `scripts/`、`deploy/` | 开发与部署工具 |
| `patches/` | Answer 用户名登录补丁 |

## 文档

- [参与协作](CONTRIBUTING.md)
- [文章与板块维护](CONTENT_WORKFLOW.md)
- [部署与恢复](DEPLOYMENT.md)
- [账号与邮件配置](REGISTRATION.md)
- [环境速查](ENVIRONMENT.md)
- [上游来源与许可](THIRD_PARTY.md)
