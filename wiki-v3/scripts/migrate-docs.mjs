import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../docs/', import.meta.url));
const target = fileURLToPath(new URL('../wiki/docs/', import.meta.url));
const community = 'https://bbs.feiyang.ac.cn';

function files(directory) {
  return readdirSync(join(source, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
  });
}

const sections = ['intro', 'handbook', 'network', 'software'];
const markdown = ['index.md', 'contribute.md', ...sections.flatMap(files).filter((path) => path.endsWith('.md'))];
for (const path of markdown) {
  const destination = join(target, path);
  const images = relative(dirname(destination), join(target, 'images', 'manual')).split(sep).join('/');
  const content = readFileSync(join(source, path), 'utf8')
    .replaceAll('/images/manual/', `${images}/`)
    .replace(/^<div class="feiyang-wordmark">.*?<\/div>\r?\n\r?\n/m, '')
    .replace(/\[知识问答\]\((?:\.\.\/)?questions\.md\)/g, `[问答社区](${community})`)
    .replace(/^!\[[^\]\n]*\]\(<\/images\/uploads\/[^>\n]+>\)\r?\n?/gm, '');
  mkdirSync(dirname(destination), { recursive: true });
  const editLink = '\n可通过[在线编辑](/admin/index.html)提交文档修改，或在 GitHub 上发起 Pull Request。\n';
  writeFileSync(destination, path === 'contribute.md' ? content.trimEnd() + '\n' + editLink : content);
}

const images = files(join('images', 'manual')).filter((path) => /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(path));
for (const path of images) {
  const destination = join(target, path);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(source, path), destination);
}

console.log(`已迁移 ${markdown.length} 篇文档、${images.length} 张图片。`);
