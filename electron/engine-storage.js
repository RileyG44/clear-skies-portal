"use strict";
const fs=require("fs"),path=require("path");
exports.engineStorage=(userData,legacyRoot)=>{
  const markup=path.join(userData,"markup"),cache=path.join(userData,"cache");
  if(!fs.existsSync(markup)){
    const legacy=[path.join(userData,"legacy-markup"),legacyRoot&&path.join(legacyRoot,"markup")]
      .find(dir=>dir&&fs.existsSync(dir));
    fs.mkdirSync(userData,{recursive:true});
    if(legacy){
      // Copy first, then atomically expose it. Never overwrite a user's newer store.
      const staged=fs.mkdtempSync(path.join(userData,"markup-migration-"));
      for(const entry of fs.readdirSync(legacy,{withFileTypes:true}))
        if(entry.isFile()&&(entry.name.endsWith(".geojson")||entry.name===".deleted.json"))
          fs.copyFileSync(path.join(legacy,entry.name),path.join(staged,entry.name),fs.constants.COPYFILE_EXCL);
      fs.renameSync(staged,markup);
    }else fs.mkdirSync(markup,{recursive:true});
  }
  return {cache,markup};
};
