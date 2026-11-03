const base = require("./electron-builder");
module.exports = {...base, win:{...base.win,target:[{target:"nsis",arch:["x64"]}]},
  nsis:{...base.nsis,oneClick:false,allowElevation:true,allowToChangeInstallationDirectory:true,
    installerSidebar:"build/installerSidebar.bmp",uninstallerSidebar:"build/installerSidebar.bmp",
    artifactName:"ClearSkies-Guided-Setup-${version}-${arch}.exe"}};
