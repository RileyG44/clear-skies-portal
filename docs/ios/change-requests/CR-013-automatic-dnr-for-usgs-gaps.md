# CR-013 — download WA DNR elevation automatically for viewed USGS gaps

Status: DRAFT
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

Owner identity and review date:
Decision / rationale:
Accepted spec revision or exception scope and expiry:
Any further Riley approval required:

## Implementation and verification

PR / commit:
Evidence:
Remaining limitations:
