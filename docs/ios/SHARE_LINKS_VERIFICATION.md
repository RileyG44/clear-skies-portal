# Location and display-state sharing — 2026-10-26

## Authority and task contract

Baseline: SPEC.md 0.1.0-draft at
142fdf4748baddf6cb03d6cdde1c9f67fe012d50 remains unapproved. This task uses
accepted CR-001 r1, CR-002 r1 and exact CR-003 r1, whose approval digest is
709c7650e3f6b23ec7025f8d54239f4c216cea63854052af6300ccbdb74c9ecd.
Riley's approval and the completed dedicated owner acceptance are recorded in
change-requests/CR-003-location-state-share-links.md and DECISIONS.md.
No new owner session or specification exception was created for this continuation.

Requirements: U-01, U-04, UX-02, CAP-01 through CAP-12 and CR-001 Stage 2.
Scope: complete the approved selected-location Share action, validated opt-in
full display-state fragment reader, matching iOS bundle and internal distribution.
The earlier header/search/location-action fixes remain included in this build;
their separate verification records still apply.

Acceptance checks: fresh-session state roundtrips, private-field exclusion,
malformed/unsupported links, explicit incomplete restoration, native Apple share
UI, unchanged ordinary startup, shared regressions and identical shipped assets.

## Result

- Web build: `2026-10-26a`.
- Native archive: `1.0 (29883623)`, signed Release for iOS.
- Internal TestFlight upload succeeded on 2026-10-26. Xcode reported
  `Uploaded package is processing`, `Upload succeeded` and `EXPORT SUCCEEDED`.
  Apple processing and installation on Riley's physical device are separate.
- Public deployment has not been performed. The public site's version endpoint
  still returned `2026-10-25a` during this verification. Recipients need the
  matching web update before public links can restore this new payload.

## Implemented behavior

The location-action stack opens UIActivityViewController with the canonical
Clear Skies web URL and a versioned compressed fragment. The shared JavaScript
captures location/camera, layer order/opacity/visibility, scene identities,
Auto-fill and search filters, terrain mix and lighting, elevation controls,
overlays, annotation geometry/styles, completed analysis rasters and point-cloud
controls/camera. Typed arrays preserve their original bytes and nodata values.
Engine addresses, credentials and unrelated preference libraries are excluded.

Validation rejects unsupported controls, terrain/style normalization changes,
unknown or duplicate layer order entries, invalid geometry/raster dimensions,
unsafe imagery URLs and credentials. Invalid link startup reports an error while
preserving the existing map. Unavailable content reports an incomplete view.
Restoration uses the existing renderers, computations and source functions.
The ordinary imagery candidate fallback remains unchanged; replaying a shared
neighbour uses only its explicit scene identity. Previous-view searches and
Auto-fill timers cannot replace the scenes during restoration.

Additional fixes found during verification: retain the original elevation field
instead of deriving it from the rounded slider; validate the native URL with
URLComponents because URL.path removes the canonical trailing slash; surface
native sharing failures instead of returning silently.

## Observed verification

1. The browser fixture and real native WKWebView probe in
   `ios/scripts/verify_share.js` passed with no state differences. The six-layer
   fixture includes a custom magma slope style, terrain appearance/lighting,
   elevation spectrum, place labels, an annotation circle, and a completed
   surface-curvature raster with nodata. The raster is synthetic test data,
   not a scientific reference or accuracy validation.
2. A fresh browser recipient restored the generated fragment exactly. A broader
   fresh-session test preserved the primary scene
   `LC09_L2SP_044027_20261021_02_T1`, surrounding scene
   `LC09_L2SP_043027_20261014_02_T1`, annotation, raster and point-cloud project
   `WA_NorthEast_2_B22`. There were no included-state differences. Point-cloud
   position/yaw/pitch/radius, linked mode, class visibility, classification
   coloring, point size and budget were retained.
3. A terrain 3D replay retained the selected location, zoom 12, bearing 32 and
   pitch 45. Auto-fill on/off and search filters were exercised through sharing.
4. Unsupported fragment version `2.abcd` reported an error and left the existing
   state unchanged. An unavailable provider scene explicitly reported an
   incomplete view. Unit cases cover malformed compressed data, Unicode, float
   and nodata bits, unknown fields/controls, invalid geometry, unsupported mixes,
   duplicate/unknown order entries, private URLs and credential query fields.
5. On iPhone 17 Pro Simulator, iOS 26.0, a real Share tap presented Apple's
   share sheet with the Clear Skies web link. Screenshot:
   `/tmp/clearskies-share/native-share-sheet.png`. No message was sent.
   Simulator clipboard extraction was not usable, so no copied-link delivery
   claim is made. The native-generated link itself was verified via the bridge.
6. `npm run check`, native adapter syntax checking and all 56 files in `npm test`
   passed. Tests ran in a local checkout containing the current changed sources
   to avoid iCloud stalling on an unrelated, untracked experiment corpus. The
   successful full run used `CSP_CACHE_MIN_FREE_GB=0.1` only in the test process;
   product disk-reserve settings and source code were not changed. Earlier runs
   hit the host disk reserve or a fixture startup timeout; the isolated DNR retry
   and the final full suite passed.
7. Debug simulator build and signed Release archive passed. The repository's
   normal static-site assembly/minification workflow produced 140 files exactly
   matching the signed app's bundled `site/` files by SHA-256. Current sources
   and the local build/test checkout were also compared byte for byte.

## Evidence and remaining limits

Local evidence: `/tmp/clearskies-share/native-probe-final.json`,
`source-hashes.json`, `bundle-parity.json`, and `native-share-sheet.png`;
`/tmp/clearskies-share-acceptance-tests.log`,
`/tmp/clearskies-share-final-static.log`,
`/tmp/clearskies-share-archive.log` and `/tmp/clearskies-share-upload.log`.
The signed archive is `/tmp/clearskies-share.xcarchive` and the prepared public
artifact is `/tmp/clearskies-share-public-site`.

No public website/engine deployment, external testing, App Store submission,
physical-device field acceptance, scientific validation or performance-gate
claim is included. CR-001's internal scope and expiry remain unchanged. Large
display states can produce long URLs; no layers or parameters are silently
dropped to shorten them. Public deployment approval is the remaining operational
step for restoring the new links on the public site.

## Publication authorization — 2026-10-26

Riley explicitly instructed in the continuation of the same parent thread:
“Yes, please publish the matching web update and upload all code to GitHub on
the main branch. Also update the Mac app.” This authorizes the operational
publication of the already accepted and verified change, committing all pending
project code and records to main, and updating the existing Mac installation.
It does not amend the native specification or its distribution gates.
The earlier statements above that public deployment was not performed describe
the verification-time state before this authorization.
