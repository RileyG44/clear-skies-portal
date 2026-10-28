/* site.json, plus the one file built from it: app.js, the browser application,
   is the app/ files joined in order inside one function scope, exactly as it
   once ran inline. scripts/assemble-site.py builds the same bytes. */
const fs=require("fs");
const path=require("path");
const site=require("./site.json");

const appSource=(root=__dirname)=>
  "(()=>{\n"+site.app.map(file=>fs.readFileSync(path.join(root,file),"utf8")).join("")+"})();\n";

module.exports={...site,appSource};
