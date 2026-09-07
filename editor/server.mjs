import { resolve } from 'node:path'
import { listenEditor } from './service.mjs'

const root = resolve(process.env.EDITOR_ROOT || 'runtime/editor')
const service = await listenEditor({ repoDir: process.env.EDITOR_REPO || resolve(root, 'repo'), dataDir: resolve(root, 'state'), workDir: resolve(root, 'jobs'), siteDir: process.env.EDITOR_SITE || resolve(root, 'published'), depsDir: process.env.EDITOR_DEPS || process.cwd(), python: process.env.WIKI_PYTHON || resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), answerOrigin: process.env.QA_ORIGIN || 'http://127.0.0.1:9080', publicOrigin: process.env.WIKI_ORIGIN || 'http://127.0.0.1:5173', gitSshCommand: process.env.GIT_SSH_COMMAND, port: Number(process.env.EDITOR_PORT || 9090) })
console.log(`Editor listening on 127.0.0.1:${service.port}`)
async function stop() { await service.close(); process.exit(0) }
process.once('SIGTERM', stop); process.once('SIGINT', stop)
