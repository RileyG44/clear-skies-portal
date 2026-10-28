/* The page as tests read it: markup, base styles and the built app, in the
   order they once sat inline in index.html. */
const fs=require("fs"),path=require("path");
const root=path.join(__dirname,"..");
module.exports=[fs.readFileSync(path.join(root,"index.html"),"utf8"),fs.readFileSync(path.join(root,"ui-base.css"),"utf8"),
  require("../site.js").appSource(root)].join("\n");
