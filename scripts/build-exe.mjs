// Builds dist/MediaCenter.exe: a single Windows x64 executable (Node SEA) with the UI embedded.
// Works from Windows, Linux or macOS:  npm run build:exe
// The Windows node.exe base must be the SAME Node version as the one running this script.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as ResEdit from 'resedit';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build'), OUT = path.join(ROOT, 'dist');
const NODE_VER = process.version.slice(1);
const APP_VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const step = m => console.log(`\n> ${m}`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32', ...opts });
if (+NODE_VER.split('.')[0] < 22 || (NODE_VER.startsWith('22.') && +NODE_VER.split('.')[1] < 13)) { console.error(`Need Node 22.13+ to build (have ${NODE_VER}).`); process.exit(1); }
fs.rmSync(BUILD, { recursive: true, force: true }); fs.mkdirSync(BUILD, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });

step('Building UI (vite)');
run('npx', ['vite', 'build', 'web', '--emptyOutDir']);

step('Bundling server (esbuild -> CommonJS)');
await esbuild.build({ entryPoints: [path.join(ROOT, 'server/index.mjs')], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: path.join(BUILD, 'server.cjs'), logLevel: 'warning', logOverride: { 'empty-import-meta': 'silent' } });

step('Collecting UI assets');
const dist = path.join(ROOT, 'web', 'dist'); const assets = {}; const keys = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const k = path.relative(dist, p).split(path.sep).join('/'); keys.push(k); assets[k] = p; } } })(dist);
fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify(keys)); assets['manifest.json'] = path.join(BUILD, 'manifest.json');
console.log(`  ${keys.length} files`);

step(`Creating SEA blob (Node ${NODE_VER})`);
const cfg = { main: path.join(BUILD, 'server.cjs'), output: path.join(BUILD, 'sea.blob'), disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets };
fs.writeFileSync(path.join(BUILD, 'sea-config.json'), JSON.stringify(cfg, null, 1));
execFileSync(process.execPath, ['--experimental-sea-config', path.join(BUILD, 'sea-config.json')], { stdio: 'inherit' });

step('Getting Windows node.exe');
let baseExe;
if (process.platform === 'win32' && process.arch === 'x64') baseExe = process.execPath;
else {
  const cache = path.join(ROOT, '.cache', `node-win-x64-${NODE_VER}`); baseExe = path.join(cache, 'package', 'bin', 'node.exe');
  if (!fs.existsSync(baseExe)) {
    fs.mkdirSync(cache, { recursive: true });
    run('npm', ['pack', `node-win-x64@${NODE_VER}`, '--silent', '--pack-destination', cache]);
    run('tar', ['-xzf', `node-win-x64-${NODE_VER}.tgz`], { cwd: cache });
  }
}
console.log('  ' + baseExe);

const tmpExe = path.join(BUILD, 'MediaCenter.exe'); fs.copyFileSync(baseExe, tmpExe);
step('Injecting app into exe (postject)');
run(process.execPath, [path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js'), tmpExe, 'NODE_SEA_BLOB', path.join(BUILD, 'sea.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite']);
step('Setting icon + version info');
const exe = ResEdit.NtExecutable.from(fs.readFileSync(tmpExe), { ignoreCert: true }); // drops Node's signature (invalid after injection anyway)
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(ROOT, 'build-assets', 'icon.ico')));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const gid = groups[0]?.id ?? 1, glang = groups[0]?.lang ?? 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, glang, ico.icons.map(i => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] ?? ResEdit.Resource.VersionInfo.createEmpty();
const [a, b, c] = APP_VER.split('.').map(Number);
for (const l of vi.getAllLanguagesForStringValues()) vi.removeAllStringValues(l);
vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'Media Center', FileDescription: 'Media Center', CompanyName: 'Seb', OriginalFilename: 'MediaCenter.exe', InternalName: 'MediaCenter', FileVersion: APP_VER, ProductVersion: APP_VER, LegalCopyright: '' });
vi.outputToResourceEntries(res.entries); res.outputResource(exe);
fs.writeFileSync(tmpExe, Buffer.from(exe.generate()));

const final = path.join(OUT, 'MediaCenter.exe'); fs.copyFileSync(tmpExe, final);
console.log(`\nDone: ${final} (${(fs.statSync(final).size / 1048576).toFixed(1)} MB)`);
