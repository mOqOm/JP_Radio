# Volumio Plugin Review Checklist

Last reviewed: 2026/07/25 (against source, not a running device — see Notes for what still needs manual verification)

## GENERAL

| Check | Expected Result | PASS | Notes |
| --- | --- | --- | --- |
| Does the plugin have a coherent name? | The plugin must be self-explanatory in its name, like "Simple Equalizer" | ✅ | `prettyName: "JP Radio"` in package.json |
| Is the plugin archive less than 10 MB? | The plugin archive must be less than 10 MB | ❓ | Can't measure without `npm install`/build in this environment. Removing unused deps (see RESILIENCY notes) should help; ask a build machine to run `du -sh` on the packaged output before submitting. |
| Does the plugin have a full english translation? | Plugin shall have a full english translation. | ✅ | Fixed: added `browse_texts.en.ini` / `log_messages.en.ini` / `push_messages.en.ini` (same keys as the `.ja.ini` files, verified via diff). |
| Does the plugin have additional translations? If yes, changing the language of system, does the plugin change its language? | Plugin shall automatically switch to a different language | ✅ | Fixed: `MessageCatalog` now loads English as a base layer and overlays the actual `language_code` on top (falls back to English for any untranslated key). `onVolumioStart()` reads `commandRouter.sharedVars.get('language_code')` and calls `messageCatalog.setLanguage(...)` before anything else runs. Needs a live check with the system language set to English to confirm end-to-end. |
| Once the plugin is installed, is the available plugin list visible? | Yes. Otherwise the plugin has a non-compliant package.json | ✅ | `volumio_info` block present and looks well-formed. |

## LIFECYCLE

| Check | Expected Result | PASS | Notes |
| --- | --- | --- | --- |
| Does the plugin start when clicking start, does the indicator become green? | Indicator becomes green, plugins start well | ❓ | Needs a live device check; structurally `onStart` resolves/rejects correctly for the async path. |
| Create a typo in a function call on the onStart function. Does the system crash? | System does not crash | ✅ | Fixed: the synchronous setup in `onStart()` (config reads + `new JpRadio(...)`) is now wrapped in `try/catch`, which logs, shows an error toast, and rejects the defer instead of throwing uncaught. |
| Does the plugin stop correctly when stopped? Are its functionalities disabled? | All plugins functionalities shall stop if plugin is set to stopped | ✅ | `onStop()` stops the internal server/cron tasks, clears the plugin's own queue items, and removes the browse source. Also now wired to `onVolumioShutdown`/`onVolumioReboot`. |
| Does the plugin require some configuration before being started? | Plugin shall not need any configuration to be started and have sane defaults as configuration | ✅ | `config.json` ships with sane defaults (empty Radiko credentials fall back to non-premium mode via `createLoginAccount`, port 9000, etc.). |
| If the plugin needs to start a daemon, does it do via systemctl? | Yes, all daemons shall be started via systemctl, not via exec or execSync | ✅ | No persistent daemon is installed; `ffmpeg` is spawned per-stream via `child_process.spawn` (transient, not a managed daemon) and is expected to already be present on the Volumio image. |

## INSTALL

| Check | Expected Result | PASS | Notes |
| --- | --- | --- | --- |
| Does the plugin need to build modules or other components? | No, plugin shall not compile anything on user device | ✅ | All dependencies are pure JS/TS; none require native compilation. |
| Does the plugin need to write, edit or create folders on /volumio /myvolumio folders? | No, plugin does not need to modify any of those files | ✅ | Confirmed by reading `install.sh`/`uninstall.sh` — neither touches paths outside the plugin's own folder. |
| Does the plugin re-install or overwrite utilities, configuration files or daemons already present? | No, plugin does not need to modify any of those files | ✅ | |
| Does the plugin install libraries or anything similar (e.g. in /usr/local/lib)? | These files should remain in the plugin folder and only be symlinked to the system path (`ln -sf ...`) and not copied or moved. | ✅ | N/A — no libraries installed outside the plugin folder. |
| Does the plugin delete its plugin folder on a failed install? | Yes. If installation failed there should be a cleanup to not show a broken plugin. | N/A | `install.sh` is trivial (2 echo lines) and cannot meaningfully fail; cleanup-on-failure is the plugin manager's responsibility here. |
| Does the plugin install.sh end with `echo "plugininstallend"`? | Yes, this way the installer knows installation is finished | ✅ | Confirmed last line of `install.sh`. |
| Does the installer script fetch external libraries/archives? If yes, is the URL hardcoded or dynamic? | The package/library URL shall be hardcoded and point to the same version. Pointing to /latest version or parsing of URL is not allowed | ✅ | N/A — `install.sh` fetches nothing. |

## RESILIENCY

| Check | Expected Result | PASS | Notes |
| --- | --- | --- | --- |
| Does the plugin use sync calls? If yes, are all of them properly handled by try/catch? | The sync functions shall always be wrapped in try/catch | ✅ | Fixed: `message-catalog.ts`'s `ini.parse(fs.readFileSync(...))` calls are now wrapped in `try/catch` per catalog file, logging and skipping instead of throwing. `fs.existsSync` calls elsewhere (`radiko-service.ts`) were already safe (never throw). |
| *(extra, not in original checklist)* Unused dependencies | Dependencies should only include what's actually imported | ✅ | Fixed: removed `lodash`, `capitalize`, `icy-metadata` (and its now-unused `.d.ts` ambient declaration), and `date-utils` (and its stray `import 'date-utils'` in `radiko-service.ts`) from `package.json`/source — none were actually used anywhere in `src/`. |

## MUSIC SERVICE

*(Applicable only if it's a music service plugin)*

| Check | Expected Result | PASS | Notes |
| --- | --- | --- | --- |
| Search any string, like Paolo or Pink or BBC. Do search results appear? | Yes, otherwise your plugin is breaking search. | ❓ | `search()` now returns `[]` gracefully for non-matching queries (doesn't error out Volumio's aggregate search), but needs a live check that it doesn't throw for arbitrary unrelated search terms. |
| Search any string that you know your plugin will return a result. Do results from your plugin appear? | Yes, otherwise your plugin is not returning search results correctly. | ✅ (by design) | `searchStations()` matches station name/ascii name; implemented and reviewed this session, needs a live confirmation. |
| If plugin exposes a source, is the source icon white on transparent background? | Yes. Otherwise have a look at the other volumio icons and provide a 500px x 500px transparent PNG as icon | ⚠️ | `assets/images/app_radiko.svg` is 800×800 (comfortably over the 500px minimum) and fills are white, but every path also has `stroke="#000000"` (a black outline). Other Volumio source icons are typically a pure single-color silhouette with no contrasting stroke — recommend removing the `stroke`/`stroke-miterlimit` attributes for a cleaner match. |

## INTERACTION

| Check | Expected Result | PASS | Notes |
| --- | --- | --- | --- |
| Does this plugin work with convenience switching? (Play a file, then a radio, then Spotify Connect, does it work?) | Yes, Volumio switches sources without problems (no audio-device busy error) | ❓ | All playback is delegated to mpd (no direct audio device handling in this plugin), so this should behave like any other mpd-backed source — needs a live device check. |
| Does the plugin impact audio playback? (Applicable mainly to plugins using AAMPP) | No, playback does not stutter, distort or exhibit poor performance when plugin is enabled | N/A | Not an AAMPP-based plugin. |
