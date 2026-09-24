# number

東京広域電話網向けの番号案内サービス（FastAGI サーバー）。

## セットアップ

```bash
bun install
cp .env.example .env   # 編集する
```

## 起動

```bash
bun run index.ts
```

網の全体像とダイヤル番号を確認する:

```bash
bun run crawl.ts > index.json
```

## 音声合成

`TTS_ENGINE` で合成エンジンを選ぶ。既定は `openjtalk`。

| 値 | 説明 |
| --- | --- |
| `openjtalk` | `open_jtalk` + `sox` をローカルで実行する。軽いので Raspberry Pi 向け |
| `voicevox`  | VOICEVOX エンジンの HTTP API を叩く |

どちらも 8kHz / モノラル / 16bit の wav を `LOCAL_SOUNDS_DIR` に書き、`SYNC_TARGET` があれば rsync で PBX に送る。

ファイル名は `<エンジン識別子>:<文言>` のハッシュなので、`TTS_ENGINE` や声を変えると全音声が作り直される。

### Open JTalk

```
OPENJTALK_DIC=/var/lib/mecab/dic/open-jtalk/naist-jdic
OPENJTALK_VOICE=/usr/share/hts-voice/nitech-jp-atr503-m001/nitech_jp_atr503_m001.htsvoice
```

Raspberry Pi へのインストール:

```bash
sudo apt install open-jtalk open-jtalk-mecab-naist-jdic hts-voice-nitech-jp-atr503-m001 sox
```

`open_jtalk` の `-s` でサンプリングレートだけを変えると話速と声の高さが崩れるので、
一度既定のレートで書き出してから `sox` で 8kHz に変換している。

### VOICEVOX

```
VOICEVOX_URL=http://localhost:50021
VOICEVOX_SPEAKER=3
```

## 設定

環境変数は `.env` から読む（Bun が自動で読み込む）。一覧は `.env.example` を参照。
