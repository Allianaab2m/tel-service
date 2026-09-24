import { Array as Arr, Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "@effect/platform"

// 未知のプロパティ（aboutMe.type や status など）は無視されるので、仕様追加に強い
const MantelaExtension = Schema.Struct({
  name: Schema.String,
  extension: Schema.String,
  /** "main" が代表番号。それ以外は案内の取捨に使う */
  type: Schema.optional(Schema.String),
})
const MantelaProvider = Schema.Struct({
  name: Schema.String,
  prefix: Schema.String,
  identifier: Schema.optional(Schema.String),
  mantela: Schema.optional(Schema.String),
})
const Mantela = Schema.Struct({
  aboutMe: Schema.Struct({
    name: Schema.String,
    identifier: Schema.optional(Schema.String),
  }),
  // 1 件壊れているだけで局全体を捨てないよう、要素は個別にデコードする
  extensions: Schema.optionalWith(Schema.Array(Schema.Unknown), { default: () => [] }),
  providers: Schema.optionalWith(Schema.Array(Schema.Unknown), { default: () => [] }),
})
const decodeExtension = Schema.decodeUnknownOption(MantelaExtension)
const decodeProvider = Schema.decodeUnknownOption(MantelaProvider)

export interface Station {
  readonly name: string
  /** 自局からのダイヤル番号（経路上の prefix を連結したもの） */
  readonly dial: string
  readonly extCount: number
  /** 代表番号（type: "main"）へのダイヤル番号。無い局のほうが多い */
  readonly main?: string
  /** 代表番号が無いときに案内する先頭数件 */
  readonly samples: ReadonlyArray<{ readonly dial: string; readonly name: string }>
}
export interface Extension {
  readonly station: string
  readonly name: string
  readonly dial: string
}
export interface Index {
  readonly stations: ReadonlyMap<string, Station>
  readonly extensions: ReadonlyMap<string, Extension>
  readonly crawledAt: Date
}

export const emptyIndex: Index = {
  stations: new Map(),
  extensions: new Map(),
  crawledAt: new Date(0),
}

/** 代表番号が無い局で読み上げる内線の件数 */
const SampleCount = 3

interface Target {
  readonly url: string
  readonly prefix: string
}

/** 自局から BFS で辿り、各局・各内線への最短ダイヤル番号を求める */
export const crawl = (client: HttpClient.HttpClient, root: string, maxDepth: number) =>
  Effect.gen(function* () {
    const fetchOne = (url: string) =>
      client.get(url).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Mantela)),
        Effect.timeout("5 seconds"),
        Effect.tapError((e) => Effect.logDebug(`skip ${url}`, e)),
        Effect.option,
      )

    const seen = new Set<string>()
    const queued = new Set<string>([root])
    const stations = new Map<string, Station>()
    const extensions = new Map<string, Extension>()
    let frontier: ReadonlyArray<Target> = [{ url: root, prefix: "" }]

    for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
      const fetched = yield* Effect.forEach(
        frontier,
        (t) => fetchOne(t.url).pipe(Effect.map((doc) => ({ ...t, doc }))),
        { concurrency: 8 },
      )
      const next: Array<Target> = []

      for (const { url, prefix, doc } of fetched) {
        if (Option.isNone(doc)) continue
        const m = doc.value
        const key = m.aboutMe.identifier ?? url
        if (seen.has(key)) continue
        seen.add(key)

        const exts = Arr.filterMap(m.extensions, (u) => decodeExtension(u))
        if (prefix !== "" && !stations.has(prefix)) {
          const main = exts.find((e) => e.type === "main")
          // 代表番号が無い局のほうが多いので、その場合は先頭数件を案内に回す
          const samples = main
            ? []
            : exts
              .filter((e) => e.type !== "unused" && e.type !== "reserved")
              .slice(0, SampleCount)
              .map((e) => ({ dial: prefix + e.extension, name: e.name }))
          stations.set(prefix, {
            name: m.aboutMe.name,
            dial: prefix,
            extCount: exts.length,
            ...(main ? { main: prefix + main.extension } : {}),
            samples,
          })
        }
        for (const e of exts) {
          const dial = prefix + e.extension
          if (!extensions.has(dial)) {
            extensions.set(dial, { station: m.aboutMe.name, name: e.name, dial })
          }
        }
        for (const p of Arr.filterMap(m.providers, (u) => decodeProvider(u))) {
          if (!p.mantela || queued.has(p.mantela)) continue
          if (p.identifier && seen.has(p.identifier)) continue
          queued.add(p.mantela)
          next.push({ url: p.mantela, prefix: prefix + p.prefix })
        }
      }
      frontier = next
    }

    return { stations, extensions, crawledAt: new Date() } satisfies Index
  })
