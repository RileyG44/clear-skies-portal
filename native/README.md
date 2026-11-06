# ClearSkies native core

The Rust engine that runs inside the iPhone app (and later behind Electron,
the web client and Android). Plan and progress: `docs/native/`.

```sh
cd native
cargo test                      # unit tests and the frozen L1 goldens
cargo clippy --all-targets -- -D warnings
cargo build --release --target aarch64-apple-ios
```

The toolchain is pinned in `rust-toolchain.toml`; rustup installs it on
first use.

- `crates/csk-core` — codecs (`codec`), the `elev32` tile format, geodesy.
- `fixtures/` — frozen goldens. `generate.js` writes the TIFFs and
  `goldens.json` from ground truth and records whether today's `cog.js`
  matches each case. The committed files are the contract: regenerate only
  to add cases, and check that existing block hashes do not change.
- `inventory/routes.js` — writes `docs/native/ROUTES.md`.
