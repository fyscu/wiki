import { readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const { directory } = JSON.parse(await readFile('.cache/site-current.json', 'utf8'))
if (!relative(resolve('.cache'), directory).startsWith('site-build-')) throw new Error('Invalid build directory')
for (const file of ['index.html', 'questions/index.html', 'ask/index.html', 'question/index.html', 'login/index.html']) {
  if (!(await readFile(resolve(directory, file), 'utf8')).includes('</html>')) throw new Error(`Incomplete page: ${file}`)
}
const result = spawnSync('tar', ['-czf', '.cache/wiki-dist.tar.gz', '-C', directory, '.'], { stdio: 'inherit' })
if (result.status !== 0) throw new Error('Packaging failed')
console.log('Packaged the verified build in .cache/wiki-dist.tar.gz')
