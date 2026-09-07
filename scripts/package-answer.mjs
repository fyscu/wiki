import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve('.cache/answer')
const context = resolve('.cache/answer-runtime')
await mkdir(root, { recursive: true })
await mkdir(context, { recursive: true })
const archive = resolve(root, 'answer-linux.tar.gz')
if (!existsSync(archive)) {
  const response = await fetch('https://github.com/apache/answer/releases/download/v2.0.2/apache-answer-2.0.2-bin-linux-amd64.tar.gz', { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  await writeFile(archive, Buffer.from(await response.arrayBuffer()))
}
const hash = createHash('sha256').update(await readFile(archive)).digest('hex')
if (hash !== '4724dccf336acc7885d1f7206700dd22869562be5dbd8b89de83fe82d09efe25') throw new Error('Answer release checksum mismatch')
const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' })
if (listing.status !== 0 || listing.stdout.split('\n').filter(Boolean).some(name =>
  !name.startsWith('apache-answer-2.0.2-bin-linux-amd64/') || name.split('/').includes('..'))) throw new Error('Unexpected archive entries')
if (spawnSync('tar', ['-xzf', archive, '-C', root], { stdio: 'inherit' }).status !== 0) throw new Error('Extraction failed')
await copyFile(resolve(root, 'apache-answer-2.0.2-bin-linux-amd64/answer'), resolve(context, 'answer'))
if (!existsSync(resolve(context, 'ca-certificates.crt'))) {
  const response = await fetch('https://curl.se/ca/cacert.pem', { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error('CA bundle download failed')
  await writeFile(resolve(context, 'ca-certificates.crt'), await response.text())
}
const result = spawnSync('docker', ['build', '--pull=false', '-f', 'deploy/Dockerfile.answer-runtime', '-t', 'feiyang/answer-runtime:2.0.2', context], { stdio: 'inherit' })
if (result.status !== 0) throw new Error('Image build failed')
console.log('Answer 2.0.2 runtime image built from the checksum-verified official binary.')
