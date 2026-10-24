await new Promise(r=>setTimeout(r,4000));
const files=['gpu-terrain-engine.js','gpu-terrain-layer.js','gpu-terrain-store.js','gpu-terrain-shaders.js','tile-pipeline.js','version.js'];
const hashes={};for(const file of files){const response=await fetch(file);const bytes=await response.arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',bytes);hashes[file]=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
return {passed:true,build:CSP_BUILD,hashes};
