import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = path.join(root, 'assets/vendor-manifest.json');
const definitions = [
  ['livekit-client', '2.23.0', 'dist/livekit-client.umd.js', 'assets/js/livekit-client.umd.js'],
  ['@ricky0123/vad-web', '0.0.31', 'dist/bundle.min.js', 'assets/vad/bundle.min.js'],
  ['@ricky0123/vad-web', '0.0.31', 'dist/bundle.min.js.LICENSE.txt', 'assets/vad/bundle.min.js.LICENSE.txt'],
  ['@ricky0123/vad-web', '0.0.31', 'dist/vad.worklet.bundle.min.js', 'assets/vad/vad.worklet.bundle.min.js'],
  ['@ricky0123/vad-web', '0.0.31', 'dist/silero_vad_v5.onnx', 'assets/vad/silero_vad_v5.onnx'],
  ['onnxruntime-web', '1.29.0', 'dist/ort.wasm.min.js', 'assets/vad/ort.wasm.min.js'],
  ['onnxruntime-web', '1.29.0', 'dist/ort-wasm-simd-threaded.mjs', 'assets/vad/ort-wasm-simd-threaded.mjs'],
  ['onnxruntime-web', '1.29.0', 'dist/ort-wasm-simd-threaded.wasm', 'assets/vad/ort-wasm-simd-threaded.wasm']
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const mode = process.argv[2];
if (mode === '--write') {
  const assets = [];
  for (const [name, version, source, destination] of definitions) {
    const packageRoot = path.join(root, 'node_modules', name);
    const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    if (metadata.version !== version) throw new Error(`Install the pinned ${name}@${version} with npm ci.`);
    const bytes = await readFile(path.join(packageRoot, source));
    await mkdir(path.dirname(path.join(root, destination)), { recursive: true });
    await copyFile(path.join(packageRoot, source), path.join(root, destination));
    assets.push({ path: destination, package: name, version, source, bytes: bytes.length, sha256: digest(bytes) });
  }
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, assets }, null, 2) + '\n');
  console.log(`Synchronized ${assets.length} assets from the pinned npm packages.`);
} else if (mode === '--check') {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.assets.length !== definitions.length) throw new Error('Unexpected asset manifest.');
  for (const [index, asset] of manifest.assets.entries()) {
    const [name, version, source, destination] = definitions[index];
    if (asset.path !== destination || asset.package !== name || asset.version !== version || asset.source !== source) throw new Error('Asset manifest does not match pinned definitions.');
    const bytes = await readFile(path.join(root, asset.path));
    if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256) throw new Error(`Asset integrity mismatch: ${asset.path}`);
  }
  console.log(`Verified ${manifest.assets.length} vendored asset hashes.`);
} else {
  console.error('Usage: node scripts/vendor-assets.mjs --check | --write');
  process.exitCode = 2;
}
