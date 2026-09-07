# 内容编辑器

`Editor.vue` 挂载于 `/editor/`，支持 `?article=<id>` 直达文章。接口前缀为 `/_editor`，会话来自 `community/api.ts`。

正文使用 CodeMirror，草稿串行自动保存。图片写入 Markdown 的正式路径，私有预览使用签名地址。目录变更、发布任务和历史恢复由内容服务处理。

## 测试

```sh
npm run test:editor-ui
```

测试使用模拟接口和桌面、手机视口，产物保存在 `.qa/`。真实服务入口见根目录 `editor/server.mjs`。
