import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, cp, lstat, mkdir, mkdtemp, open, readdir, readlink, rename, rm, symlink, unlink } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

const REQUIRED_PAGES = ['index.html', 'questions/index.html', 'ask/index.html', 'question/index.html', 'login/index.html', 'register/index.html', 'users/account-activation/index.html', 'users/password-reset/index.html', 'users/unsubscribe/index.html']
const SYSTEM_PAGES = new Set(['index.md', 'ask.md', 'question.md', 'questions.md', 'login.md', 'register.md', 'review.md', 'editor.md'])
const SYSTEM_DIRS = new Set(['users', 'assets', 'images', 'scripts', 'hooks', 'editor', '_static', 'public', 'ask', 'question', 'questions', 'login', 'register', 'review'])
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

function failure(message, status = 400, code = 'INVALID_SNAPSHOT', extra = {}) {
  return Object.assign(new Error(message), { status, statusCode: status, code }, extra)
}

function contentPath(path, media = false) {
  if (typeof path !== 'string' || path.length > 500 || /[\\\x00-\x1f\x7f:*?"<>|~]/.test(path)) throw failure('Invalid content path')
  const parts = path.split('/')
  if (parts.some(part => !part || part.startsWith('.') || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(part))) throw failure(`Unsafe content path: ${path}`)
  if (media) {
    if (!/^docs\/images\/uploads\/[a-f0-9]{64}\.webp$/.test(path)) throw failure('Uploads require a lowercase SHA-256 .webp filename')
  } else if (path !== 'navigation.yml' && (parts[0] !== 'docs' || !path.endsWith('.md') || SYSTEM_DIRS.has(parts[1].toLowerCase()) || SYSTEM_PAGES.has(parts.slice(1).join('/').toLowerCase()))) {
    throw failure(`Path is not editable content: ${path}`)
  }
  return path
}

function validate(snapshot) {
  if (!snapshot || !['preview', 'publish'].includes(snapshot.kind) || typeof snapshot.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(snapshot.id) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(snapshot.id)) throw failure('Invalid job identity or kind')
  if (typeof snapshot.baseCommit !== 'string' || !SHA.test(snapshot.baseCommit)) throw failure('baseCommit must be a full Git commit SHA')
  if (!snapshot.actor || !['string', 'number'].includes(typeof snapshot.actor.id) || !String(snapshot.actor.id) || typeof snapshot.actor.username !== 'string' || !snapshot.actor.username.trim() || snapshot.actor.username.length > 200 || /[<>\x00-\x1f\x7f]/.test(snapshot.actor.username)) throw failure('Invalid actor identity')
  if (!Array.isArray(snapshot.files) || !Array.isArray(snapshot.media)) throw failure('files and media must be arrays')
  if (snapshot.message !== undefined && (typeof snapshot.message !== 'string' || snapshot.message.length > 4096 || snapshot.message.includes('\0'))) throw failure('Invalid commit message')
  if (snapshot.targetPath !== undefined) {
    contentPath(snapshot.targetPath)
    if (!snapshot.targetPath.startsWith('docs/')) throw failure('targetPath must be a Markdown document')
  }
  const paths = new Set()
  for (const [items, media] of [[snapshot.files, false], [snapshot.media, true]]) {
    for (const item of items) {
      if (!item || typeof item !== 'object') throw failure('Invalid content entry')
      contentPath(item.path, media)
      if (media ? typeof item.source !== 'string' || !isAbsolute(item.source) : item.content !== null && typeof item.content !== 'string') throw failure(`Invalid input for ${item.path}`)
      const key = item.path.toLowerCase()
      if (paths.has(key)) throw failure(`Duplicate content path: ${item.path}`)
      paths.add(key)
    }
  }
  for (const path of paths) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) if (paths.has(parts.slice(0, i).join('/'))) throw failure('Overlapping content paths')
  }
}

async function stat(path) {
  try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

// Check every ancestor, including Windows junctions, before touching input bytes.
async function checkedPath(path) {
  const absolute = resolve(path)
  const root = parse(absolute).root
  const parts = relative(root, absolute).split(sep).filter(Boolean)
  let current = root
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i])
    const info = await stat(current)
    if (!info) return null
    if (info.isSymbolicLink()) throw failure(`Symbolic links are not allowed: ${current}`)
    if (i < parts.length - 1 && !info.isDirectory()) throw failure(`Not a directory: ${current}`)
    if (i === parts.length - 1) return info
  }
  return lstat(root)
}

function inside(root, path) {
  const part = relative(root, path)
  return part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

async function regularBytes(path) {
  const info = await checkedPath(path)
  if (!info?.isFile()) throw failure(`Expected a regular file: ${path}`)
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try {
    const opened = await file.stat()
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw failure(`Input changed while opening: ${path}`)
    return await file.readFile()
  } finally { await file.close() }
}

async function directory(path, mode = 0o700) {
  const info = await checkedPath(path)
  if (info && !info.isDirectory()) throw failure(`Expected a directory: ${path}`)
  await mkdir(path, { recursive: true, mode })
}

async function writeContent(workspace, path, bytes) {
  const destination = join(workspace, path)
  const info = await checkedPath(destination)
  if (info && (!info.isFile() || info.nlink !== 1)) throw failure(`Content must be an unlinked regular file: ${path}`)
  if (bytes === null) {
    if (info) await unlink(destination)
    return
  }
  await directory(resolve(destination, '..'))
  const file = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW || 0), 0o644)
  try { await file.writeFile(bytes) } finally { await file.close() }
}

async function terminate(child, tree) {
  if (tree && process.platform === 'win32') {
    await new Promise(resolveDone => execFile(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, () => resolveDone()))
  } else if (tree && child.pid) {
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  child.kill('SIGKILL')
}

function command(file, args, { cwd, env, timeout = 60000, tree = false, label = 'Command' } = {}) {
  return new Promise((resolveDone, reject) => {
    let timer, stopping, expired = false
    const child = execFile(file, args, { cwd, env, windowsHide: true, detached: tree && process.platform !== 'win32', maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      clearTimeout(timer)
      Promise.resolve(stopping || (error && tree ? terminate(child, tree) : undefined)).then(() => {
        if (expired) reject(failure(`${label} timed out after ${timeout}ms`, 504, 'COMMAND_TIMEOUT'))
        else if (error) reject(failure(`${label} failed${Number.isInteger(error.code) ? ` (exit ${error.code})` : ''}`, 500, 'COMMAND_FAILED', { exitCode: Number.isInteger(error.code) ? error.code : undefined }))
        else resolveDone(stdout)
      }, reject)
    })
    timer = setTimeout(() => {
      expired = true
      stopping = terminate(child, tree)
      stopping.catch(() => {})
    }, timeout)
  })
}

async function treeHash(root, publicModes = false) {
  const hash = createHash('sha256')
  async function visit(path, name) {
    const info = await lstat(path)
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw failure(`Unsafe static build entry: ${name}`, 500, 'INVALID_BUILD')
    hash.update(JSON.stringify([name, info.isDirectory() ? 'directory' : digest(await regularBytes(path))]))
    if (publicModes) await chmod(path, info.isDirectory() ? 0o755 : 0o644)
    if (info.isDirectory()) for (const child of (await readdir(path)).sort()) await visit(join(path, child), name ? `${name}/${child}` : child)
  }
  await visit(root, '')
  return hash.digest('hex')
}

async function buildOutput(workspace) {
  const cache = join(workspace, '.cache')
  let pointer
  try { pointer = JSON.parse((await regularBytes(join(cache, 'site-current.json'))).toString('utf8')) } catch (cause) { throw failure('Build did not produce a valid site-current.json', 500, 'INVALID_BUILD', { cause }) }
  const output = pointer?.directory
  if (typeof output !== 'string' || !isAbsolute(output) || !inside(cache, resolve(output)) || !(await checkedPath(output))?.isDirectory()) throw failure('Build output must be a real directory inside the workspace cache', 500, 'INVALID_BUILD')
  for (const page of REQUIRED_PAGES) {
    if (!(await regularBytes(join(output, page))).includes(Buffer.from('</html>'))) throw failure(`Incomplete static build: ${page}`, 500, 'INVALID_BUILD')
  }
  await treeHash(output)
  return resolve(output)
}

async function staticLink(target, path) {
  await symlink(process.platform === 'win32' ? resolve(resolve(path, '..'), target) : target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

async function deployment(siteDir) {
  await directory(siteDir, 0o755)
  await chmod(siteDir, 0o755)
  const releases = join(siteDir, 'releases')
  await directory(releases, 0o755)
  await chmod(releases, 0o755)
  const index = join(siteDir, 'index')
  const info = await stat(index)
  if (info && !info.isSymbolicLink()) throw failure('Public index is not a managed symbolic link', 409, 'UNMANAGED_INDEX')
  const previous = info ? await readlink(index) : null
  if (previous && !inside(releases, resolve(siteDir, previous))) throw failure('Public index points outside releases', 409, 'UNMANAGED_INDEX')
  // Probe replacement before tags or Git are changed; Windows junction replacement can fail.
  if (previous) {
    const left = join(siteDir, `.index-check-${randomUUID()}`)
    const right = join(siteDir, `.index-check-${randomUUID()}`)
    try {
      await staticLink(previous, left)
      await staticLink(previous, right)
      await rename(left, right)
    } catch (cause) {
      throw failure('Filesystem cannot atomically replace the public index symbolic link', 501, 'ATOMIC_DEPLOY_UNSUPPORTED', { cause })
    } finally {
      await rm(left, { force: true })
      await rm(right, { force: true })
    }
  }
  return { releases, index, previous }
}

async function copyStatic(output, parent, previewId) {
  const hash = await treeHash(output)
  const destination = join(parent, previewId || hash)
  if (await checkedPath(destination)) {
    if (await treeHash(destination) !== hash) throw failure('Existing immutable static directory has different content', previewId ? 409 : 500, previewId ? 'PREVIEW_CONFLICT' : 'INVALID_RELEASE')
    return { directory: destination, created: false }
  }
  const temporary = join(parent, `.copy-${randomUUID()}`)
  try {
    await cp(output, temporary, { recursive: true, dereference: false, force: false, errorOnExist: true })
    if (await treeHash(temporary, true) !== hash) throw failure('Static output changed during release copy', 500, 'INVALID_RELEASE')
    if (previewId) await chmod(temporary, 0o700)
    await rename(temporary, destination)
  } finally { await rm(temporary, { recursive: true, force: true }) }
  return { directory: destination, created: true }
}

/** Caller serializes jobs and owns previews/<jobid> expiry, credentials, and job persistence.
 * gitSshCommand is trusted deployment configuration, never snapshot/request data.
 * build({ workspace, python, nodePath }) is an optional trusted test adapter.
 */
export function createPublisher(options) {
  const { repoDir, workDir, siteDir, python, depsDir, nodePath = process.execPath, gitSshCommand, onProgress = async () => {}, syncTags = async () => {}, build, buildTimeoutMs = 300000 } = options
  for (const [name, value] of Object.entries({ repoDir, workDir, siteDir, python, depsDir, nodePath })) {
    if (typeof value !== 'string' || !isAbsolute(value)) throw failure(`${name} must be absolute`)
  }
  if (!Number.isSafeInteger(buildTimeoutMs) || buildTimeoutMs <= 0) throw failure('Invalid build timeout')
  if (gitSshCommand !== undefined && (typeof gitSshCommand !== 'string' || !gitSshCommand.trim() || /[\x00-\x1f\x7f]/.test(gitSshCommand))) throw failure('gitSshCommand must be a nonempty single-line string')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key) && !/^NODE_OPTIONS$/i.test(key)))
  const gitEnv = { ...env, GIT_TERMINAL_PROMPT: '0', ...(gitSshCommand === undefined ? {} : { GIT_SSH_COMMAND: gitSshCommand }) }
  const git = (cwd, args, extraEnv) => command('git', ['--no-pager', '--literal-pathspecs', '-c', `core.hooksPath=${join(workDir, '.disabled-hooks')}`, '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'commit.gpgSign=false', '-c', 'gc.auto=0', ...args], { cwd, env: { ...gitEnv, ...extraEnv }, label: `Git ${args[0]}` })
  const rev = async (cwd, value) => (await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`])).trim()
  const head = () => rev(repoDir, 'HEAD')
  async function fetchMain() {
    await git(repoDir, ['fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main'])
    return rev(repoDir, 'refs/remotes/origin/main')
  }
  async function ancestor(older, newer) {
    try { await git(repoDir, ['merge-base', '--is-ancestor', older, newer]); return true } catch (error) { if (error.exitCode === 1) return false; throw error }
  }
  async function approvedRevision(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{7,64}$/i.test(value)) throw failure('Revision must be a Git commit SHA')
    let commit
    try { commit = await rev(repoDir, value) } catch (cause) { throw failure('Unknown revision', 404, 'REVISION_NOT_FOUND', { cause }) }
    for (const ref of ['refs/remotes/origin/main', 'HEAD']) {
      let tip
      try { tip = await rev(repoDir, ref) } catch { continue }
      if (await ancestor(commit, tip)) return commit
    }
    throw failure('Revision is not reachable from origin/main or HEAD', 403, 'UNAPPROVED_REVISION')
  }
  async function safeTreePath(commit, path, allowMissing = false) {
    const output = await git(repoDir, ['ls-tree', '-z', commit, '--', path])
    if (!output && allowMissing) return false
    if (!/^100(?:644|755) blob [a-f0-9]+\t/.test(output) || output.slice(output.indexOf('\t') + 1, -1) !== path) throw failure('Content revision must name a regular file', 404, 'CONTENT_NOT_FOUND')
    return true
  }
  async function checkContentTree(commit, paths) {
    const tree = await git(repoDir, ['ls-tree', '-r', '-t', '-z', commit, '--', 'docs', 'navigation.yml'])
    const entries = new Map()
    for (const entry of tree.split('\0').filter(Boolean)) {
      const path = entry.slice(entry.indexOf('\t') + 1)
      const mode = entry.slice(0, 6)
      if (!['040000', '100644', '100755'].includes(mode)) throw failure(`Content tree contains a symbolic link or submodule: ${path}`)
      const key = path.toLowerCase()
      if (entries.has(key)) throw failure(`Content tree has a case-ambiguous path: ${path}`)
      entries.set(key, { path, mode })
    }
    for (const path of paths) {
      const parts = path.split('/')
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join('/')
        const entry = entries.get(prefix.toLowerCase())
        if (entry && (entry.path !== prefix || (i < parts.length ? entry.mode !== '040000' : entry.mode === '040000'))) throw failure(`Content path conflicts with the existing tree: ${path}`)
      }
    }
  }
  async function version(path, revision) {
    contentPath(path)
    const commit = await approvedRevision(revision)
    await safeTreePath(commit, path)
    return git(repoDir, ['show', `${commit}:${path}`])
  }
  async function history(path) {
    contentPath(path)
    const output = await git(repoDir, ['log', '-30', '--format=%H%x00%an%x00%aI%x00%s', 'HEAD', '--', path])
    return output.trimEnd().split('\n').filter(Boolean).map(line => {
      const [revision, author, date, message] = line.split('\0')
      return { revision, author, date, message }
    })
  }
  async function sync() {
    const remote = await fetchMain()
    if ((await git(repoDir, ['status', '--porcelain=v1', '--untracked-files=all'])).trim()) throw failure('Repository is dirty; sync requires a clean worktree', 409, 'DIRTY_REPOSITORY')
    let branch, upstream
    try {
      branch = (await git(repoDir, ['symbolic-ref', '--quiet', 'HEAD'])).trim()
      upstream = (await git(repoDir, ['rev-parse', '--symbolic-full-name', '@{upstream}'])).trim()
    } catch { throw failure('Repository must have a branch tracking origin/main', 409, 'INVALID_REPOSITORY') }
    if (!branch.startsWith('refs/heads/') || upstream !== 'refs/remotes/origin/main') throw failure('Repository branch must track origin/main', 409, 'INVALID_REPOSITORY')
    if (!await ancestor(await head(), remote)) throw failure('Repository branch diverged from origin/main; fast-forward refused', 409, 'PUBLISH_CONFLICT')
    await git(repoDir, ['merge', '--ff-only', '--no-edit', remote])
    return head()
  }
  async function execute(input) {
    let snapshot, jobDir, workspace, commit, preview, executionError, keepPreview = false, worktreeRemoved = false, pushed = false, switched = false, deploy, nextIndex, status = 'building'
    const progress = (phase, extra = {}) => {
      if (['syncing-tags', 'committing', 'committed'].includes(phase)) status = 'committing'
      if (['pushing', 'pushed', 'deploying', 'published'].includes(phase)) status = 'publishing'
      return onProgress(snapshot?.id ?? input?.id, status, { phase, ...(commit ? { commit } : {}), ...extra })
    }
    async function removeWorkspace() {
      if (!workspace) return
      if (!worktreeRemoved) {
        // Unlink dependencies before removing only this private worktree.
        await rm(join(workspace, 'node_modules'), { force: true })
        await git(repoDir, ['worktree', 'remove', '--force', workspace])
        worktreeRemoved = true
      }
      await rm(jobDir, { recursive: true, force: true })
      workspace = undefined
    }
    try {
      snapshot = structuredClone(input)
      validate(snapshot)
      await progress('preparing', { baseCommit: snapshot.baseCommit })
      if (snapshot.kind === 'publish') await fetchMain()
      const base = await approvedRevision(snapshot.baseCommit)
      const paths = [...snapshot.files, ...snapshot.media].map(item => item.path)
      await checkContentTree(base, [...paths, ...(snapshot.targetPath ? [snapshot.targetPath] : [])])
      await directory(workDir)
      jobDir = await mkdtemp(join(workDir, 'job-'))
      workspace = join(jobDir, 'workspace')
      await git(repoDir, ['worktree', 'add', '--detach', workspace, base])
      for (const item of snapshot.files) await writeContent(workspace, item.path, item.content)
      for (const item of snapshot.media) {
        const bytes = await regularBytes(item.source)
        if (digest(bytes) !== item.path.split('/').at(-1).slice(0, -5)) throw failure(`Upload hash does not match its filename: ${item.path}`)
        const existing = await checkedPath(join(workspace, item.path))
        if (existing && !bytes.equals(await regularBytes(join(workspace, item.path)))) throw failure('An immutable upload already exists with different bytes', 409, 'UPLOAD_CONFLICT')
        await writeContent(workspace, item.path, bytes)
      }
      for (const path of paths) {
        if (await stat(join(workspace, path)) || await safeTreePath(base, path, true)) await git(workspace, ['add', '--all', '--force', '--', path])
      }
      const stagedTree = (await git(workspace, ['write-tree'])).trim()
      const baseTree = (await git(workspace, ['rev-parse', `${base}^{tree}`])).trim()
      async function compatibleRemote(fetch = false) {
        const remote = fetch ? await fetchMain() : await rev(repoDir, 'refs/remotes/origin/main')
        if (remote !== base && (!await ancestor(base, remote) || (await git(repoDir, ['rev-parse', `${remote}^{tree}`])).trim() !== stagedTree)) {
          throw failure(`origin/main changed from snapshot base ${base} to ${remote}; refresh the content before publishing`, 409, 'PUBLISH_CONFLICT', { baseCommit: base, remoteCommit: remote })
        }
        return remote
      }
      if (snapshot.kind === 'publish') await compatibleRemote()
      // Build generators may change files; only this pre-build index is committed.
      await checkedPath(join(workspace, '.cache'))
      await directory(join(workspace, '.cache'))
      await rm(join(workspace, '.cache', 'site-current.json'), { force: true })
      if (await stat(join(workspace, 'node_modules'))) throw failure('Worktree must not contain node_modules')
      if (!(await stat(join(depsDir, 'node_modules')))?.isDirectory()) throw failure('depsDir must contain trusted node_modules')
      await symlink(join(depsDir, 'node_modules'), join(workspace, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
      await progress('building')
      if (build) await build({ workspace, python, nodePath })
      else await command(nodePath, ['--max-old-space-size=512', 'scripts/build-site.mjs'], { cwd: workspace, env: { ...env, WIKI_PYTHON: python }, timeout: buildTimeoutMs, tree: true, label: 'Site build' })
      const output = await buildOutput(workspace)
      if ((await git(workspace, ['write-tree'])).trim() !== stagedTree) throw failure('Build changed the staged content', 500, 'BUILD_CHANGED_CONTENT')
      for (const path of paths) {
        if ((await git(workspace, ['diff', '--name-only', '--', path])).trim()) throw failure(`Build changed snapshot content: ${path}`, 500, 'BUILD_CHANGED_CONTENT')
      }
      await progress('built')
      if (snapshot.kind === 'preview') {
        const previews = join(workDir, 'previews')
        await directory(previews)
        await chmod(previews, 0o700)
        preview = await copyStatic(output, previews, snapshot.id)
        await removeWorkspace()
        const result = { previewDir: preview.directory, baseCommit: base, ...(snapshot.targetPath ? { targetPath: snapshot.targetPath } : {}) }
        await progress('preview-ready', result)
        keepPreview = true
        return result
      }
      deploy = await deployment(siteDir)
      const { directory: releaseDir } = await copyStatic(output, deploy.releases)
      await compatibleRemote(true)
      await progress('syncing-tags')
      await syncTags(snapshot)
      const remote = await compatibleRemote(true)
      if (remote !== base || stagedTree === baseTree) {
        commit = remote
        await progress('committed', { unchanged: true })
      } else {
        await progress('committing')
        const email = `editor-${digest(String(snapshot.actor.id)).slice(0, 24)}@wiki.invalid`
        await git(workspace, ['commit', '-m', snapshot.message?.trim() || `Update wiki content (${snapshot.id})`], { GIT_AUTHOR_NAME: snapshot.actor.username, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: 'Wiki Publisher', GIT_COMMITTER_EMAIL: 'publisher@wiki.invalid' })
        commit = await rev(workspace, 'HEAD')
        await progress('committed')
      }
      if (commit !== remote) {
        await progress('pushing')
        try { await git(workspace, ['push', 'origin', 'HEAD:main']) } catch (cause) {
          const current = await fetchMain()
          if (current !== commit) {
            if (current !== remote) throw failure(`origin/main changed to ${current} while publishing; push refused`, 409, 'PUBLISH_CONFLICT', { remoteCommit: current, cause })
            throw cause
          }
        }
      }
      pushed = true
      await progress('pushed')
      const current = await fetchMain()
      if (current !== commit) throw failure(`origin/main changed to ${current} before deployment; public index was preserved`, 409, 'PUBLISH_CONFLICT', { remoteCommit: current })
      await removeWorkspace()
      await progress('deploying', { releaseDir })
      nextIndex = join(siteDir, `.index-${randomUUID()}`)
      await staticLink(relative(siteDir, releaseDir), nextIndex)
      await rename(nextIndex, deploy.index)
      switched = true
      const result = { commit, baseCommit: base, releaseDir, ...(snapshot.targetPath ? { targetPath: snapshot.targetPath } : {}) }
      await progress('published', result)
      return result
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught))
      executionError = error
      if (switched) {
        try {
          if (deploy.previous) {
            await staticLink(deploy.previous, nextIndex)
            await rename(nextIndex, deploy.index)
          } else await unlink(deploy.index)
        } catch (rollbackError) { error.rollbackError = rollbackError }
      }
      if (commit) error.commit = commit
      error.pushed = pushed
      error.status ??= 500
      error.statusCode ??= error.status
      try { await progress('failed', { error: error.message, pushed }) } catch (progressError) { error.progressError = progressError }
      throw error
    } finally {
      if (nextIndex) await rm(nextIndex, { force: true }).catch(() => {})
      if (preview?.created && !keepPreview) await rm(preview.directory, { recursive: true, force: true }).catch(() => {})
      try { await removeWorkspace() } catch (cleanupError) { if (executionError) executionError.cleanupError = cleanupError }
    }
  }
  return { execute, sync, head, history, version }
}
