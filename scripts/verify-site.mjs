import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative } from 'node:path';

const root = resolve('dist');
async function localFile(path) {
  const resolved = resolve(path);
  if (relative(root, resolved).startsWith('..')) throw new Error(`File outside dist: ${path}`);
  if (!(await stat(resolved)).isFile()) throw new Error(`Not a file: ${path}`);
  return readFile(resolved);
}
for (const name of ['release.json', 'test-release.json']) {
  const m = JSON.parse(await localFile(resolve(root, name)));
  if (m.filename !== `DeviceBridge-${m.version}.exe`) throw new Error('Version and filename disagree');
  const hash = createHash('sha256');
  let bytes = 0;
  for (const part of m.parts) {
    const data = await localFile(resolve(root, part));
    hash.update(data);
    bytes += data.length;
  }
  if (bytes !== m.bytes || hash.digest('hex') !== m.sha256) throw new Error(`${name}: EXE integrity failed`);
  console.log(`${name}: ${m.filename}, ${bytes} bytes, SHA-256 verified`);
}
for (const name of ['index.html', 'test.html', 'credits.html']) {
  const path = resolve(root, name);
  const html = (await localFile(path)).toString();
  for (const [, link] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(?:https?:|#|mailto:|data:)/.test(link)) continue;
    if (link.startsWith('/')) throw new Error(`${name}: root-relative link breaks project hosting: ${link}`);
    await localFile(resolve(dirname(path), link.split(/[?#]/)[0]));
  }
  console.log(`${name}: local links and assets verified`);
}
