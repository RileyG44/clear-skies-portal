"use strict";
exports.windowChrome = platform => platform === "win32"
  ? {titleBarStyle:"hidden",autoHideMenuBar:true,
    titleBarOverlay:{color:"#00000000",symbolColor:"#ffffff",height:30}}
  : platform === "darwin" ? {titleBarStyle:"hidden",trafficLightPosition:{x:12,y:9}}
  : {titleBarStyle:"default"};
