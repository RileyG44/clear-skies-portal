#!/usr/bin/env python3
"""Regenerate nadi1-cordilleran.json from the NADI-1 shapefiles.

NADI-1: Dalton et al. (2023), Quaternary Science Reviews 321, 108345,
data at https://doi.org/10.5281/zenodo.8161764 (CC BY 4.0).

    curl -L -o nadi.zip "https://zenodo.org/api/records/8161764/files/NADI-1%20shapefiles%20Dalton%20et%20al.%20QSR.zip/content"
    unzip -q nadi.zip -d nadi
    pip install geopandas shapely
    python3 scripts/build-nadi1-cordilleran.py nadi

Clips each 25-10.5 ka slice to the Pacific Northwest, simplifies to ~100 m and
writes, per slice: the best-estimate ice fill, and the OPTIMAL / MIN / MAX
margins as lines with the artificial clip-box edges removed.
"""
import sys
import geopandas as g, glob, re, os, json
from shapely.geometry import box, mapping
from shapely import set_precision
D=os.path.join(sys.argv[1] if len(sys.argv)>1 else 'nadi','NADI-1 shapefiles Dalton et al. QSR','')
BOX=(-128.5,43.5,-109.5,52.5)
clip=box(*BOX); edge=clip.exterior.buffer(0.01)
ages=sorted({float(re.match(r'([\d.]+)ka',os.path.basename(f)).group(1)) for f in glob.glob(D+'*.shp')},reverse=True)
lab=lambda a:(f'{a:.1f}'.rstrip('0').rstrip('.'))
def load(a,v):
    d=g.read_file(f'{D}{lab(a)}ka_cal_{v}_NADI-1_Dalton_etal_QSR.shp').to_crs(4326)
    u=d.geometry.buffer(0).union_all().intersection(clip)
    u=u.simplify(0.005,preserve_topology=True)
    return u
def rnd(geom): return set_precision(geom,0.001)
feats=[];slices=[]
for a in ages:
    if a<10: continue
    o=load(a,'OPTIMAL')
    if o.is_empty or o.area<0.01: continue
    slices.append(a)
    feats.append({"type":"Feature","properties":{"ka":a,"kind":"ice"},"geometry":mapping(rnd(o))})
    for v in ('OPTIMAL','MIN','MAX'):
        gm=o if v=='OPTIMAL' else load(a,v)
        if gm.is_empty: continue
        line=gm.boundary.difference(edge)
        if line.is_empty: continue
        feats.append({"type":"Feature","properties":{"ka":a,"kind":v.lower()},"geometry":mapping(rnd(line))})
fc={"type":"FeatureCollection",
 "name":"NADI-1 Cordilleran Ice Sheet southern margin",
 "source":{"title":"Dalton et al. (2023) Deglaciation of the North American Ice Sheet Complex in calendar years based on a comprehensive database of chronological data: NADI-1. Quaternary Science Reviews 321, 108345",
   "doi":"https://doi.org/10.1016/j.quascirev.2023.108345","data":"https://doi.org/10.5281/zenodo.8161764","licence":"CC BY 4.0"},
 "bbox":list(BOX),"units":"ka (thousand calendar years before present)","slices":slices,"features":feats}
s=json.dumps(fc,separators=(',',':'))
open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','nadi1-cordilleran.json'),'w').write(s)
print(len(slices),slices[0],slices[-1],len(feats),len(s))
