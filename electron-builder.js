/* electron-builder configuration. The Mac app bundles the engine and the web
   client listed in site.json (the engine builds app.js from app/), plus the
   vendor directory. */
const site=require("./site.json");
const arch=["arm64","x64"];

module.exports={
  appId:"com.rileyg44.clear-skies-portal",
  productName:"Clear Skies Portal",
  artifactName:"ClearSkies-${version}-${arch}.${ext}",
  directories:{buildResources:"build",output:"dist"},
  files:["electron/**/*","package.json"],
  extraResources:[{from:".",to:"app",filter:[...site.web,...site.app,...site.engine,"vendor/**/*"]},
    {from:"build/icon.ico",to:"ClearSkies.ico"}],
  win:{target:[{target:"nsis",arch:["x64"]},{target:"zip",arch:["x64"]}],icon:"build/icon.ico",
    executableName:"Clear Skies Portal",signAndEditExecutable:true},
  nsis:{oneClick:true,perMachine:false,allowElevation:false,runAfterFinish:true,
    artifactName:"ClearSkies-Setup-${version}-${arch}.exe",shortcutName:"Clear Skies Portal",
    createDesktopShortcut:true,createStartMenuShortcut:true,deleteAppDataOnUninstall:false,
    installerIcon:"build/icon.ico",uninstallerIcon:"build/icon.ico",installerHeaderIcon:"build/icon.ico",
    include:"build/installer.nsh"},
  mac:{
    target:[{target:"dmg",arch},{target:"zip",arch}],
    category:"public.app-category.reference",
    icon:"build/icon.icns",
    darkModeSupport:true,
    hardenedRuntime:true,
    gatekeeperAssess:false,
    entitlements:"build/entitlements.mac.plist",
    entitlementsInherit:"build/entitlements.mac.plist",
    extendInfo:{
      NSLocationWhenInUseUsageDescription:"Clear Skies Portal uses your location only to centre the map on where you are.",
      NSHumanReadableCopyright:"MIT licensed. Imagery from Copernicus, NASA, USGS and WA DNR."
    }
  },
  dmg:{title:"Clear Skies Portal"}
};
