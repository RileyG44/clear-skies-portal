# CR-014 — recover the verified Elwha original-resolution elevation gap

Status: ACCEPTED
Request content revision: r1
Author / task: coordinating Codex; Riley's missed-USGS-data instruction.
Baseline: SPEC.md 0.1.0-draft remains unapproved; accepted CR-001–013 apply.
Affected IDs: U-03, CAP-04, DATA-01/03/04/05/06, RENDER-01/03, D-06
(this source only), CR-013 condition 6.

## Existing requirement and evidence

Riley instructed adding missed USGS data in actual user_message position 1923,
message ID 74c815a2-802f-4de9-95ea-9f5b9fe59b7f. The preceding offer included
original-resolution DEMs, not only OR/ID/Elwha standard 1 m projects. CR-013
condition 6 requires a separate bounded owner record if the OPR evidence holds.

The ten-point recheck invalidates the earlier statewide OPR-benefit estimate;
it does not invalidate every OPR gap. At 47.99898,-123.58437 the standard Elwha
1 m file contains only nodata in a 33x33 sample, while USGS's original-resolution
file USGS_OPR_Elwha_River_WA_LiDAR_10TDU560160.tif returns 692.770 m and valid
neighbors. Another audit sample at 48.02151,-123.61508 remains a gap with valid
OPR elevation. The source is publicly accessible by byte range on USGS S3.

WESM workunit WA_ElwhaRiver_2014 (67261) states 1 m, horizontal NAD83(2011),
vertical NAVD88 / GEOID12A. Official source metadata confirms both coordinate
and elevation units are meters. File headers label EPSG:26910, 1 m area pixels.
WESM says this survey does not meet the standard-product specification because
breaklines were not delivered. It must be identified as OPR, not certified
standard 3DEP 1 m. No claim of survey accuracy or all-WA OPR completeness.

## Exact requested change

1. Add only this verified Elwha OPR survey as numeric federal fallback after
   standard 1 m candidates, retaining cached DNR priority. Keep explicit National
   source exclusion. Standard USGS and Auto may use this federal source.
2. Ship a reproducible manifest of all 392 TIFFs from its exact S3 prefix:
   StagedProducts/Elevation/OPR/Projects/Elwha_River_WA_LiDAR/WA_ElwhaRiver_2014/TIFF/.
   Record exact filenames, sizes, projected bounds, native spacing, provenance,
   metadata link and build date. Derive bounds from actual headers; no filename
   coordinate guesses. No source archives are acquired.
3. Reuse the existing bounded byte-range COG cache, UTM sampler, nodata handling,
   engine tile routes and per-pixel progressive numeric pipeline. Validate file
   projection and 1 m spacing before use. No vertical scaling: documented meters.
   Preserve the existing NAD83 UTM approximation; disclose realization limits,
   do not invent a datum transformation or survey accuracy claim.
4. Identify contributing source as Elwha_River_WA_LiDAR OPR 2014, with 1 m native
   spacing and original key in provenance. Only contributing numeric pixels may
   be called this source. Explain the OPR specification limitation in source help.
5. Re-evaluate old federal negatives and changed browser URLs using the same
   coverage-version mechanism as CR-013. Missing/failed reads remain retryable;
   true nodata stays final. Existing pixels remain visible while refining.

## Impact, alternatives and rollback

This closes a demonstrated missed source within Riley's direct instruction.
No universal OPR adapter, point-cloud processing, bulk download, new provider,
pricing, phone offline package or acquisition-budget change is included.
Other investigated OPR sources overlapped standard 1 m at the ten rechecked
points; that is a sample result, not proof of every statewide pixel. New sources
need their own bounded scientific validation. DNR remains the gap-fill path.
Rollback removes the Elwha manifest adapter and bumps coverage URLs again.

## Acceptance checks

- Compare both verified Elwha points and a nodata/outside control with independent
  rasterio samples, source metadata, native spacing and engine results.
- Unit tests for manifest bounds, projection/spacing rejection, standard-before-
  OPR priority, nodata fallback, transient read failure and source provenance.
- Run Node, static and iOS checks, matching assets and simulator refinement.
- Report corrected ~31,161 km² standard-product gap estimate as approximate;
  neither the overview grid nor these samples prove universal data absence.

## Riley approval — direct build instruction

Authority: actual completed user_message 1923 in the parent thread, read by the
coordinator with t3_thread_read on 2026-10-29. Exact instruction:
> Yes. Add the missed USGS data. And do this for the DNR elevation data: “Lighter alternative: download DNR automatically when you view a gap area, instead of in bulk. That reverses the current rule that panning never starts a download.”
>
> Also, you are absolutely 100% certain you aren’t just looking in the wrong place for the missing 32,138 sq. Km?

Source: <t3-thread://v2/25ec7f29-6fda-4160-a0ec-8450030a6239/thread:project:95d7b465-9ac4-4d9b-ad2b-94155aa5a211:23c965b7-44ea-424d-bfea-4b195e8b5ef6>.
GOV-002 authorizes necessary owner review without another confirmation. Shipping
remains separate. Binding digest is recorded below before owner submission.

## Spec Owner disposition

Proposal binding: 4322 UTF-8/LF bytes before the Riley approval heading;
SHA-256 `e439f179c8698844b7e3bfcf1c3576c8aaa663ba1e37bee7258150ae6d885e35` (Status DRAFT), recorded for traceability.

Owner: dedicated Spec Owner `/root/spec_owner_cr014` (Codex), fresh session
for exact CR-014 r1 only after the CR-013 handoff. Reviewed 2026-10-29
(America/Los_Angeles). Decision: ACCEPTED, with the conditions below and no
substantive proposal edit. This one-request session ends at handoff; the
implementer receives no owner custody.

Authority independently verified through `t3_thread_read`, activity view,
afterPosition 1921, limit 4, in the source thread above. Position 1923 is the
actual completed, untruncated user_message, createdBy user, creationSource
mobile, messageId 74c815a2-802f-4de9-95ea-9f5b9fe59b7f, updatedAt
2026-10-30T00:51:18.793Z. Its text matches the quoted instruction exactly.
An additional messages-view read of positions 1921/1923 confirms the preceding
offer included original-resolution DEMs. Adding the independently demonstrated
Elwha gap is within that direct build instruction and CR-013 condition 6;
GOV-002 covers this necessary bounded review without another Riley question.
The 4,322-byte proposal binding was independently reproduced before edits.
It includes the blank separator before the approval heading. Normalize only
workflow Status back to DRAFT to reproduce it. This is a later traceability
digest, not a digest represented as presented to Riley.

Consistency and scientific evidence:
- Read the governing documents, accepted-request scopes, CR-013 conditions and
  affected SPEC IDs. Inspected the existing `usgs.js` range/header/block cache,
  candidate ranking, UTM sampling, nodata, sampleBest and provenance paths;
  `cog.js` projection/parser; federal engine routes and the browser coverage
  version/source pipeline. This is a proposal review, not completion review
  of the parent's concurrent code changes.
- The supplied complete S3 listing has 392 `.tif` files under the exact prefix,
  totaling 487,350,073 bytes; its other 392 entries are not numeric TIFFs.
  Listing SHA-256: 3f26b29301f5e3342fc97f4cf21613190916289dbbce876c81dd01980a976ff7.
  This count is not independent validation of every file header; the manifest
  build and header acceptance checks remain implementation work.
- Independently fetched the official best_use_xml DEM metadata and its reports
  counterpart; both have SHA-256
  fa55045ecd798b33d5148eb5b1c0d81d280e6ba4e9a3d3dab3b23570895fab7c.
  The supplied `elwha-fgdc.xml` differs only by an omitted UTF-8 BOM. Both
  coordinate and altitude units are explicitly meters, with NAD83(2011), UTM
  10N, NAVD88/GEOID12A. Metadata says no access restrictions and no use
  restrictions, while warning about temporal change and critical applications;
  retain USGS attribution. Public access alone was not used to infer rights.
- Independently range-read and sampled the two live OPR files with rasterio.
  Both return HTTP 206, Float32 elevations, EPSG:26910, 1 x 1 m area pixels and
  nodata -999999. At 47.99898,-123.58437, `10TDU560160.tif` gives
  692.77001953125 m; at 48.02151,-123.61508, `10UDU537182.tif` gives
  594.8099975585938 m. Both 33 x 33 neighborhoods have 1,089 valid samples.
  Independent reads of the cited standard `USGS_one_meter_x45y532` Elwha_MOD2
  file have zero valid samples in the 33 x 33 neighborhood at both points.
  The second OPR file is 605 x 750 pixels with west bound 453895 m; its actual
  header demonstrates why filename-derived bounds are not acceptable.
- WESM workunit 67261 identifies horizontal EPSG:6339 and vertical EPSG:5703,
  with 1 m spacing and GEOID12A. Its standard-product exclusion is explicit:
  breaklines were not delivered. WESM collection dates end 2015-02-01; FGDC
  lineage includes a 2015-02-23 modification flight as well as November 2014.
  These are documented source discrepancies, not proof of a transformation or
  an exact per-pixel acquisition date. The stable survey identifier's `2014`
  must not be turned into a universal 2014 capture claim.

Owner spot-check output: `/tmp/csp-cr014-owner/source-check.json`, SHA-256
0abfe3ecdf7d1fc5d025c69a793da085133c8d03a88e47a34f7d114fee36c494.
These source reads establish two real gaps and metadata compatibility for this
bounded adapter. They do not validate all 392 rasters, engine interpolation,
derivatives, statewide absence, physical-phone performance or release readiness.

Conditions preserving and interpreting exact r1:
1. Scope is only the exact 392-file Elwha OPR prefix in item 2. Ship the
   reproducible, versioned manifest, actual header-derived bounds and native
   spacing, sizes, original keys, provider/survey identity, metadata link and
   build date. Reject absent/incompatible CRS, nonnumeric bands, non-1 m or
   unsupported grid geometry before sampling. A failed header/read is unknown,
   not confirmed nodata. Do not add other OPR surveys, topobathy, intensity,
   point clouds or a universal discovery adapter through this acceptance.
2. Keep numeric selection deterministic: valid cached DNR first in Best
   available, the existing standard federal 1 m candidate policy before Elwha
   OPR, then existing coarser fallbacks. OPR fills only remaining numeric holes;
   it cannot displace valid standard pixels. Explicit USGS may include OPR;
   explicit National continues to exclude it. Actual valid 1 m OPR pixels can
   satisfy the federal numeric-detail check for CR-013, without describing OPR
   as a certified standard product. Published DNR image priority and numeric/
   image separation under CR-012 are unchanged.
3. Apply no elevation scaling or invented datum transform. Preserve and disclose
   both the TIFF EPSG:26910 label and metadata/WESM NAD83(2011) reference, plus
   NAVD88/GEOID12A and meter units. The existing longitude/latitude-to-UTM
   approximation is not a realization-aware transformation or an accuracy
   guarantee. Keep that limitation with quantitative provenance; unknown or
   incompatible references still follow DATA-04. This resolves no broader
   datum policy, numerical tolerance or scientific accuracy claim.
4. Report only actual contributors as Elwha_River_WA_LiDAR OPR 2014, with
   original key, 1 m native spacing and separately identified display sampling.
   An opened/read file with zero contributing pixels is not a contributing
   source. Preserve this identity through engine responses, shared/native
   source information and analysis/export provenance. Source help explains
   OPR status and missing breaklines. Preserve the documented acquisition-date
   uncertainty/modification rather than asserting all pixels date to 2014;
   metadata accuracy figures are provider statements, not app validation.
5. Version changed coverage through engine and browser caches, including old
   final negatives and cached partial/coarser bodies whose holes can now fill.
   Missing/failed reads remain retryable. In particular, a failed standard
   candidate cannot become a permanently cached OPR preference just because
   OPR filled every output pixel. Useful fallback may be provisional with
   bounded retry, or the request may fail retryably while prior useful pixels
   remain. Confirmed nodata stays final. Preserve shared-consumer cancellation,
   stale-result rejection, bounded resources and stationary refinement.
6. Complete the proposal's full acceptance checks before marking VERIFIED.
   Independently validate all manifest headers/bounds and compare engine
   results at both gap points plus nodata/outside controls. Match pixel-center
   and interpolation conventions when comparing the nearest source samples
   above with bilinear engine output; explain projection and encoding error
   separately from survey accuracy. Exercise adjacent/clipped raster edges,
   standard-before-OPR, cached DNR precedence, explicit National exclusion,
   nodata, failed standard/OPR reads, stationary recovery and contributing-only
   provenance. Run Node/static/iOS checks, matching bundled assets and actual
   simulator refinement. The owner has not run those completion checks.
7. Amend CR-013 condition 6's task-report disclosure only to reflect this actual
   Elwha addition. Say that one verified OPR survey is added, explain why the
   earlier broad OPR benefit estimate was corrected, and disclose the limited
   ten-point recheck. Do not claim all OPR or all missed USGS data is covered.
   Report ~31,161 km² as an approximate standard-product gap estimate; the
   overview grid and point samples do not prove universal data absence. Other
   source additions need bounded validation and owner records under the same
   task authority. DNR remains the approved gap-fill path.

Spec treatment: exact r1 is a permanent bounded supplement to SPEC.md
0.1.0-draft and CR-001's source-selection constraint, adding only this source
and updating CR-013 condition 6 as above. SPEC.md and BASE-001 remain unchanged
and unapproved. Other CR-013 acquisition/operational conditions, CR-011/012,
broader D-06, D-05, open decisions, PERF/release gates and CR-001's internal
distribution scope/expiry remain unchanged. CR-001's before-baseline exception
expires on BASE-001 approval/rejection or 2027-01-31, whichever first. This
source supplement has no other expiry; a later accepted change may supersede it.

Next action: parent may implement and verify exact r1 with these conditions.
No further Riley confirmation is required within this instructed scope.
Material revisions require a traceable owner record under GOV-002. Owner
acceptance supplies no push, merge, Dell deployment or TestFlight authority;
the parent must identify the applicable shipping instruction separately.

## Implementation and verification

Status: acceptance recorded; implementation and completion verification remain
with the parent. The owner changed only CR-014, DECISIONS.md and SPEC_OWNER.md;
no app edits, app tests, deployment or delegation. Independent provider metadata
and source raster reads above are the extent of this owner's live validation.
Governance enforcement through GitHub remains unverified.
