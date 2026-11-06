Windows 10/11 x64. Download **ClearSkies-Setup-1.0.11-x64.exe** for one-click installation. It permanently installs ClearSkies and its terrain engine into your user profile, creates Desktop and Start shortcuts, and registers an uninstaller in Windows Settings. No Node.js or terminal setup needed.

**ClearSkies-Guided-Setup-1.0.11-x64.exe** provides a branded wizard and location selection. The ZIP is an optional portable alternative; extract the entire folder before launching.

- New in 1.0.11: The startup screen stays plain white with the landing maple, which grows and then dissolves into the ready map. A cached map still shows the tree, and a slow connection no longer shows an error while tiles are still arriving. The installed iPhone layout fills the screen, and the phone toolbar stays clear of map info. Bundled map build 2026-11-05r.
- From 1.0.10: 3D terrain opens tilted and responds to two-finger tilt again. The 3D view now appears on its first drawn frame, so one slow elevation tile can no longer hold it hidden behind the flat map.
- From 1.0.9: reorganized Satellite imagery and Elevation menus with Planetary Computer results and exact heights; right-click Identify surface geology works again.
- Optional **Advanced configuration** on the welcome page lets you set terrain tile, WA DNR and memory cache limits, free disk-space reserve, terrain workers, and smoother panning (Off / Auto / On). Skip it to use the default setup. Reopen the welcome with the Start setup shortcut to change these later.
- Includes the **Missoula** LiDAR preset and the Missoula scablands startup view near Medical Lake, WA.
- ClearSkies icon, full-bleed map, overlaid window controls, no standard title/menu bars.
- A LiDAR welcome screen uses Riley's terrain capture and the same Pacifico ClearSkies wordmark as the mobile menu. Open the app directly or choose Learn about Tailscale for page two.
- The second-page setup guide compares browser-only use with the included terrain engine, explains private desktop/mobile access, and links to the official Tailscale site and its version-independent latest stable Windows installer.
- Tailscale is optional and installed separately. Automatic Tailscale engine setup and link generation are planned for the next update. Keep ClearSkies running and the engine computer awake to use its engine remotely.
- Engine availability and resolution depend on source coverage. Tailscale supplies connectivity, not higher-resolution imagery by itself.

These Windows packages are currently unsigned. Windows may show an unknown-publisher notice. SHA-256 checksums are included. Updates retain user data; uninstall does not delete saved app data.

Default setup: 15 GiB disposable tile cache, 32 GiB WA DNR terrain cache, 2 GiB DNR download limit, 256 MiB memory cache, 8 GiB free-space reserve, automatic terrain workers (up to 8), and Auto smoother panning. Limits are not preallocated. Saved offline areas are protected from tile-cache eviction. Custom cache/worker settings use the included engine without changing an existing terrain service.

- The installer includes a 235-tile overview elevation snapshot (about 23 MiB) for the default Missoula view and its immediate border. The real map loads behind the welcome page during setup; Open ClearSkies reveals that same map without reloading. Normal national and survey sources refine it as available. Basemaps and live overlays still use their usual providers.
