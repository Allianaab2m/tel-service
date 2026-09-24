import { Data, Effect, Ref } from "effect"
import { HttpClient } from "@effect/platform"
import { AppConfig } from "./config"
import { crawl, emptyIndex, type Extension, type Index, type Station } from "./mantela.js"
import { spellDigits, Voice } from "./voice"

export type Hit = Data.TaggedEnum<{
  Station: { readonly station: Station }
  Extension: { readonly extension: Extension }
  NotFound: {}
}>
export const Hit = Data.taggedEnum<Hit>()

export const stationText = (s: Station) => {
  const head = `${s.name}です。内線は、${s.extCount}件、登録されています。`
  if (s.main) return `${head}代表番号は、${spellDigits(s.main)}番です。`
  // 代表番号が無い局は、実際にかけられる番号をいくつか読み上げる
  return head + s.samples.map((e) => `${spellDigits(e.dial)}番、${e.name}。`).join("")
}

/** 局を案内したあと、1 を押されたときの接続先 */
export const stationTarget = (s: Station) => s.main ?? s.samples[0]?.dial
export const extensionText = (e: Extension) => `${e.station}の、${e.name}です。`

const announcements = (idx: Index) => [
  ...Array.from(idx.stations.values(), stationText),
  ...Array.from(idx.extensions.values(), extensionText),
]

/** 内線を優先し、なければ局番として引く */
export const lookup = (idx: Index, digits: string): Hit => {
  const extension = idx.extensions.get(digits)
  if (extension) return Hit.Extension({ extension })
  const station = idx.stations.get(digits)
  if (station) return Hit.Station({ station })
  return Hit.NotFound()
}

export class EmptyCrawl extends Data.TaggedError("EmptyCrawl")<{}> { }

export class Directory extends Effect.Service<Directory>()("Directory", {
  scoped: Effect.gen(function* () {
    const cfg = yield* AppConfig
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const voice = yield* Voice
    const ref = yield* Ref.make<Index>(emptyIndex)

    const refresh = crawl(client, cfg.rootMantela, cfg.crawlDepth).pipe(
      // 起点が取れなかった時に空のインデックスで上書きしない
      Effect.filterOrFail((idx) => idx.extensions.size + idx.stations.size > 0, () => new EmptyCrawl()),
      Effect.tap((idx) => voice.prepare(announcements(idx))),
      Effect.tap((idx) => Ref.set(ref, idx)),
      Effect.tap((idx) =>
        Effect.logInfo(`crawled: ${idx.stations.size} stations, ${idx.extensions.size} extensions`),
      ),
      Effect.catchAllCause((cause) => Effect.logWarning("crawl failed; keeping previous index", cause)),
    )

    yield* refresh
    yield* Effect.sleep(cfg.crawlInterval).pipe(
      Effect.zipRight(refresh),
      Effect.forever,
      Effect.forkScoped,
    )

    return {
      current: Ref.get(ref),
      lookup: (digits: string) => Effect.map(Ref.get(ref), (idx) => lookup(idx, digits)),
    } as const
  }),
}) { }
