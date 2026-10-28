'use strict';
const pw=require('./playwright.js');
// GPU workloads supply their own flags and always request Chrome or WebKit.
// Interface tools default to installed Chrome; CSP_UI_BROWSER=chromium uses
// Playwright's downloaded Chromium, or webkit selects its WebKit installation.
function launchBrowser(name='chrome',options={}){
  if(name==='webkit')return pw.webkit.launch({headless:true,...options});
  if(!['chrome','chromium'].includes(name))throw Error('Unknown browser: '+name);
  return pw.chromium.launch({headless:true,channel:name==='chrome'?'chrome':undefined,...options});
}
const launchUIBrowser=options=>launchBrowser(process.env.CSP_UI_BROWSER||'chrome',options);
module.exports={launchBrowser,launchUIBrowser};
