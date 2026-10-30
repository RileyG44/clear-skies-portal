# DNR rectangular terrain artifacts — 2026-10-29

Scope: repair the rectangular shelves and nested edges reported in Riley's
IMG_2963/2964/2965 around Soap Lake and Moses Lake. Branch
`fix/dnr-render-artifacts`, based on main `dbb09f2` (PR #48). No service,
acquisition policy, units, height calculations, or normative specification edits.

Authority/constraints: SPEC revision `0.1.0-draft` remains unapproved. This is
existing-client maintenance under U-03 and the accepted CR-011 r1 numeric DNR
preference/validity contract; CR-012 image/numeric separation and CR-013/014
acquisition/source behavior are preserved. It also preserves
ENGINEERING_REVIEW contracts 2, 4, 6, 7, 8, 9 and 10. No new exception is claimed.

## Reproduction and cause

An iPhone 17 Pro iOS 26 simulator using the bundled main client and existing Dell
numeric DNR cache reproduces the shelves at latitude 47.265, longitude -119.43,
zoom 12, Best available source, ordinary Hillshade. This is a reproduction near
the supplied screenshots, not an assertion of their exact camera coordinates.

The GPU draw plan includes `dnr/3/1/2` from the startup view. Its 256×256 grid has
only one valid height sample. At the closer view, interpolation spreads that
sample into a large constant-height rectangle. Successively finer partial DNR
tiles discard their nodata fragments, revealing the coarse same-source sample
underneath. Rank 5 causes this false plateau to win over real lower-ranked USGS
terrain. Multiple retained levels produce the nested rectangular shelves.

This is persistent native numeric terrain composition, not published DNR
hillshade imagery. No cache flush, service restart or source download is needed.

## Repair

Mark numeric DNR responses as authoritative coverage at their answered level.
For a display tile with a finer successful DNR response, omit older DNR ancestors
from the GPU plan, including when the finer response is entirely nodata. Those
holes reveal the available lower-ranked terrain; valid finer DNR still wins.
Failed or unanswered requests do not retire a useful ancestor. Other sources
retain their existing same-source fallback behavior.

CPU readout and provenance apply the corresponding rule. GPU coverage decisions
use current resident textures, independently of CPU cache eviction. Export-only
responses carry confirmed empty DNR coverage through the export plan as well.
The fallback source builder sets the same policy as the shared source builder.

## Acceptance evidence

- Node store regression covers failed finer reads, partial/empty answers, valid
  DNR preference, per-pixel provenance, and retaining empty export coverage.
- Four real-GPU regressions fail against the unmodified main engine and pass
  with this repair: magnified startup sample; empty versus unanswered coverage;
  independent CPU eviction; export-only empty coverage. The full Chrome/Metal
  engine review suite passes all 33 checks, including existing non-DNR ancestor,
  source removal, export, wrapping and provenance cases.
- All 72 Node test files pass: 70 in the first run; the two missing-dependency
  failures pass when using the main checkout's existing dependencies. Static
  checks and `git diff --check` pass.
- Debug simulator build succeeds. Its bundled engine/store SHA-256 hashes match
  the changed source. Installed and relaunched this bundle without replacing
  runtime engine/store methods: the rectangles disappear in the same view and
  valid DNR detail remains.
- The rebuilt app also completes a programmatic pan/zoom sequence from the
  reproduction to cached DNR at 47.34, -119.47, zoom 15, then zooms out to 11
  and returns to the original view at 12. The final view stays clean. All three
  snapshots have no engine errors; zooms 11 and 12 have no queued uploads. The
  zoom-15 stop still has 28 queued uploads after 12 seconds, so full detail
  completion there is not established by this sequence. This exercises map
  lifecycle events rather than a physical pinch gesture.
- In the same sparse height diagnostic, maximum GPU/CPU disagreement falls from
  30.67 m to 2.82 m, and the largest sampled adjacent jump from 31.75 m to 7.05 m.
  These are debugging measurements, not claims of elevation accuracy or zero
  source-boundary discontinuity. CPU bilinear and GPU cubic sampling differ.

Evidence directory: `/Users/riley/t3-tots/out/dnr-render-artifacts-2026-10-29/`.
It contains original reproduction and rebuilt-app screenshots, GPU plan/native
record diagnostics, baseline-failing/patched-passing regression reports, and
the bundled-app diagnostic. Simulator probes used a read-only local proxy that
rejected POST and hid automatic-acquisition capability. No live Dell deployment,
restart, cache deletion, or automatic DNR acquisition was performed.

Limits: this verifies the reported numeric-DNR compositing defect in a simulator
and Chrome/Metal, not a physical-phone TestFlight release or statewide source
coverage. Playwright WebKit is unavailable locally; actual simulator WKWebView
provides the iOS runtime evidence. No push, merge, Pages deploy or TestFlight
upload is part of this repair.
