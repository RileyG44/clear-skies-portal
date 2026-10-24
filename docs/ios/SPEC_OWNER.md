# Dedicated Spec Owner — role and handoff

Project: Clear Skies Native iOS
Appointed by: Riley Grant, current 2026-09-06 user request
Initial agent: /root/spec_owner (session handle, not a permanent service)
Current owner session: Spec Owner session re-established 2026-10-21 under
Riley's authorization (Claude subagent), to record CR-001. It ends at this
handoff and is not a running service.
Current baseline: SPEC.md 0.1.0-draft (commit 142fdf47) — not approved by
Riley; BASE-001 pending
Accepted change requests: CR-001 r1, accepted 2026-10-21 (see DECISIONS.md)
Current task: none open

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
