# 飞扬 Wiki

四川大学飞扬俱乐部的电脑维修知识库，使用 Material for MkDocs 构建。论坛和部署配置位于私有仓库 [fyscu/forum](https://github.com/fyscu/forum)。

## 本地预览

安装 Python 3.12 后，在仓库根目录运行以下命令。

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-wiki.ps1
~~~

打开 [本地 Wiki](http://127.0.0.1:8000/)。脚本会安装依赖，保存文档后预览会刷新。

## 编辑文档

- 文章是 [docs/](docs/) 下的 Markdown。可用文章右上角的铅笔链接在 GitHub 上编辑。需要调整栏目或顺序时，编辑 [mkdocs.yml](mkdocs.yml) 中的 nav。
- 在 [线上 Sveltia CMS](https://wiki.feiyang.ac.cn/admin/) 用 GitHub 令牌登录。令牌的资源所有者为 fyscu，仓库为 wiki，Contents 需要读写权限。保存会提交到 main。
- 本地可用 Chrome 或 Edge 打开 [编辑后台](http://127.0.0.1:8000/admin/)，选择 Work with Local Repository，然后选择当前仓库的根目录。

提交前，在仓库根目录执行严格构建。

~~~powershell
.\.venv\Scripts\python.exe -m mkdocs build --strict
~~~
