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

どちらも 8kHz / モノラル / 16bit の wav を `LOCAL_SOUNDS_DIR` に書く。

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

## 音声ファイルの受け渡し

`LOCAL_SOUNDS_DIR` は wav を書き出す場所、`PBX_SOUNDS_DIR` は Asterisk から見た同じ場所の絶対パス。

AGI サーバーと MikoPBX が同じ機械なら、`/storage` のバインドマウント先に直接書けば同期は要らない。

```bash
docker inspect mikopbx --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
mkdir -p /var/spool/mikopbx/storage/usbdisk1/mikopbx/media/custom/bango
```

```
LOCAL_SOUNDS_DIR=/var/spool/mikopbx/storage/usbdisk1/mikopbx/media/custom/bango
PBX_SOUNDS_DIR=/storage/usbdisk1/mikopbx/media/custom/bango
```

書き込みは一時ファイル + rename なので、生成中に着信しても書きかけの wav を再生することはない。

PBX が別の機械のときだけ `SYNC_TARGET` に rsync の転送先を設定する。転送先のディレクトリは先に作っておくこと。

## ダイヤルプラン

MikoPBX の「システム」→「システムファイルのカスタマイズ」→ `extensions.conf`、モードは「ファイルの末尾に追加」で次を足す。既存の記述は消さないこと。

```
[applications]
exten => 104,1,NoOp(--- bango ---)
 same => n,Answer()
 same => n,AGI(agi://<AGI サーバーの IP>:4573/bango)
 same => n,ExecIf($["${BANGO_TARGET}x" == "x"]?Hangup())
 same => n,Goto(all_peers,${BANGO_TARGET},1)
 same => n,Hangup()
```

`Goto` 先は `all_peers`。自局の内線（`internal`）、0 始まりの番号や各種アプリ（`applications`）、他局への発信（`outgoing`）の3つを順に試すのがこのコンテキストだけなので、`outgoing` に直接飛ばすと自局の内線が引けない。

## 設定

環境変数は `.env` から読む（Bun が自動で読み込む）。一覧は `.env.example` を参照。
