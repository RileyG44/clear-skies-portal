// Rebuild the independent reference with the bundled official Esri decoder.
// Run from any directory: node native/fixtures/lerc/generate.cjs
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const source = 'test-fixtures/oregon/hood-survey-edge.lerc';
const lerc = require(path.join(root, 'vendor/lerc/LercDecode.js'));
(async () => {
  await lerc.load();
  const raw = fs.readFileSync(path.join(root, source));
  const decoded = lerc.decode(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const bytes = Buffer.alloc(decoded.width * decoded.height * 4);
  let valid = 0;
  for (let i = 0; i < decoded.width * decoded.height; i++) {
    if ((!decoded.mask || decoded.mask[i]) && Number.isFinite(decoded.pixels[0][i])) {
      bytes.writeFloatLE(decoded.pixels[0][i], i * 4);
      valid++;
    } else bytes.writeUInt32LE(0x7fc00000, i * 4);
  }
  const reference = {
    source, reference: 'bundled Esri LERC WASM decoder',
    width: decoded.width, height: decoded.height, valid,
    canonicalFloat32Sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  fs.writeFileSync(path.join(__dirname, 'hood-survey-edge.json'), JSON.stringify(reference, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
