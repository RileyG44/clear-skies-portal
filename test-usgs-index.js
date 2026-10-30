"use strict";
/* A 1 m index whose S3 listings partly failed must not be trusted as "no
   coverage": it repairs itself, and meanwhile its "none" is provisional.
   On 2026-10-21 the live engine kept 7 of 25 Washington projects for 30 days. */
const assert=require("assert/strict"),fs=require("fs"),os=require("os"),path=require("path");
const https=require("https"),{EventEmitter}=require("events");

const BASE="StagedProducts/Elevation/1m/Projects/";
const PROJECTS={WA_A_2020:["USGS_1M_10_x55y525_WA_A_2020.tif"],WA_B_2021:["USGS_1M_10_x56y525_WA_B_2021.tif"],
  WA_C_2019:["USGS_1m_x57y525_WA_C_2019.tif"]};
let failing=new Set(),listings=[],failingPrefixes=new Set();
https.request=(options,callback)=>{
  const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=()=>{};
  req.end=()=>setImmediate(()=>{
    const u=new URL("https://s3"+options.path),prefix=u.searchParams.get("prefix")||"";
    listings.push(prefix);
    const project=prefix.slice(BASE.length).split("/")[0];
    const res=new EventEmitter();res.headers={};res.resume=()=>{};
    let body="";
    if(prefix.endsWith("/TIFF/")){
      res.statusCode=failing.has(project)?503:200;
      if(res.statusCode===200)body=PROJECTS[project].map(f=>`<Key>${BASE}${project}/TIFF/${f}</Key><Size>100</Size>`).join("");
    }else{
      res.statusCode=failingPrefixes.has(prefix)?503:200;
      body=`<Prefix>${prefix}</Prefix>`+Object.keys(PROJECTS).filter(p=>p.startsWith(prefix.slice(BASE.length))).map(p=>`<Prefix>${BASE}${p}/</Prefix>`).join("");
    }
    callback(res);res.emit("data",Buffer.from(body));res.emit("end");
  });
  return req;
};

const fresh=dir=>{delete require.cache[require.resolve("./usgs.js")];const usgs=require("./usgs.js");usgs.init(dir);return usgs};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"csp-usgs-index-")),file=path.join(dir,"usgs","index.json");

(async()=>{
  try{
    // 1. A partial build records exactly which listings failed.
    failing=new Set(["WA_B_2021","WA_C_2019"]);
    let usgs=fresh(dir);
    let idx=await usgs.buildIndex(null,true);
    assert.deepEqual(Object.keys(idx.projects),["WA_A_2020"]);
    assert.equal(idx.failed,2);assert.deepEqual([...idx.failedProjects].sort(),["WA_B_2021","WA_C_2019"]);
    assert.equal(usgs.coverageFinal(),false,"an index with failed listings cannot call a tile empty");

    // 2. Its "no coverage" is provisional, so routes neither cache nor mark it immutable.
    const nowhere=await usgs.elevTile(15,0,0,8);       // far from every indexed cell
    assert.equal(nowhere&&nowhere.provisional,true);
    assert.equal((await usgs.renderTile("hs",15,0,0,8)).provisional,true);

    // A repair while S3 still fails leaves it provisional (and joins one already running).
    await usgs.repairIndex();assert.equal(usgs.coverageFinal(),false);

    // 3. A repair lists only the failed projects and persists the complete index.
    failing=new Set();listings=[];
    await usgs.repairIndex();
    assert.deepEqual(listings.sort(),[`${BASE}WA_B_2021/TIFF/`,`${BASE}WA_C_2019/TIFF/`]);
    idx=await usgs.getIndex();
    assert.deepEqual(Object.keys(idx.projects).sort(),Object.keys(PROJECTS).sort());
    assert.equal(idx.failed,0);assert.equal(usgs.coverageFinal(),true);
    assert.equal(JSON.parse(fs.readFileSync(file,"utf8")).failed,0,"the repaired index is what the next start loads");
    assert.equal(await usgs.elevTile(15,0,0,8),null,"a complete index answers a genuine gap with a final null");

    // 4. An index saved before failedProjects existed (the live engine's) re-lists its scope.
    const legacy=JSON.parse(fs.readFileSync(file,"utf8"));
    delete legacy.failedProjects;legacy.failed=18;delete legacy.projects.WA_B_2021;delete legacy.projects.WA_C_2019;
    fs.writeFileSync(file,JSON.stringify(legacy));
    usgs=fresh(dir);listings=[];
    idx=await usgs.getIndex();
    assert.equal(usgs.coverageFinal(),false,"the loaded legacy index is used at once, but only provisionally");
    await usgs.repairIndex();                         // the repair loading started
    assert(!listings.includes(`${BASE}WA_A_2020/TIFF/`),"projects already indexed are not listed again");
    assert.deepEqual(Object.keys((await usgs.getIndex()).projects).sort(),Object.keys(PROJECTS).sort());
    assert.equal(usgs.coverageFinal(),true);

    // A cached WA-only index serves immediately while newly included prefixes
    // are listed. A failed prefix must not finalize absence or replace it.
    const narrow={...JSON.parse(fs.readFileSync(file,'utf8')),scope:'WA_'};
    fs.writeFileSync(file,JSON.stringify(narrow));
    PROJECTS.OR_Border_2024=['USGS_1M_10_x54y525_OR_Border_2024.tif'];
    PROJECTS.Elwha_River_2014=['USGS_1M_10_x44y525_Elwha_River_2014.tif'];
    failingPrefixes=new Set([BASE+'OR_']);usgs=fresh(dir);
    assert.equal(Object.keys((await usgs.getIndex()).projects).length,3,'cached projects keep serving while the scope widens');
    await usgs.repairIndex();assert.equal(usgs.coverageFinal(),false);
    assert.equal(Object.keys((await usgs.getIndex()).projects).length,3,'failed added discovery preserves every old project');
    failingPrefixes.clear();await usgs.repairIndex();
    const widened=await usgs.getIndex();assert.equal(Object.keys(widened.projects).length,5);
    assert.equal(widened.scope,'WA_,OR_,ID_,Elwha_');assert.equal(usgs.coverageFinal(),true);
    // A failed forced refresh also preserves a serving project's data.
    failing.add('OR_Border_2024');await usgs.buildIndex(null,true);
    assert((await usgs.getIndex()).projects.OR_Border_2024);assert.equal(usgs.coverageFinal(),false);

    console.log("Incomplete 1 m index: provisional gaps, failed-only repair, and legacy re-list passed");
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exit(1)});
