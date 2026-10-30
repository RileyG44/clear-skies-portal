# CR-013 — download WA DNR elevation automatically for viewed USGS gaps

Status: ACCEPTED
Request content revision: r1; binding SHA-256 recorded below after proposal text.
Author / task: coordinating Claude (Opus); Riley's USGS-gap follow-up.
Current approved spec revision: SPEC.md 0.1.0-draft remains unapproved;
accepted CR-001–012 supplements apply. This bounded supplement amends CR-011
item 3 only where an engine opts in, and widens USGS 1 m discovery.
Affected requirement IDs: U-03, CAP-04, DATA-03/05/06, RENDER-01/03,
UX-02/03, D-06 (this acquisition policy only), CR-011 item 3, CR-001 parity.
Type: permanent bounded source-acquisition and discovery change.

## Existing requirement and conflict

CR-011 item 3: "Browsing, panning, zooming and source selection keep acquire=0.
They must never download or restore a DNR archive. Explicit download actions
remain required for missing data". CR-011 also records: "Unconditional
acquisition risks large unrequested downloads and is excluded."

Evidence (statewide audit, 2026-10-29): every USGS 1 m file listed in the S3
bucket for WA_, OR_, ID_ and Elwha projects was read at overview resolution.
31,161 km² (17.8%) of Washington land has no valid USGS 1 m. USGS's WESM table
lists 70 Washington work units; every one meeting the 1 m specification is
already indexed. WA DNR DTMs exist at about 75% of 289 random gap points; every
point with neither is on the Colville or Yakama Nation reservation. Washington
1 m tiles published under Oregon, Idaho and Elwha River project names (383 km²)
are outside the engine's default WA_ discovery scope. A statewide DNR download
(about 570–970 GiB) exceeds the Dell's 414 GB free space. Riley chose automatic
download of viewed gap areas instead.

## Exact requested change

1. Engines advertise a health feature `wadnr-auto` only when configured with
   CSP_DNR_AUTO=1. Without it, CR-011 item 3 applies unchanged.
2. With `wadnr-auto`, in Best available 2D terrain or elevation, after the view
   settles at map zoom 15 or closer with none of its own tiles pending or
   retrying, the client finds display tiles whose pixels are not all covered
   by USGS 1 m (rank 3) or cached DNR elevation (rank 5). If any remain, it
   starts one engine DNR view download (the existing /api/wadnr/warm job with
   its existing survey choice, per-job budget and disk reserve) for the
   bounding box of those tiles clipped to the view. One job at a time; a box
   already attempted this session, or inside cached DNR footprints, is not
   started again. Explicit National 3DEP or USGS source choices, 3D, captures
   and exports never start one.
3. Automatic jobs use the existing background progress chip, labelled as
   automatic, with Cancel. They create no explicit download-area records or
   outlines. Explicit download actions are unchanged.
4. USGS 1 m discovery defaults to the existing CSP_USGS_STATES mechanism with
   `WA_,OR_,ID_,Elwha_` instead of `WA_`. An index cached under a narrower
   scope keeps serving and lists the added projects in the background; cached
   "no 1 m" answers made under another scope are checked again once.
5. Operational: the Dell sets CSP_DNR_AUTO=1 and CSP_DNR_CACHE_GB=300. An
   engine without an archive pauses at its cap with the existing visible
   message; nothing is deleted.
6. Update source and help text that says panning never downloads.

## Alternatives and impact

Explicit-only downloads leave gaps until Riley finds and fetches each one; bulk
download does not fit the Dell. Automatic jobs fetch roughly 0.6–3 GB per new
area to the engine, not the phone's data plan, and are visible and cancellable.
Cached-DNR preference, provenance, units and published-hillshade behavior are
unchanged (CR-011, CR-012). No new provider, subscription or device budget.
Engines that do not opt in, including the Mac app's local engine, never
download automatically. Rollback: unset CSP_DNR_AUTO (immediate) or revert the
client; cached data remains. The scope change adds data only; unsetting
CSP_USGS_STATES restores the old default.

## Verification plan

- Unit tests: the store's coarse-tile summary; trigger gating (feature absent,
  zoom below 15, unsettled view, explicit source, covered view, attempted box,
  running job); cached-index scope widening and scope-tagged negatives.
- iOS simulator against an engine with `wadnr-auto`: settle in an uncached DNR
  gap and observe the job, progress chip and DNR provenance afterwards; settle
  over USGS 1 m and on a reservation and observe no download.
- Static checks, all Node tests and iOS checks; internal TestFlight.

## Riley approval — direct build authorization under GOV-002

Exact instruction, actual user_message position 1923 (2026-10-30T00:51:18.793Z,
mobile, message ID 74c815a2-802f-4de9-95ea-9f5b9fe59b7f):
> Yes. Add the missed USGS data. And do this for the DNR elevation data: “Lighter alternative: download DNR automatically when you view a gap area, instead of in bulk. That reverses the current rule that panning never starts a download.”
>
> Also, you are absolutely 100% certain you aren’t just looking in the wrong place for the missing 32,138 sq. Km?

Source: <t3-thread://v2/25ec7f29-6fda-4160-a0ec-8450030a6239/thread:project:95d7b465-9ac4-4d9b-ad2b-94155aa5a211:23c965b7-44ea-424d-bfea-4b195e8b5ef6>
Binding: 4,618 UTF-8/LF proposal bytes before this approval heading, with
workflow Status DRAFT, SHA-256
`2e63f71a1158e77f665a286b79e3310543bf8a297ec30ef7e6469b53ea737c33`.
The coordinator read the actual user message through t3_thread_read. This
direct build instruction authorizes necessary CR submission and dedicated owner
review under GOV-002; no repeated confirmation is required. The digest is later
traceability, not represented as presented to Riley. Shipping authority is
separate: actual user_message position 229 authorizes push, merge, Dell update
and internal TestFlight for this continuing repair task; owner acceptance
itself does not authorize deployment.

## Spec Owner disposition — only after Riley authorization

Owner identity and review date: dedicated Spec Owner (Claude subagent), fresh
CR-013-r1-only session; reviewed 2026-10-29 (America/Los_Angeles). The session
ends at handoff; no approval custody transfers to the implementer.

Decision / rationale: ACCEPTED for exact digest-bound r1, with no proposal edit
and the numbered owner conditions below. The change is bounded: it is opt-in
per engine, applies only at zoom 15 or closer, waits for a settled view,
targets only gap areas, runs one job at a time and reuses existing budgets. It
creates no explicit-area records, excludes explicit source choices, preserves
provenance and coverage, and has an immediate rollback. Riley directly
instructed both parts.

Binding: independently reproduced before editing. The first 4,618 UTF-8/LF
bytes, with Status: DRAFT, hash to SHA-256
`2e63f71a1158e77f665a286b79e3310543bf8a297ec30ef7e6469b53ea737c33`, which
also matches the committed blob at 17d5c0598e53562984b27999a9593cefe0a6ad41.
Those bytes end at the proposal's final newline. Byte 4,619 is the blank
separator line, and the approval heading begins at byte 4,620. CR-011 and
CR-012 counted that separator in their bindings; this request's stated binding
excludes it. Both cover the same proposal text. For traceability only, the
4,619-byte variant hashes to
ba84dadaa3168e234a9bb9ba3449c69ab6ad6873edf7bb6769a7d3a8639a78f3. To
reproduce either, set only workflow Status back to DRAFT. This is a later
traceability binding, not a digest presented to Riley.

Authority was independently verified through t3_thread_read, messages view,
in the source thread linked above:
- Position 1923 is an actual completed, untruncated user_message: createdBy
  user, creationSource mobile, messageId
  74c815a2-802f-4de9-95ea-9f5b9fe59b7f, updatedAt 2026-10-30T00:51:18.793Z
  (2026-10-29 17:51 America/Los_Angeles). Its text matches the quote above
  byte for byte. It answers both decisions posed in assistant message 1921:
  "Add the missed USGS data" (decision 1), and an automatic gap-area DNR
  download that expressly "reverses the current rule that panning never
  starts a download" (decision 2). Under GOV-002 it is a direct build
  instruction for both parts of r1 and for this owner review.
- Position 229 is an actual completed, untruncated user_message: createdBy
  user, creationSource mobile, messageId
  8e0f7630-d76c-40ac-9697-a0279025379d, updatedAt 2026-10-29T18:49:55.488Z.
  Its text: "Push all of the fixes, update the Dell, push the TestFlight
  update, and merge the fix into main on GitHub." It predates 1923 by about
  six hours. This owner does not decide whether it covers shipping CR-013.
  Owner acceptance itself authorizes no push, merge, Dell change or
  TestFlight.

Scope note: message 1921 defined decision 1 as "the original-resolution DEMs
plus the Oregon/Idaho/Elwha 1 m files, about 1,400 km²". R1 implements only
the 1 m discovery widening (383 km²). The coordinator's later recheck, at
thread positions 1976 and 1979, concluded that the original-resolution benefit
was mostly a scan error, and it chose not to build that source. R1 does not
mention that narrowing. This owner neither accepts nor approves it; see
condition 6.

Consistency evidence: read the governing documents, CR-011, CR-012 and the
affected SPEC.md IDs. Statically inspected:
- engine/dnr-routes.js warm, status and stop routes.
- wadnr.js DnrStore:
  - one global warm job and a 4,096 z16-cell limit;
  - two surveys per cell;
  - a per-archive limit of CSP_DNR_ARCHIVE_GB (default 2 GiB) and 32 files;
  - CSP_DNR_CACHE_GB (default 32, maximum 1024) and the 8 GiB free-disk
    reserve;
  - pause messages, iCloud least-recently-used archival and restore only
    when an archive is available, and the one-hour acquisition limit.
- app/areas.js explicit start and failure handling.
- usgs.js CSP_USGS_STATES scope parsing.

The mechanisms that r1 calls "existing" do exist. No owner network, runtime,
device or scientific test was performed.

Conditions interpreting and preserving r1:
1. Gating is exact. The engine advertises `wadnr-auto` only with
   CSP_DNR_AUTO=1, and it is off by default everywhere, including the Mac
   app's local engine. Jobs trigger only in Best available 2D terrain or
   elevation, at zoom 15 or closer, once settled with none of the view's own
   tiles pending or retrying. Provisional or unknown responses are not gaps.
   The gap test uses actual valid rendered numeric pixels: USGS 1 m (rank 3)
   or cached DNR (rank 5). It never uses footprints or HTTP success.
   Published DNR hillshade (CR-012) is not numeric coverage, so it neither
   suppresses nor causes a trigger. Explicit National 3DEP or USGS choices,
   3D, captures and exports never start a job.
2. Jobs stay within the existing bounds:
   - One automatic job at a time, through the existing /api/wadnr/warm job.
   - The job keeps its existing survey choice and its cell, per-archive,
     cache-budget, free-disk-reserve and time limits. No limit is raised.
   - A box already attempted this session (success, failure, budget refusal
     or cancel) is not restarted, nor is one inside cached DNR footprints.
     There is no retry loop.
   - If a start is refused because another job is running, report it as
     busy, not as a failed download.
3. Explicit download actions keep their effect and records. An automatic job
   must not leave an explicit request failing with only "already running".
   Either the automatic job yields, or the user gets an actionable status
   with that job's Cancel. Automatic jobs create no download-area records,
   outlines or on-device offline packages; CAP-14, UX-05 and D-05 are
   unchanged.
4. Data stays honest. Automatically acquired DNR enters only through the
   existing ingestion and CR-011/CR-012 paths. Per-pixel validity, survey and
   dataset provenance, revision, native spacing and units stay unchanged
   (DATA-03/06). Existing pixels stay visible while a job runs (RENDER-03),
   and completion refines the view without a map gesture or blanking. The
   progress chip says "automatic" and has a Cancel with a hit area of at
   least 44 points (UX-03). Cancel must not claim to abort an in-flight
   archive ingestion unless it actually does.
5. USGS discovery:
   - The default is `WA_,OR_,ID_,Elwha_` through the existing
     CSP_USGS_STATES; an explicit environment value still wins.
   - Tiles report their actual project names.
   - Added projects are listed in the background with bounded concurrency.
     A failed or partial listing must not replace or poison the serving index
     or create final "no 1 m" answers (the 18-of-25 failure seen on
     2026-10-21). Scope-tagged negatives are checked again once.
   - The widening also adds raw 1 m in Oregon and Idaho views; disclose this
     as an added-data effect.
   - The data is the same 3DEP 1 m product. No new datum or unit mixing is
     accepted (DATA-04).
6. No silent deferral. The PR and task report must tell Riley that r1 adds
   only the Oregon/Idaho/Elwha 1 m part of decision 1, and that the
   original-resolution DEMs were not added. Give the recheck's basis and its
   limits (a 10-point resample). Do not describe all of the missed USGS data
   as added, and give r1's 31,161 km² figure in place of the superseded
   32,138 km². If Riley still wants the original-resolution DEMs, or the
   evidence does not hold, that work falls within his existing instruction.
   It still needs its own bounded request and owner record, because it is a
   new source with its own CRS, vertical reference, native spacing and
   provenance (DATA-01/04/05).
7. Operational item 5 is within the task's scope. The instructed behavior
   needs it enabled on the Dell, the engine Riley's phone uses. It also needs
   a cap above the 32 GiB default to stay useful. Conditions:
   - Enable only the Dell.
   - Before enabling, record whether the Dell's engine has an archive. R1's
     "pauses at its cap; nothing is deleted" assumes it has none. An
     available archive would move older rasters out automatically, and that
     must then be disclosed.
   - Tell Riley about the 300 GB cap against 414 GB free disk, the retained
     8 GiB reserve and the expected 0.6–3 GB per area.
   - Applying the setting is a deployment action under separate shipping
     authority, not under this acceptance. Rollback: unset CSP_DNR_AUTO.
8. Update source and help text truthfully: opt-in engines only, Best
   available only, explicit choices excluded, and engine cache is not phone
   offline storage. Complete r1's verification plan, adding these cases:
   - an explicit download during an automatic job;
   - a view with no DNR survey;
   - a pause at the cap or the disk reserve;
   - an engine without `wadnr-auto`.
   Run all Node, static and iOS checks with matching assets. Record failures
   and physical-phone limits honestly. Unit and simulator results do not
   establish provider throughput or phone timing.

Accepted spec revision or exception scope and expiry: exact r1 only, as a
permanent bounded supplement to SPEC.md 0.1.0-draft and to CR-001's
source-selection constraint. It amends CR-011 item 3, and CR-011 owner
condition 3 (no job start from map interaction), only for engines that
advertise `wadnr-auto`. The rest of CR-011, all of CR-012 (including its
condition 5 for the published-image path) and all other CRs remain in force.
D-06 is resolved only for this acquisition policy and the 1 m discovery
default. Still unresolved: broader source, datum and tolerance policy, D-05
offline packages, and the other open decisions. SPEC.md and BASE-001 remain
unchanged and unapproved. PERF and release gates, and CR-001's internal
distribution scope and expiry, are unchanged; that expiry is BASE-001
approval or rejection, or 2027-01-31, whichever comes first. The change has no
other expiry; only a later accepted change supersedes it.

Any further Riley approval required: none for exact r1 and its necessary
implementation and verification under message 1923 and GOV-002.
- Riley must be told about the narrowing in condition 6. Whether he accepts
  it is his decision, and this acceptance does not cover it.
- Push, merge, the Dell configuration and TestFlight need separate shipping
  authority, and the parent must name the instruction it relies on.
- Material revisions need a traceable owner record under GOV-002.
- Unrelated work remains outside this acceptance.
Next action: the parent may implement and verify r1 now that acceptance is
recorded.

## Implementation and verification

PR / commit:
Evidence:
Remaining limitations:
