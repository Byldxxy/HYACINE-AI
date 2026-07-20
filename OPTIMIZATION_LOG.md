# HYACINE-AI Optimization Log

This log tracks the engineering-hardening work started after `v1.1.0`.
Each step records its motivation, implementation boundary, verification, and any remaining risk so a fork can reconstruct why the change was made.

## Baseline

- Baseline release: `v1.1.0` (`2601cba`)
- Started: 2026-07-20
- Scope: engineering optimization only; new product features such as TTS are intentionally deferred
- Local note: the detailed maintainability comments added after `v1.1.0` remain part of this worktree

## Progress

| Step | Work item | Status |
| --- | --- | --- |
| 1 | Windows/Electron installer and production startup | Completed |
| 2 | Desktop reply length and sentence-safe output | Completed |
| 3 | Config/memory validation, migration, and atomic persistence | Completed |
| 4 | Image download SSRF and redirect protection | Completed |
| 5 | Remove abandoned paths and stale defaults | Completed |
| 6 | Cross-platform CI, integration tests, and diagnostics | Completed |

## Step 1 - Windows/Electron Installer

### Problem

- `package.json` points Electron packaging at `server.js` instead of `electron/main.js`.
- Development scripts use POSIX shell syntax and do not run directly in Windows PowerShell/cmd.
- Production Electron loads `dist/pet.html` through `file://`, while built assets and model URLs use HTTP-root paths.
- Runtime JSON paths are not mapped to Electron's per-user writable directory.
- Electron starts the window after a fixed delay instead of waiting for the backend to listen.

### Implemented

- Added Electron Builder `pack:dir` and `dist:win` commands with an NSIS x64 target.
- Replaced POSIX-only desktop scripts with `scripts/dev-pet.js` and a cross-platform Electron command.
- Added `lib/parent-ipc.js` so the standalone backend supports both Electron utility-process IPC and legacy Node fork IPC.
- Electron now waits for an explicit `server-ready` message, restarts an unexpected backend exit with bounded backoff, and prevents duplicate application instances.
- Production pages and public resources are served through the local backend instead of `file://`.
- Packaged Electron passes a per-user writable `HYACINE_DATA_DIR`; source development keeps using the project's existing `data/` directory.
- Vite production builds no longer copy the whole ignored `public/` tree. Electron Builder copies only an explicit resource allowlist.
- `.env`, `data/`, `models_fengjin/`, personal presets, model files, and motion files were absent from the generated package audit.

### Verification

- `npm run lint`: passed.
- `npm test`: 25/25 passed at this step.
- `npm run build`: passed.
- `npm run pack:dir`: generated a macOS directory package.
- Isolated Electron source smoke test: backend listened on `127.0.0.1:3102`; `/pet.html` returned 200 and `/api/desktop-pet` reported `available: true`.
- `npm run dist:win`: generated `release/HYACINE-AI-Setup-1.1.0-x64.exe` (about 99 MB).
- Windows unpacked-resource audit found only Ammo, `character.png`, `tray_icon.png`, and the manifest example outside ASAR; no model, motion, API, preset, or runtime-data files were present.

### Remaining risk

- The generated Windows installer is unsigned and will trigger SmartScreen until a code-signing certificate is configured.
- The NSIS artifact was built successfully on macOS but still requires installation and runtime smoke testing on a real Windows machine.
- A dedicated application `.ico` has not been added, so Electron Builder currently uses its default icon.

### 2026-07-20 Development Data-path Regression

- Symptom: after restarting `npm run dev:pet`, the WebUI showed empty configuration and presets even though the project data files still existed.
- Cause: the first installer-path implementation sent development Electron to `~/Library/Application Support/Electron/data/`; the cross-root migration only checked the new root and therefore loaded an empty file.
- Recovery: no original data was deleted or overwritten. Source-mode Electron now reads the project `data/` again; only packaged builds (or explicit test overrides) use `userData`.
- Regression coverage: added path-selection assertions for source mode, packaged mode, and isolated test mode.

## Step 2 - Desktop Reply Length

### Problem

- The WebUI exposes a model Token budget, but `lib/desktop-awareness.js` separately truncates every reply to 180 characters.
- `src/pet/PetScene.jsx` applies another 180-character slice before rendering the bubble.
- Raw character slicing can cut a grammatically complete model response in the middle of a sentence.

### Implemented

- Added `desktopAwarenessMaxReplyLength`, defaulting to 300 characters and clamped to 80-800.
- Added a WebUI range control independent from the provider Token budget.
- Added `truncateDesktopReply`: it keeps a sentence ending before the limit, looks ahead briefly for a natural ending, and uses an ellipsis only as a final bounded fallback.
- Structured JSON, legacy malformed JSON, content-part arrays, and direct text replies now use the same length policy.
- Raised the renderer-only safety cap to 1000 characters and expanded dynamic bubble headroom to 500 px with overflow fallback.
- Follow-up: removed the bubble's internal max-height/scrollbar and explicitly kept overflow visible; the measured bubble height now drives the Electron window directly.

### Verification

- Desktop-awareness tests: 9/9 passed, including sentence-boundary and clamp coverage.
- `npm run lint`: passed.
- `git diff --check`: passed.

## Step 3 - Safe Configuration And Memory Persistence

### Problem

- Config, sessions, summaries, and persistent facts are written directly to their final JSON paths.
- A crash or overlapping write can leave a truncated file.
- REST inputs and files loaded from disk do not share a schema or versioned migration boundary.

### Implemented

- Added `lib/json-store.js` with per-file write queues, temporary-file flush, atomic replacement, and `.bak` recovery.
- The write queue snapshots values at enqueue time so later in-memory mutation cannot change a pending payload.
- Added Zod schemas for bot configuration, sessions, summaries, and persistent facts.
- Added `configVersion: 1`; unknown fields remain allowed for forward-compatible forks.
- Legacy numeric QQ/port identifiers are normalized to strings, and non-object config snapshots are rejected.
- Config and memory managers validate both disk input and API-triggered writes.
- Invalid config, session, summary, or persistent-memory management requests now return HTTP 400 with field-level details.
- Existing local config, sessions, and summaries were schema-checked without printing their contents; all passed.

### Verification

- Persistence tests: 4/4 passed, covering schema errors, serialized writes, backup retention, corrupt-file recovery, and masked-key behavior.
- `npm run lint`: passed.
- `git diff --check`: passed.

### Remaining risk

- API keys entered through the WebUI remain plaintext in `bot-config.json`; `.env` remains the recommended secret source. Electron `safeStorage` needs a separate cross-process design because the backend must also run without Electron.

## Step 4 - Image Download Network Boundary

### Problem

- OneBot image URLs are downloaded with redirects enabled.
- An attacker-controlled URL could target loopback, private-network services, link-local metadata endpoints, or redirect from a public hostname to one of those targets.

### Implemented

- Added explicit HTTP/HTTPS URL parsing and rejected embedded credentials and local hostnames.
- Added DNS resolution checks for IPv4/IPv6 loopback, private, carrier-grade NAT, link-local, multicast, documentation, and reserved ranges.
- Replaced automatic redirects with at most three manually followed hops; every target is resolved and validated again before request.
- Preserved the existing 3-image, 6 MB, MIME, response-size, and 15-second total timeout controls.

### Verification

- Vision tests: 8/8 passed, including private IP, private DNS result, localhost, and public-to-metadata redirect rejection.
- `npm run lint`: passed.
- `git diff --check`: passed.

### Remaining risk

- DNS is validated immediately before fetch, but the default fetch implementation performs its own resolution. A hostile authoritative DNS server could theoretically attempt rebinding between those operations. Pinning the validated address requires a custom HTTP dispatcher and should be considered before accepting image URLs from sources other than trusted OneBot adapters.

## Step 5 - Abandoned Paths And Stale Defaults

### Problem

- `/img` and `/draw` remain implemented and documented even though the direct-generation path was abandoned.
- `personaTags` is an unused legacy field.
- New installations contain a project-specific API endpoint and model names instead of neutral empty values.
- README still documents POSIX-only desktop commands and an outdated Node requirement.
- The test-chat route duplicates prompt/model logic and can drift from real chat behavior.

### Implemented

- Removed the `/img` and `/draw` direct-generation branch and its README claim; normal LLM-directed image generation remains.
- Removed `personaTags` from new defaults and migration-normalized it out of existing config snapshots.
- New WebUI installations now start with empty text endpoint, text model, and image model fields.
- Image generation now requires an explicitly configured endpoint and model instead of silently using a project-specific provider.
- Added `lib/chat-completion.js`; real OneBot chat and WebUI test chat now share identity prompts, response/image instructions, memory assembly, vision attachment, provider construction, and completion options.
- Updated Node requirements, desktop commands, installer commands, and packaging-boundary documentation.
- Added neutral package description/author metadata and a Node `>=22.12.0` engine declaration.

### Verification

- Shared chat/image-generation tests: 6/6 passed.
- Repository search found no remaining `/img`, `/draw`, provider-specific endpoint, provider-specific model default, or active `personaTags` usage (the migration deletion remains intentionally).
- `npm run lint`: passed.
- `git diff --check`: passed.

## Step 6 - Cross-platform CI, Integration Tests, And Diagnostics

### Problem

- Unit tests do not prove that the Express server starts with an isolated data directory or that management APIs reject invalid input.
- No repository CI runs the project on Windows.
- Electron startup failures and packaging-boundary regressions are difficult for testers to report consistently.

### Implemented

- Added a GitHub Actions matrix for Node 22.12 on Ubuntu, macOS, and Windows: clean install, lint, tests, production build, and release-boundary audit.
- Added an on-demand Windows NSIS build job with installer artifact upload.
- Added a real backend-process integration test using an isolated port and data directory. It verifies Electron-unavailable fallback, config validation, memory validation, and diagnostics redaction.
- Added `scripts/check-release-boundary.js` to reject tracked runtime/private resources and sensitive Vite build output.
- Added `/api/diagnostics` and a WebUI “导出诊断” action. Reports contain platform/status/count metadata but never endpoint values, keys, model names, prompts, window titles, chat messages, summaries, or facts.
- Added graceful SIGINT/SIGTERM backend shutdown and made asynchronous memory writes observable instead of silently swallowing disk errors.
- The cross-platform launcher strips inherited `ELECTRON_RUN_AS_NODE` so automation environments cannot accidentally start Electron as plain Node.
- Removed the unmaintained `pkg` tool and applied non-forced dependency security updates. Full npm audit now reports zero vulnerabilities.

### Verification

- Full test suite: 38 tests discovered; 37 passed in the restricted sandbox and the loopback integration test was explicitly skipped there.
- The same loopback integration test passed separately in the host network environment.
- `npm run lint`: passed.
- `npm run build`: passed with only the existing large pet-chunk warning.
- `npm run check:release`: passed.
- GitHub Actions YAML parsed successfully.
- `npm audit`: zero known vulnerabilities after the lockfile update.
- Final `npm run dist:win`: generated `release/HYACINE-AI-Setup-1.1.0-x64.exe` (about 100 MB).
- Final ASAR/public audit found no `.env`, runtime data, API configuration, personal preset, model, motion, or `pkg` content.

## Final State

All six engineering optimization steps are complete in the local worktree. The Windows installer is intentionally unsigned and the ignored `release/` artifact is not committed. Real Windows installation/runtime testing and code signing remain release-gate tasks rather than source implementation tasks.

## Release 1.2.0

- Added `USER_GUIDE.md`, a zero-experience walkthrough for GitHub checkout, dependency installation, local configuration, source-mode testing, NapCat setup, Windows NSIS packaging, troubleshooting, updates, and release privacy checks.
- Linked the guide from README and documented the exact `release/HYACINE-AI-Setup-1.2.0-x64.exe` output expected from `npm run dist:win`.
- Release scope includes the six completed optimization steps above and the development Electron data-path regression fix.
- Before publishing, the release must pass lint, tests, production build, release-boundary audit, tracked-file review, and ignored private-resource checks.
