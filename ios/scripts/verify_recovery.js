// Invoke the app's actual recovery delegate and verify the new WebContent
// page, including 3D and a selected place. Native Debug code restores this
// probe's prior state/preferences and writes the result after the reload.
const B=ClearSkiesPortalBridge;
const original={session:B.sessionState(),style:document.querySelector('#terStyle').value,preferences:localStorage.getItem('clearskies.terrain.v2')};
await B.restoreSession({center:[47.35,-119.1],zoom:12.75,bearing:37,pitch:32,mode:'3d',location:{lat:47.351,lng:-119.101,label:'Recovery verification'}});
await new Promise(resolve=>setTimeout(resolve,1200));
await window.webkit.messageHandlers.cspNative.postMessage({type:'debug.recovery',runID:__cspDebugRunID,original});
return await new Promise(()=>{});
