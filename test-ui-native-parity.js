'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const web=fs.readFileSync('ui-system.js','utf8'),native=fs.readFileSync('ios/Resources/native-shell.js','utf8');
const object=(source,start,end,name)=>vm.runInNewContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)))+`;${name}`);
test('phone task labels, descriptions and home groups stay equal to native iOS',()=>{
  const phone=object(web,'const PHONE_ROUTES=','const PHONE_GROUPS=','PHONE_ROUTES');
  const expected=object(native,'const NATIVE_ROUTES =','function nativeGroups()','NATIVE_ROUTES');
  assert.deepEqual(JSON.parse(JSON.stringify(phone)),JSON.parse(JSON.stringify(expected)));
  const groups=object(web,'const PHONE_GROUPS=','const wordmark=','PHONE_GROUPS');
  const start=native.indexOf('  function nativeGroups()'),end=native.indexOf('  const localDisclosure',start);
  const context={window:{CSPShell:{groups:()=>[{routes:Object.keys(phone).map(key=>({key}))}]}},NATIVE_ROUTES:phone};
  vm.createContext(context);vm.runInContext(native.slice(start,end),context);
  const expectedGroups=context.nativeGroups().map(group=>[group.label,group.routes.map(route=>route.key)]);
  assert.deepEqual(JSON.parse(JSON.stringify(groups)),JSON.parse(JSON.stringify(expectedGroups)));
});
test('the phone wordmark ships the native Pacifico font in every client',()=>{
  assert(fs.readFileSync('vendor/fonts/pacifico-regular.ttf').equals(fs.readFileSync('ios/Resources/Fonts/Pacifico.ttf')));
  assert(require('./site.json').vendor.includes('vendor/fonts/pacifico-regular.ttf'));
});
