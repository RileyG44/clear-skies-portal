# CR-008 — pixel satellite startup cover

Status: ACCEPTED 2026-10-28 (America/Los_Angeles), exact r1 only
Request content revision: r1
Author / task: pixel loader implementation, Riley direct build instruction 2026-10-28
Current approved spec revision: SPEC.md 0.1.0-draft remains unapproved; CR-001 r1 and accepted CR-002–007 supplements govern existing clients.
Affected requirement IDs: U-04, UX-02/03, CR-001 parity/unchanged-web condition; engineering contracts 1–10.
Type: bounded specification supplement

## Existing requirement and conflict
CR-001 preserves existing web behavior. This direct instruction replaces only the first-load appearance across web, Electron and the existing iOS web shell, including native cover and static launch background. No scientific, map-selection, readiness, retry, cache or data contract changes.

## Exact requested change
Use Riley's updated satellite-loader-gen.py as visual source: 240×96 logical pixels, black background, white/gray satellite horizontally centered with gentle one-pixel hover, three dashed beams sweeping the ground, zigzag hills, sparse dots, pine/cross props and twinkling stars. No HUD, border or horizontal satellite travel. Small code-drawn implementations, crisp nearest-neighbor/integer scaling, centered within safe areas in all orientations. Reduced motion uses a still frame. Static iOS launch is black; native cover appears while existing web readiness is pending. Existing readiness and recovery behavior, including failure messages/reload, remain; add no minimum display duration. Shared web startup also covers Electron. Scope is permanent appearance only; no deployment, push or TestFlight.

## Alternatives and impact
MP4 adds decode/startup payload; code drawing avoids that. Rollback is reverting this bounded change. No scientific, privacy, pricing or provider changes. Preserve PR #38 and engineering loading invariants.

## Verification plan
Run npm run check, npm test and Python unittest suite; build iOS; visually verify phone and desktop web plus iOS simulator, reduced motion, pure black launch, crisp scaling and ready handoff. Record limitations honestly. Synchronize existing site assembly, service worker and Electron packaging if needed.

## Riley approval
Direct user build instruction and subsequent update in this session authorize this exact bounded task under GOV-002. Latest update explicitly removes signal bars/all HUD and horizontal travel, requires re-reading the updated generator, own branch, no push and no TestFlight. Digest is a later traceability binding, not a hash presented to Riley.


## Spec Owner disposition — accepted

Owner: dedicated Spec Owner sub-agent (Codex), CR-008 r1 only, 2026-10-28.
Decision: ACCEPTED, exact original r1. Binding: SHA-256
`56d5e2d2e090e8365857782249e681cd7369e01666a7942e2c57a78f109adc47`
over the original 2,556 UTF-8/LF bytes before this disposition heading, with workflow
Status normalized to `Status: DRAFT` and the original single terminal newline.
This later traceability binding was not presented to Riley as an approved digest.

Authority independently verified using t3_thread_read, messages view, limit 10,
maxCharsPerItem 12000, hasMore false, in the
[parent thread](<t3-thread://v2/25ec7f29-6fda-4160-a0ec-8450030a6239/thread:project:95d7b465-9ac4-4d9b-ad2b-94155aa5a211:a00883ec-537b-48f5-9e61-e2cd8cd967e9>).
Actual completed, untruncated user_message position 0, createdBy user,
creationSource web, messageId ee91f0bc-99f4-4044-bd21-8b3d7b9b10ce,
updatedAt 2026-10-28T19:20:34.002Z, instructs:

> Replace Clear Skies Portal's first-load screen (the screen Riley sees for about a second when the app first opens) with a black pixel-art loading animation.

Its numbered instructions require finding web/Electron/iOS startup screens,
code-drawn crisp pixels on black, safe areas, reduced motion, black static iOS
launch, existing timing/loading/scientific logic and PR #38 intact, isolated
feat/pixel-loader worktree from fetched main, named test suites and screenshots.
Actual user_message position 3, same creation/status properties, messageId
46b89ba4-6b81-47e5-9c27-c19ef8187c44, updatedAt 2026-10-28T19:29:13.283Z,
supersedes the old moving satellite/HUD design with:

> 1. No signal-bars icon in the top right (or any other HUD element). Only the satellite, beams, hills, props and stars.
> 2. The satellite no longer travels left and right. It stays in the horizontal center, with only a gentle one-pixel vertical hover, while its three dashed beams sweep slowly across the ground below. The first-load screen is only visible for about a second, so it should read instantly.

It also says: "keep the other instructions (own branch, no push, no TestFlight)."
GOV-002 authorizes necessary bounded changes and this dedicated review without
another approval/restoration question. No push, distribution or deployment is
accepted here, regardless of permissions in earlier unrelated tasks.

Consistency evidence: independently read governing records and accepted requests,
the updated generator (SHA-256
`103ad40e02648228158a04efdefcc643198658a1d725fd6dc1fcd10114fc4a4c`),
index.html CSPBoot panel/ready/error handlers, Electron BrowserWindow background,
MapChrome.swift LaunchCover and ios/Config/Info.plist launch color. The generator
has 240×96 pixels, 192 frames at 24 fps, fixed satellite x=120, rounded 1.2-pixel
sinusoidal y displacement, phase-offset beams, seeded stars and no HUD. Its
unused rounded mask does not apply to output; no rounded border is required.
Current web recovery has a 12-second warning and immediate existing ready-event
handoff; native LaunchCover uses the same existing pending-ready composition.
This is appearance replacement, not permission to duplicate scientific or loading
logic in Swift or delay ready presentation.

Conditions:
1. Use the updated generator's look/motion and preserve pure black, no HUD,
   border or horizontal satellite travel; static launch is black in both
   appearances. Keep animation within safe areas and fit short/rotated screens.
2. Preserve existing readiness/error/retry/recovery signals and timing, and
   PR #38 map selection. No artificial minimum duration, network dependency,
   new heavy startup asset or changes to map/scientific/loading work.
3. Reduced motion shows a still frame, including the existing app preference
   where applicable; keep a meaningful accessible loading/restoring status.
   Failure recovery remains usable rather than disappearing behind decoration.
4. Complete r1 verification and report evidence/limits: named JS/Python suites,
   current iOS build, web phone/desktop and iOS simulator visuals, crisp scaling,
   no old/white flash and clean ready handoff. Keep shared packaging synchronized.
   This acceptance supplies no runtime, performance or physical-device evidence.

Spec treatment: permanent bounded startup appearance supplement to SPEC.md
0.1.0-draft, which remains unchanged and unapproved with BASE-001 pending.
Supplements CR-001's unchanged-web condition and glass chrome requirement only
for this instructed startup cover. Native navigation/controls remain system
chrome; all capabilities, bridge/scientific reuse, prior CRs, open decisions,
proposed PERF gates, release gates and CR-001 internal exception expiry
(BASE-001 approval/rejection or 2027-01-31, whichever first) remain unchanged.
No further Riley approval is needed to implement exact r1 within these bounds.

## Implementation and verification

Owner acceptance only. No app code changed, runtime/device/scientific checks,
commit, push, deployment or distribution performed by this owner. Implementation
and verification remain with parent; do not infer IMPLEMENTED or VERIFIED.
Only CR-008, DECISIONS.md and SPEC_OWNER.md changed, left uncommitted for parent.
This bounded owner session ends at handoff; no ongoing owner remains and custody
does not transfer to the implementer. Branch protection/mandatory spec review
enforcement was not verified.

## Implementation and verification

Implemented on local branch `feat/pixel-loader`; see `artifacts/pixel-loader/VERIFICATION.md` for surfaces, screenshots, test evidence and limitations. No push, deployment or TestFlight. The implementation does not mark the pending native baseline or release gates approved.
