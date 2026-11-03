"use strict";
const {execFileSync}=require("child_process");
const run=args=>execFileSync(process.execPath,args,{stdio:"inherit"});
run(["build/make-icon.js","--windows"]);
run([require.resolve("electron-builder/cli.js"),"--config","electron-builder.js","--win","--x64","--dir","--publish","never"]);
for(const config of ["electron-builder.js","electron-builder-guided.js"])
  run([require.resolve("electron-builder/cli.js"),"--config",config,"--prepackaged","dist/win-unpacked","--win","--x64","--publish","never"]);
