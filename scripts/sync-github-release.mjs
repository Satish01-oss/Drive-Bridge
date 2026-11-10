import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = 'Satish01-oss/Drive-Bridge';
const partSize = 8 * 1024 * 1024;

export function selectAsset(release) {
  if (release.draft || release.prerelease) throw new Error('Only published, non-prerelease releases can become the main download');
  const version = /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(release.tag_name)?.[1];
  if (!version) throw new Error('Release tag must be vMAJOR.MINOR.PATCH (for example v0.8.0)');
  const installer = `DeviceBridge-Setup-${version}.exe`;
  const filename = release.assets?.some(a=>a.name===installer) ? installer : `DeviceBridge-${version}.exe`;
  const assets = release.assets?.filter(a => a.name === filename) || [];
  if (assets.length !== 1 || assets[0].state !== 'uploaded') throw new Error(`Attach exactly one uploaded ${filename} before publishing the release`);
  const asset = assets[0];
  const maximum = filename === installer ? 512 : 200;
  if (!Number.isSafeInteger(asset.size) || asset.size < 512 || asset.size > maximum * 1024 * 1024) throw new Error(`EXE size is invalid (maximum ${maximum} MiB)`);
  const url = new URL(asset.browser_download_url);
  if (url.origin !== 'https://github.com' || url.pathname !== `/${repository}/releases/download/${release.tag_name}/${filename}` || url.search || url.hash) throw new Error('EXE must be an asset of this repository and release');
  if (asset.digest && !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) throw new Error('Invalid GitHub asset digest');
  if (!release.published_at || !Number.isFinite(Date.parse(release.published_at))) throw new Error('Release publication date is missing');
  return { version, filename, kind:filename===installer?'installer':'portable', asset, url: url.href };
}

export function validateExe(bytes, asset) {
  if (bytes.length !== asset.size) throw new Error('Downloaded EXE size differs from the release asset');
  const pe = bytes.length >= 64 ? bytes.readUInt32LE(60) : bytes.length;
  if (bytes.toString('ascii', 0, 2) !== 'MZ' || pe < 64 || pe + 26 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550) throw new Error('Release asset is not a Windows PE executable');
  const x64 = bytes.readUInt16LE(pe+4)===0x8664 && bytes.readUInt16LE(pe+24)===0x20b;
  const installerStub = /^DeviceBridge-Setup-\d+\.\d+\.\d+\.exe$/.test(asset.name || '') && bytes.readUInt16LE(pe+4)===0x14c && bytes.readUInt16LE(pe+24)===0x10b;
  if (!x64 && !installerStub) throw new Error('Expected the Windows x64 app or its standard installer launcher');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (asset.digest && asset.digest.toLowerCase() !== `sha256:${sha256}`) throw new Error('EXE does not match GitHub SHA-256 digest');
  return sha256;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function field(html, attribute, value, raw = false) {
  const pattern = new RegExp(`(<([a-z][a-z0-9]*)\\b[^>]*\\b${attribute}(?=\\s|>)[^>]*>)[\\s\\S]*?(<\\/\\2>)`, 'gi');
  return html.replace(pattern, (_, start, tag, end) => start + (raw ? value : escapeHtml(value)) + end);
}
export function renderRelease(html, manifest) {
  html = field(html, 'data-release-version', manifest.version);
  html = field(html, 'data-release-filename', manifest.filename);
  html = field(html, 'data-release-size', `${Math.ceil(manifest.bytes / 1024 / 1024)} MB · One file`);
  html = field(html, 'data-release-date', new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(manifest.publishedAt)));
  html = field(html, 'data-release-channel', 'Release');
  if (manifest.kind === 'installer') {
    html = field(html, 'data-release-setup', 'Run the installer once on each PC, then open DeviceBridge from your desktop or Start menu. Connect both PCs to the same trusted router—Wi-Fi, Ethernet, or one of each.');
    html = field(html, 'data-release-faq', 'One installer includes the app, its runtime and the microphone driver. Install DeviceBridge on both PCs, then open it from the desktop shortcut. For microphone sharing, set up the included VB-CABLE driver once on the other PC, approve Windows access and restart if needed.');
  }
  html = field(html, 'data-release-changes', `<li>Windows x64 ${manifest.kind==='installer'?'installer':'app'} · v${escapeHtml(manifest.version)}</li><li>EXE size and SHA-256 verified before publication</li><li><a href="${escapeHtml(manifest.releaseUrl)}" target="_blank" rel="noopener">Read what’s new on GitHub ↗</a></li>`, true);
  return field(html, 'data-release-caption', 'The download is synced from the latest published GitHub release. Use the same version on both PCs. See its release notes for changes and testing details.');
}

export async function syncRelease({root = resolve('frontend/site'), fetcher = fetch, token = process.env.GITHUB_TOKEN} = {}) {
  const response = await fetcher(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: {Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28', ...(token ? {Authorization:`Bearer ${token}`} : {})},
    signal: AbortSignal.timeout(30_000)
  });
  if (response.status === 404) {
    console.log('No published stable GitHub release yet; keeping the checked-in v0.7.0 download.');
    return null;
  }
  if (!response.ok) throw new Error(`Could not read latest GitHub release: HTTP ${response.status}`);
  const release = await response.json();
  const {version, filename, kind, asset, url} = selectAsset(release);
  // No API credential is sent to the public asset URL or its redirects.
  const download = await fetcher(url, {signal:AbortSignal.timeout(180_000)});
  if (!download.ok) throw new Error(`Could not download release EXE: HTTP ${download.status}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  const sha256 = validateExe(bytes, asset);
  const releaseUrl = `https://github.com/${repository}/releases/tag/${release.tag_name}`;
  const manifest = {version, filename, kind, bytes:bytes.length, sha256, publishedAt:release.published_at, releaseUrl, parts:[]};
  const names = ['index.html', 'test.html'];
  const pages = await Promise.all(names.map(name => readFile(join(root, name), 'utf8')));
  // All network/integrity checks finish before any website files change.
  const downloadsDirectory = resolve(root, 'downloads');
  if (dirname(downloadsDirectory) !== resolve(root)) throw new Error('Download directory must remain within the website output');
  await rm(downloadsDirectory, {recursive:true,force:true});
  await mkdir(downloadsDirectory, {recursive:true});
  for (let offset=0, index=0; offset < bytes.length; offset+=partSize, index++) {
    const part = `downloads/devicebridge-${version}-${sha256.slice(0,12)}-${String(index).padStart(2,'0')}.part`;
    await writeFile(join(root, part), bytes.subarray(offset, offset + partSize));
    manifest.parts.push(part);
  }
  for (const name of ['release.json','test-release.json']) await writeFile(join(root, name), JSON.stringify(manifest,null,2)+'\n');
  for (let i=0; i<names.length; i++) await writeFile(join(root,names[i]),renderRelease(pages[i],manifest));
  console.log(`Prepared ${filename}: ${bytes.length} bytes, SHA-256 ${sha256}`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncRelease();
}
