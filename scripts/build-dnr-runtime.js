"use strict";
const path=require("node:path");
const fs=require("node:fs");
const result=require("esbuild").buildSync({
  entryPoints:[path.join(__dirname,"..","dnr-raster-source.mjs")],
  outfile:path.join(__dirname,"..","vendor","dnr-runtime.cjs"),
  bundle:true,platform:"node",format:"cjs",target:"node22",minify:true,
  legalComments:"eof",metafile:true
});
const packages=new Map();
for(const input of Object.keys(result.metafile.inputs)){
  let dir=path.dirname(path.resolve(input));
  while(dir.includes("node_modules")){
    const manifest=path.join(dir,"package.json");
    if(fs.existsSync(manifest)){
      const p=JSON.parse(fs.readFileSync(manifest,"utf8"));
      if(p.name&&p.version)packages.set(`${p.name}@${p.version}`,dir);
      break;
    }
    dir=path.dirname(dir);
  }
}
const notices=[];
for(const [name,dir] of [...packages].sort(([a],[b])=>a.localeCompare(b))){
  const files=fs.readdirSync(dir).filter(f=>/^licen[cs]e(?:[.-]|$)|^copying(?:[.-]|$)/i.test(f)&&fs.statSync(path.join(dir,f)).isFile());
  if(name.startsWith("lerc@")&&!files.length){
    // LERC's npm distribution includes only a license link in README.
    // Retain Esri's upstream Apache text in the checked-in distribution.
    notices.push(name+"\nCopyright 2017-2021 Esri\n"+fs.readFileSync(path.join(__dirname,"..","vendor","dnr-lerc-LICENSE.txt"),"utf8"));
    continue;
  }
  if(!files.length)throw new Error(`Missing bundled dependency license: ${name}`);
  notices.push(name+"\n"+files.map(f=>fs.readFileSync(path.join(dir,f),"utf8")).join("\n"));
}
fs.writeFileSync(path.join(__dirname,"..","vendor","dnr-runtime-licenses.txt"),notices.join("\n\n"));
