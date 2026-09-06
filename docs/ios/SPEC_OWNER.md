# Dedicated Spec Owner — role and handoff

Project: Clear Skies Native iOS
Appointed by: Riley Grant, current 2026-09-06 user request
Initial agent: /root/spec_owner (session handle, not a permanent service)
Current baseline: SPEC.md 0.1.0-draft — not yet approved by Riley
Current task: inventory, review initial draft and preserve approval boundaries

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
