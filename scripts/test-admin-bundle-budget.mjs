import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const assetsDir = 'apps/admin/dist/assets';
if (!fs.existsSync(assetsDir)) {
  throw new Error('Admin build output is missing; run the production build first');
}
const scripts = fs.readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
const entrypoints = scripts.filter((name) => /^index-[^/]+\.js$/.test(name));
if (entrypoints.length === 0) throw new Error('No initial Admin application JS entrypoint was emitted');
const summary = scripts.map((name) => {
  const contents = fs.readFileSync(path.join(assetsDir, name));
  return {
    name,
    minifiedBytes: contents.byteLength,
    gzipBytes: gzipSync(contents).byteLength,
  };
});
for (const asset of summary.sort((left, right) => right.minifiedBytes - left.minifiedBytes)) {
  console.log(`${asset.name}: ${asset.minifiedBytes} minified / ${asset.gzipBytes} gzip bytes`);
}
for (const asset of summary.filter((item) => entrypoints.includes(item.name))) {
  if (asset.minifiedBytes > 500_000) {
    throw new Error(`Admin initial application chunk exceeds 500 kB: ${asset.name}`);
  }
}
console.log('Admin initial application chunk budget passed (500 kB).');
