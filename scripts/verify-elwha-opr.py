#!/usr/bin/env python3
"""Verify or rebuild the bounded Elwha manifest from S3 + numeric TIFF headers.
Requires rasterio. Reads headers/ranges, never downloads full source archives.
Usage: python scripts/verify-elwha-opr.py [--write]
"""
import concurrent.futures
import datetime
import json
import os
from pathlib import Path
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
os.environ.update(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',
                  GDAL_HTTP_TIMEOUT='25', GDAL_HTTP_MAX_RETRY='1')
import rasterio
ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / 'usgs-elwha-opr.json'
PREFIX = 'StagedProducts/Elevation/OPR/Projects/Elwha_River_WA_LiDAR/WA_ElwhaRiver_2014/TIFF/'
HOST = 'https://prd-tnm.s3.amazonaws.com/'
NS = {'s': 'http://s3.amazonaws.com/doc/2006-03-01/'}
rows, token = [], None
while True:
    params = {'list-type': '2', 'prefix': PREFIX}
    if token:
        params['continuation-token'] = token
    with urllib.request.urlopen(HOST + '?' + urllib.parse.urlencode(params), timeout=30) as r:
        root = ET.fromstring(r.read())
    rows += [(e.find('s:Key', NS).text, int(e.find('s:Size', NS).text))
             for e in root.findall('s:Contents', NS) if e.find('s:Key', NS).text.endswith('.tif')]
    if root.findtext('s:IsTruncated', namespaces=NS) != 'true':
        break
    token = root.findtext('s:NextContinuationToken', namespaces=NS)
    assert token
assert len(rows) == 392, 'Changed survey inventory requires source review'
def inspect(row):
    key, size = row
    with rasterio.open(HOST + key) as src:
        assert src.crs.to_epsg() == 26910 and src.res == (1., 1.)
        assert src.count == 1 and src.dtypes == ('float32',) and src.nodata == -999999
        assert src.transform.b == 0 and src.transform.d == 0 and src.transform.e == -1
        return dict(key=key, size=size, bounds=list(src.bounds), width=src.width,
                    height=src.height, epsg=26910, nativeMeters=1)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    files = list(executor.map(inspect, rows))
manifest = json.loads(FILE.read_text())
if '--write' in sys.argv:
    manifest.update(files=files, generated=datetime.date.today().isoformat())
    FILE.write_text(json.dumps(manifest, indent=2) + '\n')
else:
    assert files == manifest['files'], 'Header/listing differs from committed manifest'
print(json.dumps(dict(validated=len(files), bytes=sum(f['size'] for f in files),
                      projection='EPSG:26910', spacing=1, units='meters')))
