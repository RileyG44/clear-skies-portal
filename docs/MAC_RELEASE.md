Download **ClearSkies-Setup-1.0.4-arm64.dmg** for Apple Silicon (M1 and newer), or **ClearSkies-Setup-1.0.4-x64.dmg** for an Intel Mac.

Open the disk image, drag **ClearSkies** into **Applications**, then open it from Applications. The app and terrain engine are included together; no Node.js or terminal setup is needed. ZIP downloads are also available.

- First launch shows the same terrain welcome page and Pacifico ClearSkies wordmark as Windows. Choose **Open ClearSkies** to start exploring, or **Learn about Tailscale** for the optional remote-access guide.
- Optional **Advanced configuration** on the welcome page sets terrain tile, WA DNR and memory cache limits, free disk-space reserve, terrain workers, and smoother panning (Off / Auto / On). Skip it to use the default setup.
- The guide includes the official Tailscale for Mac download, engine capabilities, and Dock instructions. Reopen the welcome or guide from the **Help** menu.
- The local engine starts with the app. Existing Mac terrain services and saved engine ports are still supported. Saved markup and caches stay outside the app bundle and survive app replacement.
- Tailscale is optional and installed separately. Private engine sharing currently requires manual configuration. Keep ClearSkies running and the engine computer awake for remote access.
- Terrain detail depends on survey coverage and provider availability. Overview data stays labeled as overview.

These builds are ad-hoc signed and are **not Apple-notarized**. macOS may block the first opening of an app downloaded from the internet. After moving it to Applications and trying to open it, use **System Settings → Privacy & Security → Open Anyway** if macOS blocks it. SHA-256 checksums are included.

Default setup: 15 GiB disposable tile cache, 32 GiB WA DNR terrain cache, 2 GiB DNR download cache, 256 MiB memory cache, 8 GiB free-space reserve, automatic terrain workers (up to 8), and Auto smoother panning. Limits are not preallocated. Saved offline areas are protected from tile-cache eviction. Custom cache/worker settings use the included engine without changing an existing terrain service.
