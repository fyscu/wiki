import test from 'node:test'
import assert from 'node:assert/strict'
import childProcess, { execFile } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createPublisher } from '../editor/publisher.mjs'

const run = promisify(execFile)
const pages = ['index.html', 'questions/index.html', 'ask/index.html', 'question/index.html', 'login/index.html', 'register/index.html', 'users/account-activation/index.html', 'users/password-reset/index.html', 'users/unsubscribe/index.html']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const git = async (cwd, ...args) => (await run('git', ['-c', 'core.autocrlf=false', '-c', 'gc.auto=0', ...args], { cwd, windowsHide: true, encoding: 'utf8' })).stdout.trimEnd()

async function put(path, content) {
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, content)
}

async function fakeBuild({ workspace }) {
  const output = join(workspace, '.cache', 'complete')
  for (const page of pages) await put(join(output, page), '<html><body>complete</body></html>')
  await put(join(output, 'article.txt'), await readFile(join(workspace, 'docs', 'article.md')))
  await put(join(workspace, '.cache', 'site-current.json'), JSON.stringify({ directory: output }))
  await put(join(workspace, 'docs', 'generated.json'), 'not content')
  return output
}

async function fixture(t, { buildScript } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wiki-publisher-test-'))
  t.after(async () => {
    const part = relative(tmpdir(), root)
    assert.ok(part.startsWith('wiki-publisher-test-') && !part.includes(sep) && !isAbsolute(part))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const origin = join(root, 'origin.git')
  const seed = join(root, 'seed')
  const repoDir = join(root, 'repo')
  const workDir = join(root, 'jobs')
  const siteDir = join(root, 'site')
  const depsDir = join(root, 'deps')
  await mkdir(seed)
  await mkdir(join(depsDir, 'node_modules'), { recursive: true })
  await put(join(depsDir, 'node_modules', 'keep.txt'), 'trusted dependency')
  await git(root, 'init', '--bare', '--initial-branch=main', origin)
  await git(seed, 'init', '--initial-branch=main')
  await git(seed, 'config', 'user.name', 'Original Author')
  await git(seed, 'config', 'user.email', 'original@example.invalid')
  await put(join(seed, '.gitignore'), 'node_modules/\n.cache/\ndocs/generated.json\n')
  await put(join(seed, 'docs', 'article.md'), '# Original\n')
  await put(join(seed, 'docs', 'untouched.md'), '# Preserve me\n')
  await put(join(seed, 'docs', 'delete.md'), '# Delete me\n')
  await put(join(seed, 'navigation.yml'), 'nav: []\n')
  await put(join(seed, 'scripts', 'build-site.mjs'), buildScript || '// Trusted builder\n')
  await git(seed, 'add', '.')
  await git(seed, 'commit', '-m', 'Initial content')
  await git(seed, 'remote', 'add', 'origin', origin)
  await git(seed, 'push', '--set-upstream', 'origin', 'main')
  await git(root, 'clone', origin, repoDir)
  const base = await git(repoDir, 'rev-parse', 'HEAD')
  const progress = []
  const tagCalls = []
  const options = { repoDir, workDir, siteDir, depsDir, python: process.execPath, build: fakeBuild,
    onProgress: async (id, status, extra) => progress.push({ id, status, ...extra }),
    syncTags: async snapshot => tagCalls.push(snapshot) }
  const snapshot = (extra = {}) => ({ id: 'job-1', kind: 'publish', baseCommit: base, actor: { id: '42', username: 'Editor' }, files: [{ path: 'docs/article.md', content: '# Edited\n' }], media: [], versions: {}, navVersion: 0, ...extra })
  async function advance(path = 'docs/untouched.md', content = '# Remote change\n', message = 'Remote update') {
    await put(join(seed, path), content)
    await git(seed, 'add', '--', path)
    await git(seed, 'commit', '-m', message)
    await git(seed, 'push', 'origin', 'main')
    return git(seed, 'rev-parse', 'HEAD')
  }
  async function oldIndex() {
    const release = join(siteDir, 'releases', 'old')
    await put(join(release, 'index.html'), '<html>old public site</html>')
    await symlink(release, join(siteDir, 'index'), process.platform === 'win32' ? 'junction' : 'dir')
    return readlink(join(siteDir, 'index'))
  }
  async function unchangedIndex(target) {
    assert.equal(await readlink(join(siteDir, 'index')), target)
    assert.equal(await readFile(join(siteDir, 'index', 'index.html'), 'utf8'), '<html>old public site</html>')
  }
  return { root, origin, seed, base, options, snapshot, progress, tagCalls, advance, oldIndex, unchangedIndex }
}

test('rejects traversal, Git pathspecs, system pages, aliases, and non-content writes', async t => {
  const f = await fixture(t)
  const publisher = createPublisher(f.options)
  const paths = ['../docs/article.md', 'docs/../../.git/config', '.git/hooks/pre-commit', 'scripts/build-site.mjs', 'hooks/site.py', 'mkdocs.yml', '/docs/a.md', 'docs\\a.md', 'docs//a.md', 'docs/./a.md', 'docs/.git/a.md', 'docs/a.md:stream', 'docs/NUL.md', 'docs/COM1.md', 'docs/a /x.md', 'docs/a./x.md', ':(glob)**', 'docs/a.txt', 'docs/index.md', 'docs/questions.md', 'docs/questions/index.md', 'docs/users/reset.md', 'docs/assets/a.md', 'docs/images/uploads/a.md', 'docs/_static/a.md']
  for (const path of paths) {
    await assert.rejects(publisher.execute(f.snapshot({ files: [{ path, content: 'bad' }] })), error => error.status === 400, path)
    await assert.rejects(publisher.version(path, f.base), error => error.status === 400, path)
  }
  await assert.rejects(publisher.execute(f.snapshot({ files: [{ path: 'docs/a.md', content: 'a' }, { path: 'docs/A.md', content: 'b' }] })), /Duplicate/)
  await assert.rejects(publisher.execute(f.snapshot({ files: [{ path: 'docs/Article.md', content: 'bad' }] })), /existing tree/)
  await assert.rejects(publisher.execute(f.snapshot({ files: [{ path: 'docs/a.md', content: 'a' }, { path: 'docs/a.md/b.md', content: 'b' }] })), /Overlapping/)
  await assert.rejects(publisher.execute(f.snapshot({ media: [{ path: 'docs/images/uploads/fake.webp', source: join(f.root, 'media') }] })), /SHA-256/)
  for (const id of ['../escape', '/escape', 'a/b', 'NUL', 'a\\b']) await assert.rejects(publisher.execute(f.snapshot({ kind: 'preview', id })), /job identity/)
  for (const path of ['docs/LONGDI~1/article.md', 'docs/COM\u00b9.md']) await assert.rejects(publisher.execute(f.snapshot({ files: [{ path, content: 'bad' }] })), error => error.status === 400)
  assert.equal(await publisher.head(), f.base)
  assert.equal(await git(f.options.repoDir, 'status', '--porcelain'), '')
  assert.equal(f.tagCalls.length, 0)
})

test('rejects source junctions, hash mismatches, and tracked content symlinks', async t => {
  const f = await fixture(t)
  const bytes = Buffer.from('private upload')
  const source = join(f.root, 'uploads', 'image.webp')
  await put(source, bytes)
  const path = `docs/images/uploads/${hash(bytes)}.webp`
  const publisher = createPublisher(f.options)
  await symlink(join(f.root, 'uploads'), join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(publisher.execute(f.snapshot({ media: [{ path, source: join(f.root, 'linked', 'image.webp') }] })), /Symbolic links/)
  await assert.rejects(publisher.execute(f.snapshot({ media: [{ path: `docs/images/uploads/${'0'.repeat(64)}.webp`, source }] })), /hash does not match/)
  const linkBlob = await git(f.seed, 'hash-object', '-w', '--', source)
  await git(f.seed, 'update-index', '--add', '--cacheinfo', `120000,${linkBlob},docs/linked.md`)
  await git(f.seed, 'commit', '-m', 'Symlink fixture')
  await git(f.seed, 'push', 'origin', 'main')
  const baseCommit = await git(f.seed, 'rev-parse', 'HEAD')
  await assert.rejects(publisher.execute(f.snapshot({ baseCommit, files: [{ path: 'docs/linked.md', content: 'bad' }] })), /symbolic link or submodule/)
  await assert.rejects(publisher.version('docs/linked.md', baseCommit), /regular file/)
  assert.equal(await readFile(source, 'utf8'), 'private upload')
})

test('preview copies complete private artifacts under previews/jobid and removes the worktree', async t => {
  const f = await fixture(t)
  const before = await f.oldIndex()
  let workspace
  const publisher = createPublisher({ ...f.options, build: async args => {
    workspace = args.workspace
    assert.equal(await readFile(join(workspace, 'docs', 'untouched.md'), 'utf8'), '# Preserve me\n')
    await assert.rejects(lstat(join(workspace, 'docs', 'delete.md')), { code: 'ENOENT' })
    await fakeBuild(args)
  } })
  const preview = await publisher.execute(f.snapshot({ kind: 'preview', targetPath: 'docs/article.md', files: [{ path: 'docs/article.md', content: '# Preview\n' }, { path: 'docs/delete.md', content: null }] }))
  assert.ok(isAbsolute(preview.previewDir))
  assert.equal(preview.baseCommit, f.base)
  assert.equal(preview.targetPath, 'docs/article.md')
  assert.equal(preview.previewDir, join(f.options.workDir, 'previews', 'job-1'))
  assert.equal(await readFile(join(preview.previewDir, 'article.txt'), 'utf8'), '# Preview\n')
  await assert.rejects(lstat(workspace), { code: 'ENOENT' })
  assert.deepEqual(await readdir(f.options.workDir), ['previews'])
  assert.equal((await git(f.options.repoDir, 'worktree', 'list', '--porcelain')).split('\n').filter(line => line.startsWith('worktree ')).length, 1)
  assert.equal(await readFile(join(f.options.repoDir, 'docs', 'article.md'), 'utf8'), '# Original\n')
  assert.equal(await git(f.options.repoDir, 'status', '--porcelain'), '')
  assert.equal(await git(f.origin, 'rev-parse', 'main'), f.base)
  assert.equal(f.tagCalls.length, 0)
  assert.equal(f.progress.at(-1).phase, 'preview-ready')
  assert.ok(f.progress.every(event => event.status === 'building'))
  if (process.platform !== 'win32') assert.equal((await lstat(preview.previewDir)).mode & 0o777, 0o700)
  await f.unchangedIndex(before)
})

test('build failure reports a durable failure and preserves the public index and remote', async t => {
  const f = await fixture(t)
  const before = await f.oldIndex()
  const publisher = createPublisher({ ...f.options, build: async () => { throw new Error('intentional build failure') } })
  await assert.rejects(publisher.execute(f.snapshot()), /intentional build failure/)
  await f.unchangedIndex(before)
  assert.equal(await git(f.origin, 'rev-parse', 'main'), f.base)
  assert.equal(f.progress.at(-1).phase, 'failed')
  assert.equal(f.tagCalls.length, 0)
  assert.deepEqual(await readdir(f.options.workDir), [])
  assert.equal(await readFile(join(f.options.depsDir, 'node_modules', 'keep.txt'), 'utf8'), 'trusted dependency')
})

test('preview IDs cannot overwrite completed artifacts and failed persistence removes a new copy', async t => {
  const f = await fixture(t)
  const publisher = createPublisher(f.options)
  const snapshot = f.snapshot({ kind: 'preview' })
  const first = await publisher.execute(snapshot)
  assert.equal((await publisher.execute(snapshot)).previewDir, first.previewDir)
  await assert.rejects(publisher.execute({ ...snapshot, files: [{ path: 'docs/article.md', content: '# Different\n' }] }), error => error.code === 'PREVIEW_CONFLICT')
  assert.equal(await readFile(join(first.previewDir, 'article.txt'), 'utf8'), '# Edited\n')
  const failing = createPublisher({ ...f.options, onProgress: async (_id, _status, extra) => { if (extra.phase === 'preview-ready') throw new Error('preview persistence failed') } })
  await assert.rejects(failing.execute({ ...snapshot, id: 'job-2' }), /preview persistence failed/)
  assert.deepEqual(await readdir(join(f.options.workDir, 'previews')), ['job-1'])
  assert.deepEqual(await readdir(f.options.workDir), ['previews'])
  assert.equal((await git(f.options.repoDir, 'worktree', 'list', '--porcelain')).split('\n').filter(line => line.startsWith('worktree ')).length, 1)
})

test('rejects escaped, incomplete, and symlinked build outputs before tags or deployment', async t => {
  const f = await fixture(t)
  const before = await f.oldIndex()
  for (const build of [
    async ({ workspace }) => put(join(workspace, '.cache', 'site-current.json'), JSON.stringify({ directory: f.root })),
    async ({ workspace }) => { const output = await fakeBuild({ workspace }); await put(join(output, 'login/index.html'), 'incomplete') },
    async ({ workspace }) => { const output = await fakeBuild({ workspace }); await symlink(f.options.depsDir, join(output, 'leak'), process.platform === 'win32' ? 'junction' : 'dir') }
  ]) {
    await assert.rejects(createPublisher({ ...f.options, build }).execute(f.snapshot()))
    await f.unchangedIndex(before)
  }
  assert.equal(f.tagCalls.length, 0)
  assert.equal(await git(f.origin, 'rev-parse', 'main'), f.base)
})

test('remote divergence conflicts before the build and does not overwrite another author', async t => {
  const f = await fixture(t)
  const before = await f.oldIndex()
  const remote = await f.advance()
  let built = false
  const publisher = createPublisher({ ...f.options, build: async () => { built = true } })
  await assert.rejects(publisher.execute(f.snapshot()), error => error.status === 409 && error.remoteCommit === remote && /refresh/.test(error.message))
  assert.equal(built, false)
  assert.equal(await publisher.head(), f.base)
  assert.equal(await git(f.origin, 'rev-parse', 'main'), remote)
  await f.unchangedIndex(before)
})

test('remote changes during a build conflict before tags, commit, or deployment', async t => {
  const f = await fixture(t)
  const publisher = createPublisher({ ...f.options, build: async args => { await fakeBuild(args); await f.advance() } })
  await assert.rejects(publisher.execute(f.snapshot()), error => error.status === 409)
  assert.equal(f.tagCalls.length, 0)
  assert.equal(f.progress.some(item => item.phase === 'committing'), false)
  assert.equal(await publisher.head(), f.base)
  await assert.rejects(lstat(join(f.options.siteDir, 'index')), { code: 'ENOENT' })
})

test('publishes only staged content and media, reports the commit, and syncs the clone explicitly', async t => {
  const f = await fixture(t)
  const bytes = Buffer.from('uploaded image bytes')
  const source = join(f.root, 'upload.webp')
  await put(source, bytes)
  const path = `docs/images/uploads/${hash(bytes)}.webp`
  const publisher = createPublisher(f.options)
  const result = await publisher.execute(f.snapshot({ files: [{ path: 'docs/article.md', content: '# Edited\n' }, { path: 'docs/delete.md', content: null }, { path: 'navigation.yml', content: 'nav:\n  - Edited: article.md\n' }], media: [{ path, source }], message: 'Publish edited article' }))
  assert.notEqual(result.commit, f.base)
  assert.equal(await git(f.origin, 'rev-parse', 'main'), result.commit)
  assert.equal(await publisher.head(), f.base)
  assert.equal(await readFile(join(f.options.siteDir, 'index', 'article.txt'), 'utf8'), '# Edited\n')
  assert.ok((await lstat(result.releaseDir)).isDirectory())
  assert.deepEqual((await git(f.options.repoDir, 'diff-tree', '--no-commit-id', '--name-only', '-r', result.commit)).split('\n').sort(), ['docs/article.md', 'docs/delete.md', path, 'navigation.yml'].sort())
  assert.equal(await git(f.options.repoDir, 'show', `${result.commit}:docs/untouched.md`), '# Preserve me')
  assert.equal(await git(f.options.repoDir, 'show', `${result.commit}:${path}`), bytes.toString())
  assert.equal(await git(f.options.repoDir, 'show', '-s', '--format=%an', result.commit), 'Editor')
  assert.equal(f.tagCalls.length, 1)
  assert.equal(f.progress.at(-1).phase, 'published')
  assert.ok(f.progress.every(event => ['building', 'committing', 'publishing'].includes(event.status)))
  for (const event of f.progress.filter(item => ['committed', 'pushing', 'pushed', 'deploying', 'published'].includes(item.phase))) assert.equal(event.commit, result.commit)
  assert.equal(await publisher.sync(), result.commit)
  assert.equal(await publisher.head(), result.commit)
  assert.equal(await git(f.options.repoDir, 'status', '--porcelain'), '')
  assert.deepEqual(await readdir(f.options.workDir), [])
})

test('no diff skips commit, and matching already-committed content can be published again', async t => {
  const f = await fixture(t)
  const publisher = createPublisher(f.options)
  const remote = await f.advance('docs/article.md', '# Edited\n', 'Already published content')
  const result = await publisher.execute(f.snapshot())
  assert.equal(result.commit, remote)
  assert.equal(await git(f.origin, 'rev-list', '--count', 'main'), '2')
  assert.equal(f.progress.find(item => item.phase === 'committed').unchanged, true)
  assert.equal(f.progress.some(item => item.phase === 'pushing'), false)
  const otherSite = join(f.root, 'second-site')
  const noDiff = createPublisher({ ...f.options, siteDir: otherSite })
  const repeated = await noDiff.execute(f.snapshot({ baseCommit: remote, files: [{ path: 'docs/article.md', content: '# Edited\n' }, { path: 'docs/missing.md', content: null }] }))
  assert.equal(repeated.commit, remote)
  assert.equal(await git(f.origin, 'rev-list', '--count', 'main'), '2')
})

test('a push race is a 409 and includes the locally created commit without changing the index', async t => {
  const f = await fixture(t)
  let raced = false
  const publisher = createPublisher({ ...f.options, onProgress: async (id, status, extra) => {
    await f.options.onProgress(id, status, extra)
    if (extra.phase === 'pushing') { await f.advance(); raced = true }
  } })
  await assert.rejects(publisher.execute(f.snapshot()), error => error.status === 409 && /^[a-f0-9]{40}$/.test(error.commit) && error.pushed === false)
  assert.equal(raced, true)
  assert.equal(await git(f.origin, 'show', 'main:docs/article.md'), '# Original')
  await assert.rejects(lstat(join(f.options.siteDir, 'index')), { code: 'ENOENT' })
  assert.equal(f.progress.at(-1).phase, 'failed')
})

test('tag synchronization and changed snapshot content fail before committing', async t => {
  const f = await fixture(t)
  await assert.rejects(createPublisher({ ...f.options, syncTags: async () => { throw new Error('tag service unavailable') } }).execute(f.snapshot()), /tag service unavailable/)
  await assert.rejects(createPublisher({ ...f.options, build: async args => { await fakeBuild(args); await put(join(args.workspace, 'docs/article.md'), 'changed by builder') } }).execute(f.snapshot()), /Build changed snapshot content/)
  assert.equal(await git(f.origin, 'rev-parse', 'main'), f.base)
  await assert.rejects(lstat(join(f.options.siteDir, 'index')), { code: 'ENOENT' })
})

test('failure after index switching rolls back and reports the pushed commit', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  const before = await f.oldIndex()
  const publisher = createPublisher({ ...f.options, onProgress: async (id, status, extra) => {
    await f.options.onProgress(id, status, extra)
    if (extra.phase === 'published') throw new Error('job persistence unavailable')
  } })
  let commit
  await assert.rejects(publisher.execute(f.snapshot()), error => { commit = error.commit; return error.message === 'job persistence unavailable' && error.pushed === true })
  assert.equal(await git(f.origin, 'rev-parse', 'main'), commit)
  await f.unchangedIndex(before)
  const retry = await createPublisher(f.options).execute(f.snapshot())
  assert.equal(retry.commit, commit)
  assert.equal(await git(f.origin, 'rev-list', '--count', 'main'), '2')
})

test('Windows reports unsupported atomic junction replacement before tags or push', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  const before = await f.oldIndex()
  await assert.rejects(createPublisher(f.options).execute(f.snapshot()), error => error.code === 'ATOMIC_DEPLOY_UNSUPPORTED')
  assert.equal(f.tagCalls.length, 0)
  assert.equal(await git(f.origin, 'rev-parse', 'main'), f.base)
  await f.unchangedIndex(before)
})

test('public roots and every release entry remain readable under systemd UMask=0077', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  const previousMask = process.umask(0o077)
  try {
    const result = await createPublisher(f.options).execute(f.snapshot())
    for (const path of [f.options.siteDir, join(f.options.siteDir, 'releases'), result.releaseDir]) assert.equal((await lstat(path)).mode & 0o777, 0o755)
    for (const entry of await readdir(result.releaseDir, { recursive: true, withFileTypes: true })) {
      const info = await lstat(join(entry.parentPath, entry.name))
      assert.equal(info.mode & 0o777, entry.isDirectory() ? 0o755 : 0o644)
    }
    const preview = await createPublisher(f.options).execute(f.snapshot({ kind: 'preview' }))
    assert.equal((await lstat(join(f.options.workDir, 'previews'))).mode & 0o777, 0o700)
    assert.equal((await lstat(preview.previewDir)).mode & 0o777, 0o700)
  } finally { process.umask(previousMask) }
})

test('sync requires a clean tracking branch and only fast-forwards', async t => {
  const f = await fixture(t)
  const publisher = createPublisher(f.options)
  const remote = await f.advance()
  await put(join(f.options.repoDir, 'untracked.md'), 'local work')
  await assert.rejects(publisher.sync(), error => error.status === 409 && error.code === 'DIRTY_REPOSITORY')
  assert.equal(await publisher.head(), f.base)
  await rm(join(f.options.repoDir, 'untracked.md'))
  assert.equal(await publisher.sync(), remote)
  await git(f.options.repoDir, 'config', 'user.name', 'Local')
  await git(f.options.repoDir, 'config', 'user.email', 'local@example.invalid')
  await put(join(f.options.repoDir, 'docs/local.md'), 'local branch commit')
  await git(f.options.repoDir, 'add', '.')
  await git(f.options.repoDir, 'commit', '-m', 'Local only')
  const local = await publisher.head()
  await assert.rejects(publisher.sync(), error => error.status === 409)
  assert.equal(await publisher.head(), local)
})

test('history is bounded and version only reads reachable commits and regular content', async t => {
  const f = await fixture(t)
  const publisher = createPublisher(f.options)
  assert.equal(await publisher.version('docs/article.md', f.base), '# Original\n')
  for (const revision of ['HEAD', '--help', `${f.base}:docs/article.md`, `${f.base}~1`, '../main', '0'.repeat(40)]) await assert.rejects(publisher.version('docs/article.md', revision))
  const tree = await git(f.seed, 'rev-parse', 'HEAD^{tree}')
  const orphan = await git(f.seed, 'commit-tree', tree, '-m', 'Unreachable commit')
  await git(f.options.repoDir, 'fetch', f.seed, orphan)
  await assert.rejects(publisher.version('docs/article.md', orphan), error => error.code === 'UNAPPROVED_REVISION')
  for (let i = 0; i < 31; i++) {
    await put(join(f.seed, 'docs/article.md'), `# Revision ${i}\n`)
    await git(f.seed, 'add', 'docs/article.md')
    await git(f.seed, 'commit', '-m', `Article ${i}`)
  }
  await git(f.seed, 'push', 'origin', 'main')
  await publisher.sync()
  const history = await publisher.history('docs/article.md')
  assert.equal(history.length, 30)
  assert.deepEqual(Object.keys(history[0]).sort(), ['author', 'date', 'message', 'revision'])
  assert.equal(history[0].message, 'Article 30')
  assert.equal(history[0].author, 'Original Author')
  assert.ok(Number.isFinite(Date.parse(history[0].date)))
  assert.equal(await publisher.version('docs/article.md', history[0].revision), '# Revision 30\n')
})

test('the real command runner supplies WIKI_PYTHON, a heap cap, and a build timeout', async t => {
  const script = `import { mkdir, writeFile } from 'node:fs/promises'\nimport { resolve } from 'node:path'\nconst directory = resolve('.cache/actual')\nfor (const page of ${JSON.stringify(pages)}) { await mkdir(resolve(directory, page, '..'), { recursive: true }); await writeFile(resolve(directory, page), '<html></html>') }\nawait writeFile(resolve(directory, 'environment.json'), JSON.stringify({ python: process.env.WIKI_PYTHON, args: process.execArgv }))\nawait writeFile(resolve('.cache/site-current.json'), JSON.stringify({ directory }))\n`
  const f = await fixture(t, { buildScript: script })
  const publisher = createPublisher({ ...f.options, build: undefined })
  const result = await publisher.execute(f.snapshot({ kind: 'preview' }))
  const environment = JSON.parse(await readFile(join(result.previewDir, 'environment.json'), 'utf8'))
  assert.equal(environment.python, process.execPath)
  assert.ok(environment.args.includes('--max-old-space-size=512'))
  await f.advance('scripts/build-site.mjs', 'setInterval(() => {}, 1000)\n', 'Timeout fixture')
  await publisher.sync()
  const before = await f.oldIndex()
  const timeout = createPublisher({ ...f.options, build: undefined, buildTimeoutMs: 100 })
  await assert.rejects(timeout.execute(f.snapshot({ baseCommit: await publisher.head() })), error => error.code === 'COMMAND_TIMEOUT')
  await f.unchangedIndex(before)
})

test('subprocess failures never return raw command output or logged credentials', async t => {
  const sentinel = 'secret-token-fixture-12345'
  const f = await fixture(t, { buildScript: `console.log('Authorization: Bearer ${sentinel}'); console.error('private-key-fixture ${sentinel}'); process.exit(23)\n` })
  const before = await f.oldIndex()
  await assert.rejects(createPublisher({ ...f.options, build: undefined }).execute(f.snapshot()), error => {
    assert.equal(error.message, 'Site build failed (exit 23)')
    assert.equal(error.exitCode, 23)
    assert.equal(error.stdout, undefined)
    assert.equal(error.stderr, undefined)
    assert.equal(error.cause, undefined)
    assert.equal(JSON.stringify(error).includes(sentinel), false)
    return true
  })
  assert.equal(JSON.stringify(f.progress).includes(sentinel), false)
  await f.unchangedIndex(before)
})

test('trusted gitSshCommand reaches only Git, with inherited and snapshot settings excluded', async t => {
  const f = await fixture(t, { buildScript: 'process.exit(17)\n' })
  const gitSshCommand = 'ssh -i "/private/repository key" -o IdentitiesOnly=yes'
  for (const value of [null, 42, '', ' ', 'ssh\ninvalid', 'ssh\0invalid']) {
    assert.throws(() => createPublisher({ ...f.options, gitSshCommand: value }), /gitSshCommand must be/)
  }
  const inherited = { GIT_SSH_COMMAND: 'inherited-command-must-not-run', GIT_SSH: 'inherited-ssh', GIT_DIR: join(f.root, 'wrong-repository'), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.sshCommand', GIT_CONFIG_VALUE_0: 'inherited-config-command' }
  const saved = Object.fromEntries(Object.keys(inherited).map(key => [key, process.env[key]]))
  const calls = []
  const originalExecFile = childProcess.execFile
  const spy = t.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    if (file === 'git' || file === process.execPath) calls.push({ file, env: options.env })
    return originalExecFile(file, args, options, callback)
  })
  syncBuiltinESMExports()
  Object.assign(process.env, inherited)
  try {
    const publisher = createPublisher({ ...f.options, build: undefined, gitSshCommand })
    assert.equal(await publisher.sync(), f.base)
    await assert.rejects(publisher.execute(f.snapshot({ kind: 'preview', gitSshCommand: 'snapshot-command-must-not-run' })), error => error.message === 'Site build failed (exit 17)')
    const gitCalls = calls.filter(call => call.file === 'git')
    assert.ok(gitCalls.length > 0)
    for (const call of gitCalls) {
      assert.equal(call.env.GIT_SSH_COMMAND, gitSshCommand)
      for (const key of Object.keys(inherited).filter(key => key !== 'GIT_SSH_COMMAND')) assert.equal(call.env[key], undefined)
    }
    const builds = calls.filter(call => call.file === process.execPath)
    assert.equal(builds.length, 1)
    assert.deepEqual(Object.keys(builds[0].env).filter(key => /^GIT_/i.test(key)), [])
    assert.equal(JSON.stringify(f.progress).includes(gitSshCommand), false)
    assert.equal(await createPublisher(f.options).head(), f.base)
    assert.equal(calls.at(-1).env.GIT_SSH_COMMAND, undefined)
  } finally {
    spy.mock.restore()
    syncBuiltinESMExports()
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
