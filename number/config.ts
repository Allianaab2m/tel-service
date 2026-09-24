import { Config, Duration } from "effect"

/** 環境変数から読む設定。`.env.example` を参照 */
export const AppConfig = Config.all({
  /** FastAGI の待ち受けポート */
  agiPort: Config.integer("AGI_PORT").pipe(Config.withDefault(4573)),
  /** クロールの起点になる自局の mantela.json の URL */
  rootMantela: Config.string("ROOT_MANTELA").pipe(
    Config.withDefault("https://allianaab2m.github.io/mantela/mantela.json"),
  ),
  /** 自局から何ホップ先まで辿るか */
  crawlDepth: Config.integer("CRAWL_DEPTH").pipe(Config.withDefault(6)),
  /** 再クロールの間隔（例: "1 hour", "30 minutes"） */
  crawlInterval: Config.duration("CRAWL_INTERVAL").pipe(Config.withDefault(Duration.hours(1))),
  /** 音声を生成するローカルのディレクトリ */
  localSoundsDir: Config.string("LOCAL_SOUNDS_DIR").pipe(Config.withDefault("./sounds")),
  /** PBX 上で音声が置かれる絶対パス（STREAM FILE に渡す） */
  pbxSoundsDir: Config.string("PBX_SOUNDS_DIR"),
  /** rsync の転送先（例: root@pbx:/storage/.../bango/）。未設定なら同期しない */
  syncTarget: Config.option(Config.string("SYNC_TARGET")),
})
