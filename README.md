# JP RADIO Volumio3 plugin
Japanese radio relay server for Volumio3

> **注意**: このプラグインは日本からのみアクセス可能です。日本国外からのアクセスは制限されています。

## 📜 変更履歴

### version 3.1.4 (2026/08/23)
- AuthTokenの期限切れ対策（RadikoAuthLogicのクラス化）
- 遅延時間のデフォルト値を100秒に変更
- 各種表示をできるだけv4.1.1に揃えた
- 英語表記の整備
- このバージョンは [**@hirokun0413**](https://github.com/hirokun0413) 様によりご提供いただきました。

### version 3.1.3 (2026/06/24)
- Radiko仕様変更(2026/06)でライブが再生できなくなった問題に対応
- タイムフリー時の倍速再生（0.5～2.0；※早聞き時は音飛びしがち）
- タイムフリー停止後に再度再生ボタンを押した場合、続きを再生
- ブラウズ画面での番組選択時の動作(再生 or 番組情報を開く)を設定
- このバージョンは [**@hirokun0413**](https://github.com/hirokun0413) 様によりご提供いただきました。

### version 3.1.2 (2026/02/18)
- ffmpegヘッダーに'X-Radiko-AreaId'を追加
- メインのREADMEを日本語に変更
- このバージョンは [**@hirokun0413**](https://github.com/hirokun0413) 様によりご提供いただきました。

### version 3.1.1 (2026/02/05)
- Radiko仕様変更(2026/01)でタイムフリーが再生できなくなった問題に対応、他
- このバージョンは [**@hirokun0413**](https://github.com/hirokun0413) 様によりご提供いただきました。

### version 3.1.0 (2025/09/15)
- タイムフリー・お気に入り対応、他
- このバージョンは [**@hirokun0413**](https://github.com/hirokun0413) 様によりご提供いただきました。

### version 3.0.2 (2025/07/05)
- 番組の切替わりで再生画面を更新するように変更、他
- このバージョンは [**@hirokun0413**](https://github.com/hirokun0413) 様によりご提供いただきました。

### ~~version 4.0.0 (2025/06/01)~~
- ~~Volumio 4 に対応するように修正~~

### version 0.1.3(2025/05/30)
- 2025/05/30 地域毎に表示するように修正

### version 0.1.2(2025/05/29)
- 2025/05/29 Radikoプレミアムで視聴できないバグ修正

### version 0.1.1(2025/05/22)
- 2025/05/26 起動時にポップアップ表示するように変更(暫定対応)

### version 0.1.0(2025/05/22)
- 2025/05/22 TypeScriptへ移行

### version 0.0.6(2025/05/17)
- 2025/05/17 Radiko聴くことができないバグのため緊急対応(2)

### version 0.0.5(2025/05/17)
- 2025/05/17 Radiko聴くことができないバグのため緊急対応

### version 0.0.4(2025/02/13)
- FM802が再生できないバグの修正

### version 0.0.3(2024/03/16)
- 再起動を促す表示をポップアップで表示するように変更
- 起動ポートをユーザ側で指定できるように変更

### version 0.0.2(2023/11/04)
- プラグインの再起動時に正しく起動できないバグ修正

### version 0.0.1(2023/11/02)
- 初期バージョン

---

## 🙏 Acknowledgments

- [NanoPi NEOにインストールしたMPDでradikoを聞く](http://burro.hatenablog.com/entry/2019/02/16/175836)
- [Streaming server for relaying "radiko" radio stream to MPD](https://github.com/burrocargado/RadioRelayServer)
- [Trunkene/volumio_jpradio](https://github.com/Trunkene/volumio_jpradio)

---

## 👥 Contributors

このプラグインの開発・改善にご協力いただいた皆さまに感謝します。

| 名前 / Name | 役割 / Contribution |
|--------------|----------------------|
| [**@mOqOm**](https://github.com/mOqOm) | メイン開発 / TypeScript移行 / Volumio4対応 |
| [**@Trunkene**](https://github.com/Trunkene) | 元プロジェクト作成者（volumio_jpradio） |
| [**@burrocargado**](https://github.com/burrocargado) | RadioRelayServer（Radiko中継サーバー）提供 |
| [**@hirokun0413**](https://github.com/hirokun0413) | メイン開発 / タイムフリー視聴 / お気に入り登録 / ライブ再生時のSeek表示対応 |

> Pull Request や Issue を通じての貢献も歓迎します！  
> 新しい機能提案や改善報告はぜひ [Issues](../../issues) へ。

---

## 🧩 ライセンス
このプラグインはオープンソースとして公開されています。  
ライセンス情報については `LICENSE` ファイルをご確認ください。
