Download **ClearSkies-Setup-1.0.8-arm64.dmg** for Apple Silicon (M1 and newer), or **ClearSkies-Setup-1.0.8-x64.dmg** for an Intel Mac.

Open the disk image, drag **ClearSkies** into **Applications**, then open it from Applications. The app and terrain engine are included together; no Node.js or terminal setup is needed. ZIP downloads are also available.

- New in 1.0.8: inland lakes and basins retain their terrain colors and relief instead of being covered by the ocean blue scale. Separate ocean/land fitting stays enabled; includes the latest startup improvements. Bundled map build 2026-11-04f.
- First launch shows the same terrain welcome page and Pacifico ClearSkies wordmark as Windows. Choose **Open ClearSkies** to start exploring, or **Learn about Tailscale** for the optional remote-access guide.
- Optional **Advanced configuration** on the welcome page sets terrain tile, WA DNR and memory cache limits, free disk-space reserve, terrain workers, and smoother panning (Off / Auto / On). Skip it to use the default setup.
- The guide includes the official Tailscale for Mac download, engine capabilities, and Dock instructions. Reopen the welcome or guide from the **Help** menu.
- The local engine starts with the app. Existing Mac terrain services and saved engine ports are still supported. Saved markup and caches stay outside the app bundle and survive app replacement.
- Tailscale is optional and installed separately. Private engine sharing currently requires manual configuration. Keep ClearSkies running and the engine computer awake for remote access.
- Terrain detail depends on survey coverage and provider availability. Overview data stays labeled as overview.

These builds are ad-hoc signed and are **not Apple-notarized**. macOS may block the first opening of an app downloaded from the internet. After moving it to Applications and trying to open it, use **System Settings → Privacy & Security → Open Anyway** if macOS blocks it. SHA-256 checksums are included.

Default setup: 15 GiB disposable tile cache, 32 GiB WA DNR terrain cache, 2 GiB DNR download limit, 256 MiB memory cache, 8 GiB free-space reserve, automatic terrain workers (up to 8), and Auto smoother panning. Limits are not preallocated. Saved offline areas are protected from tile-cache eviction. Custom cache/worker settings use the included engine without changing an existing terrain service.

- The installer includes a 235-tile overview elevation snapshot (about 23 MiB) for the default Missoula view and its immediate border. The real map loads behind the welcome page during setup; Open ClearSkies reveals that same map without reloading. Normal national and survey sources refine it as available. Basemaps and live overlays still use their usual providers.
