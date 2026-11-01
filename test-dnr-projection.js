"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const proj4=require("proj4");
const runtime=require("./vendor/dnr-runtime.cjs");
const reference=require("./test-fixtures/dnr-projections.json");
function near(actual,expected,tolerance){
  actual.forEach((v,i)=>assert(Math.abs(v-expected[i])<tolerance,`${actual} differs from ${expected}`));
}
test("EPSG projections match independent PROJ coordinates, including modern WA State Plane and UTM",()=>{
  for(const [code,xy] of Object.entries(reference.projected)){
    const p=runtime.projection({ProjectedCSTypeGeoKey:+code,GeographicTypeGeoKey:4269,VerticalUnitsGeoKey:9003});
    const transform=proj4(p.definition,"EPSG:4326");
    near(transform.forward(xy),reference.point,1e-8);
    near(transform.inverse(reference.point),xy,.002);
    const feet=[6597,6599,2285].includes(+code);
    assert(Math.abs(p.unitMeters-(feet?1200/3937:1))<1e-10);
  }
});
test("WKT1 and WKT2 preserve State Plane feet and placement",()=>{
  for(const wkt of [reference.wkt1,reference.wkt2]){
    const p=runtime.projection({ProjectedCSTypeGeoKey:32767,PCSCitationGeoKey:wkt});
    near(proj4(p.definition,"EPSG:4326").forward(reference.projected[6597]),reference.point,1e-8);
    assert(Math.abs(p.unitMeters-1200/3937)<1e-10);
  }
});
test("user-defined GeoKeys decode projection parameters and convert feet exactly once",()=>{
  const p=runtime.projection({GTModelTypeGeoKey:1,ProjectedCSTypeGeoKey:32767,GeographicTypeGeoKey:4269,
    ProjCoordTransGeoKey:8,ProjLinearUnitsGeoKey:9003,ProjStdParallel1GeoKey:48.73333333333333,
    ProjStdParallel2GeoKey:47.5,ProjFalseOriginLatGeoKey:47,ProjFalseOriginLongGeoKey:-120.83333333333333,
    ProjFalseOriginEastingGeoKey:500000/(1200/3937),ProjFalseOriginNorthingGeoKey:0});
  near(proj4(p.definition,"EPSG:4326").forward(reference.projected[6597]),reference.point,1e-8);
  assert(Math.abs(p.unitMeters-1200/3937)<1e-10);
});
test("incomplete and unknown CRS remain explicit errors, never guessed lat/lon",()=>{
  for(const keys of [{},{ProjectedCSTypeGeoKey:9999,GeographicTypeGeoKey:4326},
    {GTModelTypeGeoKey:1,ProjectedCSTypeGeoKey:32767,GeographicTypeGeoKey:4269},
    {GTModelTypeGeoKey:1,ProjectedCSTypeGeoKey:32767,ProjCoordTransGeoKey:999}])
    assert.throws(()=>runtime.projection(keys),/coordinate system.*no elevation was substituted/);
  assert.equal(runtime.projection({GeographicTypeGeoKey:4326}).unitMeters,null);
});
test("modern State Plane GeoTIFF ingests and samples numeric elevation without changing vertical units",async()=>{
  const {writeArrayBuffer}=await import("geotiff");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dnr-crs-"));
  try{
    const dnr=path.join(dir,"wadnr");fs.mkdirSync(dnr);
    const file=path.join(dnr,"modern.tif"),[cx,cy]=reference.projected[6597];
    const w=256,step=10;
    fs.writeFileSync(file,Buffer.from(writeArrayBuffer(new Float32Array(w*w).fill(1000),{
      width:w,height:w,BitsPerSample:[32],SampleFormat:[3],ModelPixelScale:[step,step,0],
      ModelTiepoint:[0,0,0,cx-w*step/2,cy+w*step/2,0],GTModelTypeGeoKey:1,GTRasterTypeGeoKey:1,
      ProjectedCSTypeGeoKey:6597,GeographicTypeGeoKey:6318,ProjLinearUnitsGeoKey:9003,VerticalUnitsGeoKey:9001})));
    const info=await runtime.inspect(file);
    assert.equal(info.verticalMeters,1,"horizontal feet cannot scale metre elevations");
    assert(Math.abs(info.nativeMeters-step*1200/3937)<1e-8);
    const levels=await runtime.buildOverviews(file,info,path.join(dnr,"modern"));
    const z=16,n=2**z,x=Math.floor((reference.point[0]+180)/360*n),
      y=Math.floor((1-Math.asinh(Math.tan(reference.point[1]*Math.PI/180))/Math.PI)/2*n);
    const result=await runtime.sample({cacheDir:dir,files:[{...info,file:"modern.tif",overviewDir:"modern",levels}],z,x,y});
    assert(result&&result.coverage>.9);
    for(const height of result.grid)if(Number.isFinite(height))assert.equal(height,1000);
  }finally{await runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});
