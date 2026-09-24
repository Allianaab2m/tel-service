import { Data, Effect, Option } from "effect"
import { Command, FileSystem, Path } from "@effect/platform"
import { createHash } from "node:crypto"
import { AppConfig } from "./config"
import { Tts } from "./tts"

/** 固定のアナウンス文言 */
export const Prompts = {
  intro: "こちらは、番号案内です。",
  enter: "お調べになる番号を押して、最後に、シャープを押してください。",
  noInput: "番号が入力されませんでした。",
  notFoundHead: "お調べの番号、",
  notFoundTail: "は、見つかりませんでした。",
  connect: "おつなぎする場合は、1を押してください。",
  connecting: "おつなぎします。",
  goodbye: "ご利用、ありがとうございました。",
} as const

const DigitWords: Readonly<Record<string, string>> = {
  "0": "ゼロ", "1": "いち", "2": "に", "3": "さん", "4": "よん",
  "5": "ご", "6": "ろく", "7": "なな", "8": "はち", "9": "きゅう",
  "*": "こめじるし", "#": "シャープ",
}

/**
 * 番号を1桁ずつの読みにする。
 * 「6615050番」のまま TTS に渡すと桁読み（ろっぴゃくろくじゅういちまん…）になってしまう
 */
export const spellDigits = (digits: string) =>
  [...digits].map((d) => DigitWords[d] ?? d).join("、")

export class SyncError extends Data.TaggedError("SyncError")<{
  readonly command: string
  readonly exitCode: number
}> {
  override get message() {
    return `${this.command} exited with ${this.exitCode}`
  }
}

/**
 * 文言 → 音声ファイルの対応を管理する。
 * ファイル名は文言のハッシュなので、IVR 側は存在確認せずにパスを組み立てられる。
 */
export class Voice extends Effect.Service<Voice>()("Voice", {
  effect: Effect.gen(function* () {
    const cfg = yield* AppConfig
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const tts = yield* Tts

    // voiceId をハッシュに混ぜるので、エンジンや声を変えると全音声が作り直される
    const hash = (text: string) =>
      createHash("sha1").update(`${tts.voiceId}:${text}`).digest("hex").slice(0, 16)

    /** PBX 上のパス（拡張子なし）。STREAM FILE / GET DATA にそのまま渡す */
    const say = (text: string) => `${cfg.pbxSoundsDir.replace(/\/$/, "")}/${hash(text)}`
    const digit = (d: string) => say(DigitWords[d] ?? d)
    const localFile = (text: string) => path.join(cfg.localSoundsDir, `${hash(text)}.wav`)

    const sync = Option.match(cfg.syncTarget, {
      onNone: () => Effect.void,
      onSome: (target) =>
        Command.make("rsync", "-a", `${cfg.localSoundsDir.replace(/\/$/, "")}/`, target).pipe(
          // rsync の失敗理由はそのまま stderr に出させる
          Command.stderr("inherit"),
          Command.exitCode,
          Effect.flatMap((code) =>
            code === 0
              ? Effect.void
              : Effect.fail(new SyncError({ command: `rsync -a ... ${target}`, exitCode: code })),
          ),
        ),
    })

    /**
     * PBX が同じ場所を直接読む構成でも書きかけを掴ませないよう、
     * 一時ファイルに書いてから rename する（同一ディレクトリなので原子的）
     */
    const write = (text: string, wav: Uint8Array) => {
      const dest = localFile(text)
      const tmp = `${dest}.tmp`
      return fs.writeFile(tmp, wav).pipe(
        Effect.flatMap(() => fs.rename(tmp, dest)),
        Effect.onError(() => Effect.ignore(fs.remove(tmp))),
      )
    }

    /** まだ無い文言だけ合成し、必要なら PBX に同期する */
    const prepare = (texts: Iterable<string>) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(cfg.localSoundsDir, { recursive: true })
        const missing = yield* Effect.filter(new Set(texts), (t) =>
          fs.exists(localFile(t)).pipe(Effect.map((exists) => !exists)),
        )
        if (missing.length === 0) return
        yield* Effect.logInfo(`synthesizing ${missing.length} phrases`)
        yield* Effect.forEach(
          missing,
          (t) =>
            tts.synth(t).pipe(
              Effect.flatMap((wav) => write(t, wav)),
              Effect.catchAllCause((c) => Effect.logWarning(`TTS failed: ${t}`, c)),
            ),
          { concurrency: 2, discard: true },
        )
        yield* sync
      })

    // 起動時に固定文言と数字を用意しておく
    yield* prepare([...Object.values(Prompts), ...Object.values(DigitWords)])

    return { say, digit, prepare } as const
  }),
}) { }
