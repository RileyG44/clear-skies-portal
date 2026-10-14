"""Focused regression: wide-envelope 500 falls back to quadrant tiling."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..",
                                "output", "glacial-calibration",
                                "curator-cache", "scripts"))
import evalsite

calls = []

def fake_query(url, where, bbox, out_fields, name):
    calls.append(list(bbox))
    return {"features": [{"attributes": {"project": "P"},
                          "geometry": {"rings": [[[bbox[0], bbox[1]], [bbox[2], bbox[1]],
                                                  [bbox[2], bbox[3]], [bbox[0], bbox[3]],
                                                  [bbox[0], bbox[1]]]]}}]}

evalsite._esri_query = fake_query
feats = evalsite.esri_fetch("https://example/MapServer/0", "1=1",
                            [-122.6, 46.7, -122.2, 46.95], "project", "dep1m_wide_test.json")
# 0.4 deg wide tiles until leaves are <=0.06 deg: bounded, narrow leaves.
assert len(calls) <= 64, f"tiling must stay bounded, got {len(calls)} calls"
assert len(feats) == len(calls), "each leaf returns one feature"
assert max(c[2] - c[0] for c in calls) <= 0.06 + 1e-9, "leaf envelopes must stay narrow"
print(f"esri tiling: wide envelope tiled to {len(calls)} bounded leaf queries")
