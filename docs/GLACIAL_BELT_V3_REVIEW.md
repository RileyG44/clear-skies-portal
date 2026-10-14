# Belt v3 final review

Status: review and authorized fixes complete; eight focused regressions pass. No remaining blocking findings within reviewed scope.

Expanded scope authorized by root: fix explicit empty pixel lists and remove guessed raster encoding in evaluator, add compressed-view corpus hashes to experiment identity, add focused evaluation contract regressions in test-glacial-object-evaluation.js, and include that test in npm test. No other repository edits. Changes are frozen for parent evaluation.

Findings so far:
- Experiment identity previously hashed only wrapper bytes. Root added all seven pipeline dependencies, metric evaluator, loader, and manifest; reviewer preserved these and added sorted filename-to-SHA256 identity of all cached .json.gz bytes. Corpus identity is shared across splits and does not decode or score held-out files.
- Explicit empty pixels list previously fell back to raster membership. Fixed: empty lists remain explicit empty membership, yielding no eligibility/touch/recall credit.
- Raster membership previously guessed 0/1-based array indices when ids were not present, potentially assigning background to a segment. Fixed: zero is always background and only explicit ids match.
- Ridge pixels were omitted from published objects, allowing belt raster winners to obscure ridge membership. Root now publishes original ridge pixels.
- Priority-flood implementation and peak suppression are internally consistent with their documented approximations. No new blocking algorithm defects found.

Caveats:
- Hummocks are resolved elevation peaks, not segmented geomorphic hummock objects; nearby/shallow or outside-zone suppression can affect counts. This is documented.
- Kettles are thresholded drainage depressions, not evidence of glacial origin. The original block-field landslide contains real depressions and remains a legitimate confuser; do not tune thresholds to erase that diagnostic.
- Initial design text and belt evidence still describe likely/possible ridge support, while integration now counts only likely ridges with overlap/alignment. This wording should be reconciled for reviewer-facing documentation; it does not change computed results.

Validation:
- Priority flood matches independent minimax relaxation on 120 random small grids including no-data.
- Context timing on synthetic square grids: 128 cells/side 9 ms; 512 cells/side 266 ms. This is a narrow local check, not full-dataset or device performance evidence.
- Exported evaluator rejects test split before analysis call.
- New test-glacial-object-evaluation.js contains eight focused checks: empty-list membership, original belt membership preference, overlapping object union, raster fallback, absent-id background safety, dependency byte identity, corpus byte identity/shared split identity, and API/CLI test refusal. It is included in npm test.
- node test-glacial-object-evaluation.js: eight checks passed after iCloud source hydration resumed.
- node --check evaluator and new regression test: passed. git diff --check: passed.
- Parent owns full train/validation evaluation. No held-out dataset evaluation was run by reviewer; test refusal used synthetic input and CLI refusal only.
