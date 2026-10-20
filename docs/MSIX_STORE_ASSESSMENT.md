# MSIX / Microsoft Store Assessment

Assessed 2026-10-16 against the working tree (Drama Studio 0.1.5, Electron
44, electron-builder 26). This is a feasibility review only. No build config
was changed.

## Verdict

**Possible, with a short list of code fixes first.** electron-builder already
ships an `appx` target (`node_modules/app-builder-lib/out/targets/AppxTarget.js`),
and this machine has the Windows 10/11 SDK packaging tools
(`makeappx.exe`, `makepri.exe`, `signtool.exe` in
`Windows Kits/10/bin/10.0.26100.0/x64`). Partner Center accepts the `.appx`
that electron-builder produces: it's the same package format family as
MSIX, and the Store re-signs it.

Nothing found is a hard blocker. Four items would break or misbehave inside
an MSIX package and should be fixed before a Store build (see "Must fix").

## Two ways into the Store

| | A. MSIX / AppX package (`appx` target) | B. Submit the existing NSIS `.exe` installer |
| --- | --- | --- |
| Code-signing cert | **Not needed for Store**: Microsoft signs the package | Needed: must chain to the Microsoft Trusted Root (Azure Trusted Signing qualifies, if your identity is eligible) |
| Updates | Store updates automatically | You host versioned installers at a stable HTTPS URL; the Store does not update the app |
| Install / uninstall | Clean, per-user, no admin | Normal NSIS behaviour |
| File system | Install folder read-only; AppData writes virtualized (see below) | Unchanged from today |
| Work needed | Fixes below + tile assets + `appx` config | Signed installer, silent-install switch (`/S`), hosting |
| Store listing benefits | Full (trust badge, auto-update, family/enterprise deploy) | Listing + download only |

**Recommendation: A (MSIX).** It removes the need for a paid or
eligibility-restricted signing certificate and gives free auto-updates. Keep
NSIS and portable for direct downloads from the website.

## Must fix before a Store build

1. **SFX library default folder** (`electron/main.js` `defaultSfxLibraryDir`).
   It writes "next to the app" when `fs.accessSync(installDir, W_OK)`
   passes. On Windows, Node's `W_OK` only checks the read-only attribute, not
   ACLs. So it says *writable* for `C:\Program Files\WindowsApps\…` (and
   for per-machine NSIS installs in Program Files), and the download then
   fails. Fix: when packaged, and not portable, default to
   `app.getPath('userData')` or Documents. Better, detect the package with
   `process.windowsStore` and test writability by actually creating a temp
   file.
2. **AppData virtualization reaches child processes.** Writes to
   `%APPDATA%` / `%LOCALAPPDATA%` from the app *and from processes it
   starts* go to `%LOCALAPPDATA%\Packages\<package>\LocalCache\…`. That
   covers ComfyUI launch, `pip install -r requirements.txt` for custom nodes
   (`electron/main.js` ~1294), and the RTX VSR pip bootstrap
   (`electron/rtxVideoUpscale.js`). Pip caches, user site-packages and
   ComfyUI user config written under AppData would silently land in the
   private package store and vanish on uninstall. Writes to real paths
   (e.g. `F:\…\ComfyUI\custom_nodes`) are **not** virtualized.
   Fix: declare `rescap:unvirtualizedResources` and
   `desktop6:FileSystemWriteVirtualization = disabled` (and the registry
   equivalent) in the manifest. This is a restricted capability: the Store
   asks for a justification ("launches the user's own ComfyUI/Python
   install"). It's usually approved for dev-tool style apps, but plan for a
   review round.
3. **RIFE signer check** (`electron/rifeRuntime.js`
   `verifyPlatformSignature`). It requires the RIFE helper's Authenticode
   signer to equal the host `Drama Studio.exe` signer. Inside a
   Store-signed package the host is covered by Microsoft's package
   signature, while the RIFE exe keeps our Azure signature, so the subjects
   likely differ and smooth-motion gets disabled. Must be tested on a real
   Store-signed install. A likely fix is to accept the package signer when
   `process.windowsStore` is true, and verify the package-family name
   instead.
4. **Publisher identity.** The signing publisher name was `"Jaime Aguirre"`,
   inherited from upstream; it is now `"Jeffrey Cayao"`, set by
   `scripts/ci-signed-builder-config.cjs` (repository variable
   `AZURE_PUBLISHER_NAME`). It must equal the CN on the Azure Trusted Signing
   certificate profile, or signing fails. The `appx` config still needs your
   Partner Center values: `identityName` and `publisher` (`CN=…` from
   Partner Center → Product identity). `publisherDisplayName` is
   `"Jeffrey Cayao"` and `displayName` is "Drama Studio", which must match
   the reserved app name in Partner Center.

## Certification: ComfyUI is required

Since 2026-10-16 the app blocks on a first-launch setup screen until ComfyUI is
found (`src/components/ComfySetupGate.jsx`). Microsoft's certification testers
won't have ComfyUI, so the submission's certification notes must:

- say that ComfyUI (free, comfy.org) is a required companion app;
- give step-by-step install instructions (Comfy Desktop installer); and
- state the dependency in the Store description.

If testers reject it anyway, the fallback is a reviewer path that lets the
editor open without ComfyUI. `DS_SKIP_COMFY_GATE=1` exists, but testers
can't set environment variables.

## Should do

- **Tile and store assets** in `build/appx/`: `StoreLogo.png` (50×50),
  `Square44x44Logo.png`, `Square150x150Logo.png`, `Wide310x150Logo.png`, and
  optionally `LargeTile`/`SmallTile`, with scale variants. Without them,
  electron-builder falls back to its default placeholder art, which the Store
  rejects.
- **Existing users' data.** People moving from the portable or NSIS build
  keep their settings in the real `%APPDATA%\Drama Studio`. The MSIX build
  writes to its virtualized copy. Test whether existing settings are seen;
  if not, add a one-time "import settings from the desktop version" step.
  Projects are unaffected: they live in user folders.
- **MCP clients.** The MCP server is HTTP on `127.0.0.1` (`electron/mcpServer.js`),
  so it keeps working: full-trust MSIX apps aren't loopback-restricted. Any
  docs that tell users to point a client at the exe path need an
  App Execution Alias (`uap3:AppExecutionAlias`), because WindowsApps paths
  can't be launched directly.
- **Version format.** MSIX needs `major.minor.build.revision` with each part
  ≤ 65535. electron-builder maps `0.1.5` to `0.1.5.0`, which is fine.
  The patch bump on every build is also fine.
- **Store policy review.** These features are worth describing clearly in
  the listing and certification notes:
  - Installing ComfyUI custom nodes and Python packages. Policy 10.2.2
    allows downloading code only when it matches the described
    functionality.
  - Generative-AI features. The generative-content policy expects a way to
    report and filter harmful output.
  - The cloud providers used.

## Not a problem

- The `comfystudio://` scheme is an in-app `protocol.handle` scheme, not an
  OS protocol, so no manifest entry is needed.
- No auto-updater in the code, so nothing fights the Store's updates.
- ffmpeg/ffprobe/RIFE run from the read-only package; nothing writes into
  `resources/`.
- Package size (~180 MB) is well within Store limits.
- Electron fuses and ASAR integrity from the security plan are compatible
  with MSIX.

## Steps to a first test package (when ready)

1. Fix items 1–3 above. Item 2 is manifest only; items 1 and 3 are small
   code changes with tests.
2. Add `build/appx/` assets and an `appx` block (identity values from
   Partner Center, `capabilities: ["runFullTrust"]` is the default), plus
   a custom `build/appx/AppxManifest.xml` override or `customExtensionsPath`
   for the unvirtualized-resources capability.
3. Build locally: `electron-builder --win appx`. For a local sideload test,
   sign with a self-signed cert whose subject matches `publisher`, then
   `Add-AppxPackage`. Run the Windows App Certification Kit (`appcert.exe`).
4. Smoke test inside the package: open/save project, import, export, SFX
   download, ComfyUI connect + custom-node install, RIFE, MCP.
5. Upload the unsigned `.appx` to Partner Center; the Store signs it.

## Implementation status (2026-10-16)

Done in the working tree (uncommitted), ahead of a first test package:

- **Item 1, SFX folder:** `electron/sfxLibraryDir.cjs` probes the install
  folder by creating and deleting a real file. A Store/MSIX package
  (`process.windowsStore`) always uses userData. Tests:
  `tests/sfxLibraryDir.test.cjs`. On this machine `fs.accessSync(W_OK)`
  reports `C:Program Files` as writable; the probe correctly does not.
- **Item 2, virtualization:** `build/appxmanifest.xml` (electron-builder
  `appx.customManifestPath`) disables desktop6
  `FileSystemWriteVirtualization` and `RegistryWriteVirtualization`;
  `appx.capabilities` adds `unvirtualizedResources`; `appx.minVersion` is
  10.0.17763.0, which desktop6 requires. Side effect: the Store build reads and
  writes the real `%APPDATA%Drama Studio`, so it shares settings with the NSIS and
  portable builds. That covers "existing users' data", but settings now
  survive an uninstall.
- **Item 3, RIFE signer:** `verifyPlatformSignature` is unchanged for normal
  builds. With `windowsStore: true` (set from `process.windowsStore`), a
  host whose signer differs from RIFE's (or is unsigned) is accepted only when
  `Get-AppxPackage` reports a package whose install folder holds both
  executables, with `Status` `Ok`, `SignatureKind` Store, Developer or
  Enterprise, and not development mode. The RIFE exe must still have a valid
  Authenticode signature. **Not yet confirmed on a real Store-signed
  install.**
- **Item 4, publisher:** see above. `identityName` and `publisher` are
  `TODO-…` placeholders in `package.json` `build.appx`.
- **Tile assets:** draft `build/appx/` images generated from
  `build/icon.png` (StoreLogo, Square44x44 with taskbar target sizes,
  Square150x150, Wide310x150, SmallTile, LargeTile at scales 100/150/200/400).

`appx` is not in `build.win.target`, so normal Windows builds are unchanged.
Build a Store package with `electron-builder --win appx`. For a local unsigned
test build, use `package.json` as it is: it has no signing options (CI adds
them only for signed releases).

### Local package test (2026-10-16)

- Unsigned `.appx` built: 253.1 MB (177 files). The shipped `AppxManifest.xml`
  has the desktop6 switches, `unvirtualizedResources`, MinVersion 17763 and
  all 34 tile assets. electron-builder's bundled winCodeSign-2.6.0
  `makeappx.exe` is blocked on this machine (`spawn UNKNOWN`); build with
  `ELECTRON_BUILDER_WINDOWS_KITS_PATH` set to the installed SDK
  (`…\Windows Kits\10\bin\10.0.26100.0\x64`).
- Signed a copy with a 30-day self-signed test certificate
  (`CN=TODO-PARTNER-CENTER-PUBLISHER-ID`, CurrentUser\My, not trusted
  machine-wide): `release/msix-test/`.
- Developer Mode registration (`Add-AppxPackage -Register`): Windows accepted
  the manifest, and the app launched from the package. **Virtualization is
  off:** writes went to the real `%APPDATA%\Drama Studio`, and the package store held
  only Windows' own `Settings` files. The MCP server answered, and the app read
  the existing ComfyUI path from the shared settings.
- The RIFE package lookup ran against the real package: `Get-AppxPackage`
  found it from the host path; the Developer Mode registration (SignatureKind
  None, development mode) was correctly rejected.
- Still to do, elevated: trust the test certificate, install the signed package
  into WindowsApps, run WACK (`release/msix-test/run-as-admin.ps1`). RIFE
  itself is not in the local package (the runtime is CI-built), so the
  Store-signed smooth-motion check needs a CI-built package submitted to
  Partner Center (e.g. a private-audience flight).

### Signed sideload + WACK (2026-10-16)

- Test-signed package installed to `C:\Program Files\WindowsApps\…`
  (SignatureKind Developer, Status Ok) via `release/msix-test/run-as-admin.ps1`.
- **WACK overall result: PASS** (23 of 24 tests pass). WACK ran its static
  checks only ("Running tests without application deployment"), so it did
  not test launch time.
- The one failure is optional, **Blocked executables**: string matches for
  `cmd`, `reg`, `bash`, `powershell.exe` and process-launch APIs in
  Electron/Chromium binaries, FFmpeg and `app.asar`. Every Electron app gets
  these; they do not block submission, but expect certification to look at
  the PowerShell/Python launches. Explain them in the submission notes
  (RIFE signature check, ComfyUI/pip launch).
- In the signed package, `Get-AuthenticodeSignature` reports the packaged exes
  as **NotSigned** (the package signature covers them, not a catalog). The RIFE
  package check accepted this install (Developer, Ok, not development mode).
  So **the Store build must keep Azure-signing the RIFE exe**, or the "RIFE
  Authenticode signature is not valid" check disables smooth motion.
- Clean up afterwards: `release/msix-test/run-as-admin.ps1 -Undo` (admin)
  removes the package and the trusted test certificate.
