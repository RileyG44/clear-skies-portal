# MacBook rollout: hand this to the agent on Riley's MacBook

Riley owns this product and has authorised everything below. Do it end to end
and do not stop to ask unless a step cannot be completed. Report what happened
at each step, including anything skipped or failed.

Goal: every device on the home network runs the latest `main`, then a new
TestFlight build goes up. This rollout delivers the "always best LiDAR" map
(build stamp `2026-10-30a` or newer).

## 1. Get the code

```sh
cd ~/clear-skies-portal        # or wherever this repository is checked out
git status                     # if there are uncommitted changes, stop and report them
git checkout main && git pull --ff-only
npm ci
npm run check
```

Confirm `version.js` says `2026-10-30a` or newer.

## 2. Update the Dell (production terrain engine)

The engine the phone uses runs on `dell-server`, not on this Mac. Tailnet address
`dell-server.tail946e94.ts.net`, health at
`https://dell-server.tail946e94.ts.net:8443/api/health`.

1. Connect with `ssh dell-server` (try the tailnet name above if that fails). If
   you cannot get in, say so plainly, carry on with the remaining steps, and tell
   Riley exactly what the Dell still needs.
2. Find how the engine runs before changing anything: look for its checkout and
   for the service (`systemctl list-units | grep -i -E 'clear|csp|terrain'`,
   `systemctl --user list-units`, `docker ps`, `pm2 ls`).
3. In that checkout: `git pull --ff-only`, then `npm ci --omit=dev`, then restart
   that same service.
4. Check the health URL returns `"ok":true` and `uptimeSec` has reset.
5. Render speed: run `nproc` on the Dell and compare it with `terrain.workers` in
   the health output. Workers default to cores minus one, up to eight. If
   `CSP_TERRAIN_WORKERS` is pinning it lower than that, raise it to cores minus
   one and restart. Report both numbers either way.

Do not touch the Dell's cache directory or its downloaded DNR files.

## 3. Update other local devices

- This Mac, if it runs the local engine service
  (`launchctl list | grep clear-skies`): run `scripts/install-mac-service.sh`,
  then check `http://127.0.0.1:8765/api/health`.
- Any other machine on the network running Clear Skies: update it the same way
  as the Dell, and list every machine you updated. Do not guess at machines you
  cannot confirm are running it.
- The web app deploys itself from `main` through GitHub Pages. Confirm the latest
  `main` run succeeded with `gh run list --branch main --limit 3`.

## 4. Push the TestFlight build

```sh
ios/scripts/testflight.sh
```

It needs Xcode, `xcodegen` and `ios/Config/Local.xcconfig` with the team ID (see
`ios/README.md`). Do not edit signing or bundle settings to get past an error;
report it instead. This build matters beyond the web changes: it carries the
native tile cache and the higher connection limit in `EngineProxy.swift`.

## 5. Verify and report

With the Dell updated and the new build installed, open a Washington view in
plain hillshade and zoom to about 18:

- The map should sharpen from the centre of the screen outward and stay sharp at
  any zoom.
- Panning back over ground already seen should be near instant.

Report: Dell before and after commit, worker count, machines updated, TestFlight
build number, anything that failed.
