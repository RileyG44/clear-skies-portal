import json, urllib.request, datetime
def search(coll, lat, lng):
    body = json.dumps({"collections":[coll],
        "intersects":{"type":"Point","coordinates":[lng,lat]},
        "limit":3, "sortby":[{"field":"properties.datetime","direction":"desc"}]}).encode()
    r = urllib.request.Request("https://earth-search.aws.element84.com/v1/search", data=body,
        headers={"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(r, timeout=60))
now = datetime.datetime.now(datetime.timezone.utc)
for place,(lat,lng) in {"Krakow PL":(50.16,20.79),"Sahara":(23.4,12.5),"mid-Pacific":(-15.0,-140.0),"Svalbard":(78.2,15.6)}.items():
    for coll in ["sentinel-2-l2a","sentinel-1-grd"]:
        try:
            f = search(coll, lat, lng)["features"]
            if not f: print(f"{place:14} {coll:16} none"); continue
            i = f[0]; dt = datetime.datetime.fromisoformat(i["properties"]["datetime"].replace("Z","+00:00"))
            age = (now-dt).total_seconds()/3600
            cc = i["properties"].get("eo:cloud_cover")
            print(f"{place:14} {coll:16} {dt:%Y-%m-%d %H:%M}Z  age {age:6.1f}h  cloud {cc}")
        except Exception as e:
            print(f"{place:14} {coll:16} ERR {e}")
