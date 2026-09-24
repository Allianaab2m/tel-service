import { Effect, Layer } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Agi, type AgiError, serve } from "./agi"
import { bango } from "./service"
import { AppConfig } from "./config"
import { Directory } from "./directory"
import { Voice } from "./voice"
import { TtsLive } from "./tts"

type Service = Effect.Effect<void, AgiError, Agi | Directory | Voice>

/** agi://host:port/<script> の <script> で振り分ける。時報などはここに足していく */
const routes: Readonly<Record<string, Service>> = {
  bango,
}

const router: Service = Effect.gen(function* () {
  const agi = yield* Agi
  const script = agi.env["agi_network_script"] ?? ""
  const service = routes[script]
  if (!service) {
    yield* Effect.logWarning(`unknown script: "${script}"`)
    return yield* agi.hangup
  }
  yield* service
})

const AppLive = Directory.Default.pipe(
  Layer.provideMerge(Voice.Default),
  Layer.provide(TtsLive),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(BunContext.layer),
)

const program = Effect.gen(function* () {
  const { agiPort } = yield* AppConfig
  yield* serve(agiPort, router)
})

program.pipe(Effect.provide(AppLive), BunRuntime.runMain)
