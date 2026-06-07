# Native binary shape proofs

This harness proves the remaining simple Track A binary shapes with retained bidirectional evidence.

It compiles a target-native C fixture on both hosts and runs each shape in both directions:

- `arm64 -> amd64`
- `amd64 -> arm64`

Covered shapes:

- `002-string-transform-cli`
- `003-array-sum-cli`
- `004-linked-list-cli`
- `005-regular-file-reader`
- `006-append-only-logger`
- `007-argv-env-printer`
- `008-malloc-object-graph`
- `009-recursive-factorial-safepoint`
- `011-two-file-copy-cli`
- `012-seek-overwrite-cli`
- `013-line-reader-cli`
- `014-directory-listing-cli`
- `015-stat-checker-cli`
- `016-stdio-echo-cli`
- `017-fixed-ring-buffer-cli`
- `018-queue-cli`
- `019-binary-tree-traversal-cli`
- `020-hash-table-fixed-buckets-cli`
- `021-graph-with-shared-node-cli`
- `022-cycle-list-cli`
- `023-struct-with-nested-pointers-cli`
- `024-global-variable-counter-cli`
- `025-static-buffer-cli`
- `026-multiple-stack-frames-cli`
- `027-callee-saved-register-cli`
- `028-float-simd-scalar-cli`
- `029-errno-libc-result-boundary-cli`
- `030-malloc-free-boundary-cli`

- `031-csv-record-parser-cli`
- `032-json-token-parser-cli`
- `033-checksum-running-sum-cli`
- `034-rle-decoder-cli`
- `035-chunked-decoder-cli`
- `036-fixed-arena-allocator-cli`
- `037-bitmap-scanner-cli`
- `038-bitset-counter-cli`
- `039-priority-queue-fixed-heap-cli`
- `040-deque-cli`
- `041-trie-lookup-cli`
- `042-tokenizer-state-machine-cli`
- `043-config-reload-cli`
- `044-temp-file-rename-cli`
- `045-file-truncate-cli`
- `046-sparse-file-seek-cli`
- `047-commit-marker-file-cli`
- `048-lockfile-cli`
- `049-monotonic-counter-file-cli`
- `050-deterministic-prng-cli`
- `051-less-readonly-pager-cli`
- `052-less-search-forward-cli`
- `053-less-page-backward-cli`
- `054-less-percent-position-cli`
- `055-less-mark-jump-cli`
- `056-less-goto-line-cli`
- `057-less-horizontal-scroll-cli`
- `058-less-tail-snapshot-cli`
- `059-grep-line-boundary-cli`
- `060-wc-line-count-cli`
- `061-tail-readonly-cli`
- `062-less-screen-render-cli`
- `063-less-wrap-long-line-cli`
- `064-less-no-wrap-long-line-cli`
- `065-less-tab-expand-cli`
- `066-less-case-insensitive-search-cli`
- `067-less-highlight-match-cli`
- `068-less-status-prompt-cli`
- `069-less-multiple-file-index-cli`
- `070-less-quit-state-cli`
- `071-less-help-screen-cli`

The proof is still a declared-safe-point harness. It does not claim arbitrary process restore.

Run:

```sh
portability/research/native-binary-shape-proofs/verify.sh
```

Retained captures, restore logs, and the summary report are under `retained/`.
