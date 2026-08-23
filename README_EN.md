# JP RADIO Volumio3 plugin
Japanese radio relay server for Volumio3

> **Alert**: This plugin is only accessible from Japan. Access is restricted from outside Japan.

## Change log

### version 3.1.4 (2026/08/23)
- Handling AuthToken Expiration (Refactoring RadikoAuthLogic into a Class)
- Changed the default delay time to 100 seconds.
- Aligned various displays with v4.1.1 as much as possible.
- Standardization of English notation.
- This version was provided by [**@hirokun0413**](https://github.com/hirokun0413).

### version 3.1.3 (2026/06/24)
- Addresses an issue where Live playback became unavailable due to a Radiko specification change (June 2026).
- Variable-speed playback (0.5x–2.0x) for Time-Free.
- If you press the play button again after stopping the time-free playback, playback will resume from where it left off.
- Configure the action taken when selecting a program on the browse screen (playback or opening program information).
- This version was provided by [**@hirokun0413**](https://github.com/hirokun0413).

### version 3.1.2 (2026/02/18)
- Added 'X-Radiko-AreaId' to the ffmpeg header.
- Changed the main README to Japanese.
- This version was provided by [**@hirokun0413**](https://github.com/hirokun0413).

### version 3.1.1 (2026/02/05)
- Addresses an issue where Time-Free playback became unavailable due to a Radiko specification change (January 2026), among other issues.
- This version was provided by [**@hirokun0413**](https://github.com/hirokun0413).

### version 3.1.0 (2025/09/15)
- Time-Free, favorites, and more.
- This version was provided by [**@hirokun0413**](https://github.com/hirokun0413).

### version 3.0.2 (2025/07/05)
- Updated the playback screen to update when programs change, etc.
- This version was provided by [**@hirokun0413**](https://github.com/hirokun0413).

### ~~version 4.0.0(2025/06/01)~~
+ ~~2025/06/01 Fixed to support Volumio4.~~

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
* Bug fix for not being able to play FM802.

### version 0.0.3(2024/03/16)
* Change to display a popup for prompting restart.
* Change to allow the user to specify the startup port.

### version 0.0.2(2023/11/04)
* Bug fix for not starting correctly on plugin restart

### version 0.0.1(2023/11/02)
* Initial Version

## Acknowledgments
* [NanoPi NEOにインストールしたMPDでradikoを聞く](http://burro.hatenablog.com/entry/2019/02/16/175836)
* [Github for Streaming server for relaying "radiko" radio stream to Music Player Daemon (MPD)](https://github.com/burrocargado/RadioRelayServer)
* [Trunkene/volumio_jpradio: Japanese radio relay server for Volumio](https://github.com/Trunkene/volumio_jpradio)