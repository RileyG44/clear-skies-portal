"use strict";
const fs=require("fs"),path=require("path");
const DEFAULTS=Object.freeze({tileCacheGiB:15,dnrCacheGiB:32,dnrArchiveGiB:2,memoryCacheMiB:256,minFreeGiB:8,workers:0,panShading:"auto"});
const ranges={tileCacheGiB:[1,1024],dnrCacheGiB:[1,1024],dnrArchiveGiB:[.1,4],memoryCacheMiB:[32,1024],minFreeGiB:[1,1024],workers:[0,8]};
function validate(value){
  if(!value || typeof value!=="object" || Array.isArray(value))throw Error("Invalid setup configuration");
  const result={};
  for(const [key,[min,max]] of Object.entries(ranges)){
    const n=value[key];
    if(typeof n!=="number" || !Number.isFinite(n) || n<min || n>max || (["workers","memoryCacheMiB"].includes(key)&&!Number.isInteger(n)))
      throw Error(`Invalid ${key}: expected ${min}–${max}`);
    result[key]=n;
  }
  if(result.dnrArchiveGiB>result.dnrCacheGiB)throw Error("DNR download limit cannot exceed its terrain cache");
  if(!["off","auto","on"].includes(value.panShading))throw Error("Invalid smoother panning mode");
  return {...result,panShading:value.panShading};
}
const configPath=userData=>path.join(userData,"desktop-config.json");
function readConfig(userData){
  try{return validate({...DEFAULTS,...JSON.parse(fs.readFileSync(configPath(userData),"utf8"))});}
  catch{return {...DEFAULTS};}
}
function saveConfig(userData,value){
  const config=validate(value);fs.mkdirSync(userData,{recursive:true});
  const file=configPath(userData),tmp=file+".tmp";
  fs.writeFileSync(tmp,JSON.stringify(config,null,2)+"\n");fs.renameSync(tmp,file);return config;
}
function engineEnvironment(config){
  return {CSP_CACHE_MAX_GB:String(config.tileCacheGiB),CSP_DNR_CACHE_GB:String(config.dnrCacheGiB),
    CSP_DNR_ARCHIVE_GB:String(config.dnrArchiveGiB),CSP_MEMORY_CACHE_MB:String(config.memoryCacheMiB),
    CSP_CACHE_MIN_FREE_GB:String(config.minFreeGiB),CSP_TERRAIN_WORKERS:config.workers?String(config.workers):""};
}
const customEngine=config=>Object.keys(ranges).some(key=>config[key]!==DEFAULTS[key]);
module.exports={DEFAULTS,validate,readConfig,saveConfig,engineEnvironment,customEngine};
