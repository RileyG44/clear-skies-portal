"""Fill labels-cache for file-geodatabase label sites (OR OGDC8, NY GeMS) that
fetch.js (Node) cannot read. Uses the curator's verified site table + vec.read,
and writes the same cache JSON format fetch.js produces:
{site, uncertaintyMetres, positive:[polys], ignore:[], coverage:null}
Feature = array of polygons; polygon = array of rings [[lon,lat],...].
Run: output/glacial-calibration/.venv/bin/python scripts/glacial-calibration/extract_file_labels.py
"""
import json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
CUR = os.path.join(ROOT, "output", "glacial-calibration", "curator-cache", "scripts")
sys.path.insert(0, CUR)
os.chdir(ROOT)

from sites import POS, NEG  # noqa: E402
from evalsite import file_fetch  # noqa: E402
import shapely  # noqa: E402

OUT = os.path.join(ROOT, "output", "glacial-calibration")
LAB = os.path.join(OUT, "labels-cache")
MAN = json.load(open(os.path.join(OUT, "manifest.json")))
UNC = {s["id"]: s["label"].get("uncertaintyMetres") or 0 for s in MAN["sites"]}


def polys_of(feats):
    out = []
    for _, g in feats:
        if g is None or g.is_empty:
            continue
        geoms = list(g.geoms) if hasattr(g, "geoms") else [g]
        for p in geoms:
            if p.geom_type == "Polygon":
                rings = [ [ [float(x), float(y)] for x, y in p.exterior.coords] ]
                rings += [ [ [float(x), float(y)] for x, y in r.coords] for r in p.interiors ]
                out.append(rings)
            elif p.geom_type == "MultiPolygon":
                for q in p.geoms:
                    rings = [ [ [float(x), float(y)] for x, y in q.exterior.coords] ]
                    rings += [ [ [float(x), float(y)] for x, y in r.coords] for r in q.interiors ]
                    out.append(rings)
    return out


def main():
    only = sys.argv[1:] or None
    by_id = {s["id"]: s for s in POS + NEG}
    res = json.load(open(os.path.join(CUR, "site_results.json")))
    done = []
    for site in MAN["sites"]:
        sid = site["id"]
        if only and sid not in only:
            continue
        dest = os.path.join(LAB, f"{sid}.json")
        if os.path.exists(dest):
            continue
        spec_site = by_id.get(sid)
        if spec_site is None or sid not in res:
            continue
        # Positive sites: label spec. Confuser/control: feature spec, but confuser
        # polygons are negative ground truth, so they are never put in `positive`.
        is_positive = site["class"] == "positive"
        bbox = res[sid]["bbox"]
        cache = {"site": sid, "uncertaintyMetres": UNC.get(sid, 0),
                 "positive": [], "ignore": [], "coverage": None,
                 "fileFeaturesNotPositive": not is_positive}
        src_spec = spec_site.get("label") if is_positive else spec_site.get("feature")
        if src_spec and src_spec.get("kind") == "file":
            feats = file_fetch(src_spec["path"], src_spec["layer"], src_spec["where"], bbox)
            if is_positive:
                cache["positive"] = polys_of(feats)
                for ig in spec_site.get("ignore") or []:
                    if ig.get("kind") == "file":
                        cache["ignore"] += polys_of(
                            file_fetch(ig["path"], ig["layer"], ig["where"], bbox))
            else:
                # confuser feature polygons are recorded for provenance only;
                # every pixel stays negative, so positive/ignore remain empty.
                cache["confuserFeatureCount"] = len(feats)
        elif is_positive:
            continue  # esri site; fetch.js handles it
        else:
            continue
        os.makedirs(LAB, exist_ok=True)
        json.dump(cache, open(dest, "w"))
        done.append(sid)
        print("wrote", sid, "positivePolys", len(cache["positive"]))
    print("done:", done)


if __name__ == "__main__":
    main()
