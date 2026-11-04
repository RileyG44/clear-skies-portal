'use strict';
// ui-icons.js must match vendor/icons exactly; regenerate with `npm run ui-icons`.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {source}=require('./scripts/build-ui-icons.js');
assert.equal(fs.readFileSync('ui-icons.js','utf8'),source(),'ui-icons.js is stale: run npm run ui-icons');
const window={};new Function('window',fs.readFileSync('ui-icons.js','utf8'))(window);
const names=fs.readdirSync('vendor/icons').filter(f=>f.endsWith('.svg'));
assert.equal(Object.keys(window.CSPIcons).length,names.length);
for(const file of names)assert.equal(decodeURIComponent(window.CSPIcons[file.slice(0,-4)].slice('data:image/svg+xml,'.length)),fs.readFileSync('vendor/icons/'+file,'utf8').trim());
console.log(`ui icons: ${names.length} inline icons match vendor/icons`);
