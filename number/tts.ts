import { Config, type ConfigError, Context, Data, Effect, Layer } from "effect"
import {
  Command,
  CommandExecutor,
  FileSystem,
  HttpClient,
  HttpClientRequest,
  Path,
} from "@effect/platform"

export class TtsError extends Data.TaggedError("TtsError")<{ readonly cause: unknown }> { }

/** 音声合成エンジン。実装は VOICEVOX と Open JTalk の 2 つ */
export class Tts extends Context.Tag("Tts")<Tts, {
  /** 音声ファイルのハッシュに混ぜる識別子（エンジン名＋声）。変わると全音声が再生成される */
  readonly voiceId: string
  /** 文言 → 8kHz / モノラル / 16bit PCM の wav */
  readonly synth: (text: string) => Effect.Effect<Uint8Array, TtsError>
}>() { }

class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly command: string
  readonly exitCode: number
}> { }

export const VoicevoxLive = Layer.effect(
  Tts,
  Effect.gen(function* () {
    const url = yield* Config.string("VOICEVOX_URL").pipe(
      Config.withDefault("http://localhost:50021"),
    )
    const speaker = yield* Config.integer("VOICEVOX_SPEAKER").pipe(Config.withDefault(3))
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

    const synth = (text: string) =>
      Effect.gen(function* () {
        const query = yield* HttpClientRequest.post(`${url}/audio_query`).pipe(
          HttpClientRequest.setUrlParams({ text, speaker: String(speaker) }),
          (req) => client.execute(req),
          Effect.flatMap((res) => res.json),
        )
        const wav = yield* HttpClientRequest.post(`${url}/synthesis`).pipe(
          HttpClientRequest.setUrlParam("speaker", String(speaker)),
          // Asterisk がそのまま再生できる 8kHz モノラルで出力させる
          HttpClientRequest.bodyUnsafeJson({
            ...(query as object),
            outputSamplingRate: 8000,
            outputStereo: false,
          }),
          (req) => client.execute(req),
          Effect.flatMap((res) => res.arrayBuffer),
        )
        return new Uint8Array(wav)
      }).pipe(Effect.mapError((cause) => new TtsError({ cause })))

    return { voiceId: `voicevox:${speaker}`, synth } as const
  }),
)

export const OpenJTalkLive = Layer.effect(
  Tts,
  Effect.gen(function* () {
    const dic = yield* Config.string("OPENJTALK_DIC").pipe(
      Config.withDefault("/var/lib/mecab/dic/open-jtalk/naist-jdic"),
    )
    const htsvoice = yield* Config.string("OPENJTALK_VOICE").pipe(
      Config.withDefault(
        "/usr/share/hts-voice/nitech-jp-atr503-m001/nitech_jp_atr503_m001.htsvoice",
      ),
    )
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const executor = yield* CommandExecutor.CommandExecutor

    const run = (name: string, cmd: Command.Command) =>
      Command.exitCode(cmd).pipe(
        Effect.flatMap((code) =>
          code === 0 ? Effect.void : Effect.fail(new CommandFailed({ command: name, exitCode: code })),
        ),
      )

    const synth = (text: string) =>
      Effect.gen(function* () {
        const dir = yield* fs.makeTempDirectoryScoped()
        const raw = path.join(dir, "raw.wav")
        const out = path.join(dir, "out.wav")

        yield* run(
          "open_jtalk",
          Command.make("open_jtalk", "-x", dic, "-m", htsvoice, "-ow", raw).pipe(
            Command.feed(text),
          ),
        )
        // open_jtalk の -s でレートだけ変えると話速と声の高さが崩れるので、sox で変換する
        yield* run("sox", Command.make("sox", raw, "-r", "8000", "-c", "1", "-b", "16", out))

        return yield* fs.readFile(out)
      }).pipe(
        Effect.scoped,
        Effect.provideService(CommandExecutor.CommandExecutor, executor),
        Effect.mapError((cause) => new TtsError({ cause })),
      )

    return { voiceId: `openjtalk:${path.basename(htsvoice)}`, synth } as const
  }),
)

/** TTS_ENGINE で実装を選ぶ */
export const TtsLive = Layer.unwrapEffect(
  Config.literal("openjtalk", "voicevox")("TTS_ENGINE").pipe(
    Config.withDefault("openjtalk" as const),
    Effect.map(
      (engine): Layer.Layer<
        Tts,
        ConfigError.ConfigError,
        HttpClient.HttpClient | FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
      > => (engine === "voicevox" ? VoicevoxLive : OpenJTalkLive),
    ),
  ),
)
