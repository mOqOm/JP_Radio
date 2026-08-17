# JP RADIO Volumio4 plugin
Japanese radio relay server for Volumio4

> **Alert**: This plugin is only accessible from Japan. Access is restricted from outside Japan.

📖 See the [Wiki](https://github.com/mOqOm/JP_Radio/wiki) for installation instructions and developer information.

## Change log
### version 4.1.1(2026/08/12)
+ 2026/08/12 Fixed station logos preferentially fetching a wide variant (e.g. 688x160), which made the vertical stretch in the albumart display noticeable. Now picks the variant whose aspect ratio is closest to square (largest resolution wins ties)
+ 2026/08/12 Fixed the Time-Free timetable being slow because it queried the server every time it was opened. It now checks the DB cache first and only queries the server for dates not yet cached
+ 2026/08/12 Fixed missing program data on stations (e.g. TBS) that split long programs into hourly blocks sharing the same program ID, which caused DB insert errors. The program ID now includes the broadcast start time to make it unique
+ 2026/08/12 Fixed seeking backward during live playback not switching to catch-up playback, seeking not working during Time-Free playback, and duration sometimes not being set or disappearing (added self-healing against mpd's own polling overwriting the state)
+ 2026/08/13 Fixed today's already-aired programs sometimes not appearing in the timetable (automatic pruning of old program data caused some dates to be skipped by the re-fetch check)
+ 2026/08/13 Fixed duration and track info not being reflected, or being overwritten with stale live info, right after switching from live to catch-up playback
+ 2026/08/13 Fixed the seek bar briefly jumping back to its previous position right after seeking during Time-Free playback
+ 2026/08/13 Fixed the station list shown in the "Area Selection" settings screen not matching what Browse actually displays (local stations only, excluding wide-area stations)
+ 2026/08/14 【Important】Fixed a critical bug where saving an incorrect Radiko account would crash the entire Volumio process (due to an unhandled login-failure exception), causing it to crash again at the same point on every subsequent boot and leaving the settings screen unusable. Login failures are now handled gracefully and playback continues in a not-logged-in state
+ 2026/08/15 Added "全国" (Nationwide) as a selectable area. Nationwide network stations (Radio NIKKEI, NHK FM, etc.) are now opt-in just like any prefecture, instead of always showing unconditionally, so the settings screen matches what Browse displays
+ 2026/08/15 Restored the detailed program description (in addition to the performer info) in the program info modal
+ 2026/08/15 Added the broadcast date to the Time-Free playback screen and the "Favourite Programs (Time-Free)" list. Conversely, removed the now-redundant date from the live playback screen
+ 2026/08/16 Changed the Time-Free timetable order to "time first, then title", and adjusted the performer/station display order for readability
+ 2026/08/16 Fixed Favourite Programs (Time-Free) getting stuck showing "?" as the title for programs outside the timetable's normal display range (too old/far ahead); it now falls back to fetching from the server
+ 2026/08/16 Fixed the management modal opened from a favourited program having no "Play" button, leaving no way to actually play it
+ 2026/08/16 Unified the inconsistent artist display format between live and Time-Free into "Station - [Date]Time (Live/TimeFree)"
+ 2026/08/17 Reverted the performer/station display order in the Time-Free timetable (the 8/16 change actually made it harder to read; the station name is now always shown)
+ 2026/08/17 Stopped opening a dedicated management modal when selecting a favourited program; it now uses the exact same display and playback flow (following the browseMode2 setting) as the regular Time-Free timetable
### version 4.1.0(2026/07/25)
+ 2026/07/25 Grouped the Time-Free timetable by date, with prev-week/prev-day/next-day/next-week navigation and on-air status icons (★on air/⬜︎not yet aired/▷playable)
+ 2026/07/25 Added a "Time-Free (Today)" shortcut
+ 2026/07/25 Added Favourites support (live stations, Time-Free stations, and individual Time-Free programs)
+ 2026/07/25 Added local caching of station logos, and made the album art source (station banner / station logo / program image) configurable
+ 2026/07/25 Made the date/time display format on the playback screen and timetable configurable
+ 2026/07/25 Made the live streaming network delay compensation adjustable from the settings screen
+ 2026/07/25 Added seek support during Time-Free playback
+ 2026/07/25 Added "Go to Artist"/"Go to Album" navigation from the playback screen to the timetable
+ 2026/07/25 Added a developer debug page (`/radiko/dev/`)
+ 2026/07/25 Ported Time-Free listening, Favourites, and live playback Seek display from version 3.1.0/3.0.2 (provided by [**@hirokun0413**](https://github.com/hirokun0413)) to the Volumio4 line
+ 2026/07/25 Added station name search support from Volumio's search screen
+ 2026/07/25 Added full metadata (including personality name) when adding tracks to Favourites/playlists
+ 2026/07/25 Added icons and a grid-view toggle to the root menu
+ 2026/07/25 Added program duration display to the timetable
+ 2026/07/25 Fixed station name/time range/personality info disappearing after a few seconds during Time-Free playback
+ 2026/07/25 Added a button to manually clear the station logo cache in settings
+ 2026/07/25 Fixed the play queue to be properly cleared on plugin stop/uninstall and on Volumio system shutdown/reboot
+ 2026/07/25 Made Browse mode, Time-Free playback speed, album art source, timetable display settings, and network delay compensation apply immediately without requiring a restart
+ 2026/07/25 Added automatic switch to catch-up playback of the currently airing program when seeking backward during live playback
+ 2026/07/25 Added the ability to re-register a Favourited Time-Free program for the same time slot on a different week
+ 2026/07/28 Fixed FM802 not appearing in the station list for non-premium users: its station ID was inconsistently formatted (`FM802` vs `802`) between the full station data feed and the per-area feed, causing area matching to fail ([Issue #21](https://github.com/mOqOm/JP_Radio/issues/21))
+ 2026/07/28 Fixed the timetable showing "No items" for dates more than 7 days in the past when the "Program period (past)" setting is 8 days or more, since the weekly program API only covers about ±1 week
+ 2026/07/28 Fixed the "Area Selection" setting (for AreaFree members) not being applied to the live station list, Time-Free station list, or search results — all areas' stations were always shown regardless of the selection
+ 2026/07/29 Fixed the "Area Selection" setting not applying at all for non-AreaFree members (e.g. the Free plan). It now restricts the live/time-free station lists and search results to the selected area(s) plus nationwide network stations (e.g. NHK Radio), regardless of membership type
+ 2026/07/29 Made changes to the "Area Selection" setting apply immediately without requiring a restart
+ 2026/07/29 When one or more areas are selected, program listing fetches are now also scoped to just those areas (plus nationwide network stations), regardless of membership type, reducing unnecessary fetching
+ 2026/07/29 Fixed an issue where, when not logged in (station list restricted to your own area only), selecting other areas in "Area Selection" would hide even your own area's stations from the list and program fetches. Your own area is now always included only when not logged in; once logged in, the list strictly follows the selected area(s) regardless of membership type
### version 4.0.1(2026/07/24)
+ 2026/07/24 Adapted to Radiko's 2026 streaming API changes, fixing live playback.
+ 2026/07/24 Fixed missing program guide data for neighboring-area stations (BAYFM78/NACK5/YFM/IBS, etc.) on non-AreaFree accounts.
+ 2026/07/24 Fixed a crash on plugin restart.
+ 2026/07/24 Fixed the album art (icon) not displaying.
+ 2026/07/24 Fixed the settings screen (UIConfig) not displaying.
+ 2026/07/24 Fixed time handling to always use JST, regardless of the device's system timezone.
+ 2026/07/24 Verified compatibility with Node.js v20.5.1 / Volumio (bookworm).
+ 2026/07/24 Reorganized internal structure into controllers/services/logic/utils, and added ESLint and Jest-based tests.
### version 4.0.0(2025/06/01)
+ 2025/06/01 Fixed to support Volumio4.
### version 3.1.0
- This version was provided by [**@hirokun0413**](https://github.com/hirokun0413).
### version 3.0.2
- This version was provided by [**@hirokun0413**](https://github.com/hirokun0413).
### version 0.1.3(2025/05/30)
+ 2025/05/30 Modified to display by region
### version 0.1.2(2025/05/29)
+ 2025/05/29 Fixed a bug that prevents viewing on Radiko Premium.
### version 0.1.1(2025/05/22)
+ 2025/05/26 Changed to display a popup window on startup (tentative)
### version 0.1.0(2025/05/22)
+ 2025/05/22 Transitioned to TypeScript
### version 0.0.6(2025/05/17)
+ 2025/05/17 Emergency 2 response to bug that prevents listening to Radiko
### version 0.0.5(2025/05/17)
+ 2025/05/17 Emergency response to bug that prevents listening to Radiko
### version 0.0.4(2025/02/13)
+ Bug fix for not being able to play FM802.
### version 0.0.3(2024/03/16)
+ Change to display a popup for prompting restart.
+ Change to allow the user to specify the startup port.
### version 0.0.2(2023/11/04)
+ Bug fix for not starting correctly on plugin restart
### version 0.0.1(2023/11/02)
+ Initial Version

## Acknowledgments
+ [NanoPi NEOにインストールしたMPDでradikoを聞く](http://burro.hatenablog.com/entry/2019/02/16/175836)
+ [Github for Streaming server for relaying "radiko" radio stream to Music Player Daemon (MPD)](https://github.com/burrocargado/RadioRelayServer)
+ [Trunkene/volumio_jpradio: Japanese radio relay server for Volumio](https://github.com/Trunkene/volumio_jpradio)

## Contributors
Thanks to everyone who has contributed to the development and improvement of this plugin.

| Name | Contribution |
|--------------|----------------------|
| [**@mOqOm**](https://github.com/mOqOm) | Main development / TypeScript migration / Volumio4 support |
| [**@Trunkene**](https://github.com/Trunkene) | Original project author (volumio_jpradio) |
| [**@burrocargado**](https://github.com/burrocargado) | Provided RadioRelayServer (Radiko relay server) |
| [**@hirokun0413**](https://github.com/hirokun0413) | Main development / Time-Free listening / Favourites / Seek display during live playback |

> Contributions via Pull Requests or Issues are also welcome!
> Feel free to submit new feature proposals or improvement reports to [Issues](../../issues).
