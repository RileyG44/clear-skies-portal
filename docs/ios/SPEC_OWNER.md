# Dedicated Spec Owner — role and handoff

Project: Clear Skies Native iOS
Appointed by: Riley Grant, current 2026-09-06 user request
Initial agent: /root/spec_owner (session handle, not a permanent service)
Current owner session: one dedicated Spec Owner review sub-agent (Codex),
re-established 2026-10-24 under Riley's exact CR-002 r1 approval, to review and
record that request only. It ends at this handoff and is not a running service.
Current baseline: SPEC.md 0.1.0-draft (commit 142fdf47) — not approved by
Riley; BASE-001 pending
Accepted change requests: CR-001 r1, accepted 2026-10-21; CR-002 r1, accepted
2026-10-24 (see DECISIONS.md)
Current task: CR-002 owner recording complete; implementation and verification
handed back to the coordinating implementer. No other owner request is authorized.

## Start here

Read root AGENTS.md, SPEC.md, GOVERNANCE.md, DECISIONS.md and all accepted,
unexpired change requests. Inspect affected source and tests, not just README.
Read OWNER_REVIEW.md for the initial independent review and known limitations.

## Responsibilities

- Own the canonical spec; prevent assumptions from becoming silent requirements.
- Maintain stable requirement IDs, parity matrix, open decisions, acceptance gates,
  version log, approved exceptions and traceable Riley approval evidence.
- Review only owner requests authorized by Riley. Initial draft review is expressly
  authorized by the appointment; future requests need their own authorization.
- Advise Riley candidly on tradeoffs; never approve a deviation on Riley's behalf.
- After Riley approves the exact change, accept/reject for consistency and apply
  the corresponding spec change or scoped exception. If the requested wording
  needs substantive adjustment, return it to Riley before proceeding.
- For approved implementation-review requests, distinguish code completion, measured
  acceptance, live provider verification, scientific validation and release readiness.
- At handoff, record current spec/revision, approved request IDs, outstanding blockers,
  implementation evidence and the next authorized action. Do not spawn successors
  or assume perpetual execution without Riley's authorization.

## Review checklist

1. Is there explicit Riley approval for this request and its exact revision?
2. Does the proposed change preserve or explicitly amend feature parity?
3. Are source validity, units, datum, acquisition dates and scientific meaning honest?
4. Are loading, cache, offline, lifecycle and failure contracts maintained?
5. Are native/device and cost claims backed by relevant measurements?
6. Are all affected requirements and tests accounted for, including temporary code?
7. Is acceptance or refusal recorded with scope, conditions and follow-up?

An agent's confident assertion, a green CI result, or Riley approving a different
request does not establish approval for this one.

## Handoff — 2026-10-21

- Spec: SPEC.md 0.1.0-draft, unchanged since commit 142fdf47. CR-001 r1
  supplements it: for the native client it replaces ARCH-02 and ARCH-03 and
  resolves D-02. Read the request, its disposition and DECISIONS.md together.
- Accepted requests: CR-001 r1 (digest in DECISIONS.md), with conditions 1–7.
  Its exception expires when BASE-001 is approved or rejected, or 2027-01-31,
  whichever comes first.
- Implementation evidence: none yet. Riley's approval and this acceptance are
  not test, device or field evidence.
- Next authorized action: the implementer may do CR-001 item 3 (local archive
  commit), Stage 1, Stage 2 and internal TestFlight builds for Riley's own
  devices, within the stated scope and conditions. Anything else needs a new
  request approved by Riley.
- Outstanding blockers:
  - BASE-001 is pending. On 2026-10-21 Riley said the September draft reflects
    an outdated app; a refresh or decision is his call. Approving or rejecting
    BASE-001 ends the CR-001 exception. If BASE-001 is withdrawn or replaced
    instead, return the expiry question to Riley.
  - Before any baseline goes to Riley, reconcile ARCH-02, ARCH-03 and D-02 with
    CR-001.
  - D-01 and D-03 to D-08 are open; the PERF gates are proposed.
  - CR-001 and this session's record edits are uncommitted. They must be
    committed for the record to live in git.
  - Branch protection and required Riley review of spec paths were not verified
    in this session.
  - The archive branch will contain Riley's tailnet hostname. Publishing it
    needs his decision.

## Handoff — 2026-10-24 (CR-002 r1 only)

- Authority: Riley answered "Approve CR-002 r1" in the
  [parent T3 Code thread](t3-thread://v1/12850bd3-bebe-4837-b8d1-0ed4492f4146).
  This owner independently inspected activity position 1548 (question) and 1561
  (actual user response), including the express authorization to restore one
  Spec Owner session to record this exact correction. The approval of r1 covers
  both restoration and recording; no second approval is needed for that scope.
- Spec: SPEC.md 0.1.0-draft is unchanged from the pending package at commit
  142fdf4748baddf6cb03d6cdde1c9f67fe012d50 and remains unapproved. Read it with
  accepted supplements CR-001 r1 and CR-002 r1. CR-001's conditions 1–7 and
  exception expiry are unchanged.
- CR-002 binding: SHA-256
  808d43d5bf10a8d1c7e5846f5d42b4864f6261623c121bf23cc8db2877dd919f over the
  UTF-8/LF proposal bytes before its "## Riley approval" heading, normalizing
  only the workflow status to the original "Status: DRAFT". Independently
  reproduced here; the request records exact approval and review evidence.
- Accepted scope: permanent shared Analyze curvature name/description correction
  with the exact native mirror. CAP-08, DATA-06, D-06 (this label only) and
  CR-001 parity conditions are the affected references. No other D-06 decision
  is resolved. The request's original digest-bound proposal governs.
- Review evidence: static source inspection confirms result.laplacian is the
  displayed curvature product, computed as the sum of east-west and north-south
  elevation second derivatives. The existing legend conversion is v * .3048 with
  a /ft suffix. No calculation, unit, product identifier or behavior change is
  authorized by this correction.
- Implementation evidence for CR-002: none from this session. The owner changed
  no app code and ran no runtime/numerical regression checks. Acceptance records
  permission to implement; F11 is not marked implemented or verified.
- Next authorized action: the coordinating implementer may apply the two exact
  shared UI strings in CR-002, preserve their exact native mirror, and verify
  the strings, unchanged result.laplacian selection and /ft conversion, and the
  research-analysis/scientific regressions. CR-001's shared-code checks and
  matching iOS bundle still apply. Leave these owner records uncommitted for
  the parent to include with its work.
- Outstanding: BASE-001 remains pending; D-01 and D-03 through D-08 remain open
  except the narrow CR-002 curvature wording correction. PERF gates remain
  proposed. This review does not establish device/scientific validation or
  release readiness. Branch protection and required Riley review of spec paths
  were not verified in this session.
- Continuity: this one-request owner session ends at this handoff. A future
  request or owner restoration needs Riley's authorization under GOVERNANCE.md;
  the coordinating implementer does not inherit owner approval authority.
