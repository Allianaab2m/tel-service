import { Config, Effect } from "effect"
import { FetchHttpClient, HttpClient } from "@effect/platform"
import { BunRuntime } from "@effect/platform-bun"
import { crawl } from "./mantela.js"

/** クロール結果を JSON で標準出力に書き出す（網の確認用） */
const program = Effect.gen(function* () {
  const root = yield* Config.string("ROOT_MANTELA").pipe(
    Config.withDefault("https://allianaab2m.github.io/mantela/mantela.json"),
  )
  const depth = yield* Config.integer("CRAWL_DEPTH").pipe(Config.withDefault(6))
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  const idx = yield* crawl(client, root, depth)
  console.log(
    JSON.stringify(
      {
        crawledAt: idx.crawledAt,
        stations: [...idx.stations.values()],
        extensions: [...idx.extensions.values()],
      },
      null,
      2,
    ),
  )
})

program.pipe(Effect.provide(FetchHttpClient.layer), BunRuntime.runMain)
