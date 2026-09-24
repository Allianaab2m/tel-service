import { Context, Data, Duration, Effect, Runtime } from "effect"
import * as net from "node:net"
import * as readline from "node:readline"

export class AgiHangup extends Data.TaggedError("AgiHangup")<{}> { }
export class AgiProtocolError extends Data.TaggedError("AgiProtocolError")<{
  readonly command: string
  readonly response: string
}> { }
export type AgiError = AgiHangup | AgiProtocolError

export interface AgiResponse {
  readonly result: string
  readonly data: string
}

/** 1 通話（1 FastAGI セッション）ごとに提供されるサービス */
export class Agi extends Context.Tag("Agi")<Agi, {
  readonly env: Readonly<Record<string, string>>
  readonly command: (cmd: string) => Effect.Effect<AgiResponse, AgiError>
  readonly answer: Effect.Effect<void, AgiError>
  readonly hangup: Effect.Effect<void, AgiError>
  readonly streamFile: (file: string) => Effect.Effect<void, AgiError>
  readonly getData: (
    file: string,
    timeout: Duration.DurationInput,
    maxDigits: number,
  ) => Effect.Effect<string, AgiError>
  readonly setVariable: (name: string, value: string) => Effect.Effect<void, AgiError>
}>() { }

const RESPONSE = /^200 result=(\S*)\s*(.*)$/

const make = (socket: net.Socket) =>
  Effect.gen(function* () {
    const lines = readline
      .createInterface({ input: socket, crlfDelay: Infinity })
    [Symbol.asyncIterator]()

    const readLine = Effect.tryPromise({
      try: () => lines.next(),
      catch: () => new AgiHangup(),
    }).pipe(
      Effect.flatMap((r) =>
        r.done || r.value === "HANGUP"
          ? Effect.fail(new AgiHangup())
          : Effect.succeed(r.value),
      ),
    )

    // 接続直後に agi_xxx: value のヘッダが空行まで送られてくる
    const env: Record<string, string> = {}
    while (true) {
      const line = yield* readLine
      if (line === "") break
      const i = line.indexOf(":")
      if (i > 0) env[line.slice(0, i)] = line.slice(i + 1).trim()
    }

    const command = (cmd: string) =>
      Effect.gen(function* () {
        yield* Effect.sync(() => socket.write(`${cmd}\n`))
        let line = yield* readLine
        if (line.startsWith("520-")) {
          // 構文エラー時は usage が複数行で返ってくるので読み捨てる
          while (!line.startsWith("520 ")) line = yield* readLine
          return yield* new AgiProtocolError({ command: cmd, response: "520 invalid syntax" })
        }
        if (line.startsWith("511")) return yield* new AgiHangup()
        const m = RESPONSE.exec(line)
        if (!m) return yield* new AgiProtocolError({ command: cmd, response: line })
        return { result: m[1] ?? "", data: m[2] ?? "" } satisfies AgiResponse
      })

    return Agi.of({
      env,
      command,
      answer: Effect.asVoid(command("ANSWER")),
      hangup: Effect.asVoid(command("HANGUP")),
      streamFile: (file) => Effect.asVoid(command(`STREAM FILE ${file} ""`)),
      getData: (file, timeout, maxDigits) =>
        command(`GET DATA ${file} ${Duration.toMillis(timeout)} ${maxDigits}`).pipe(
          Effect.filterOrFail((r) => r.result !== "-1", () => new AgiHangup()),
          Effect.map((r) => r.result),
        ),
      setVariable: (name, value) => Effect.asVoid(command(`SET VARIABLE ${name} "${value}"`)),
    })
  })

/** FastAGI サーバーを起動し、接続ごとに handler を別 Fiber で走らせる */
export const serve = <R>(port: number, handler: Effect.Effect<void, AgiError, R>) =>
  Effect.gen(function* () {
    const runFork = Runtime.runFork(yield* Effect.runtime<Exclude<R, Agi>>())

    const session = (socket: net.Socket) =>
      make(socket).pipe(
        Effect.flatMap((agi) =>
          Effect.provideService(handler, Agi, agi).pipe(
            Effect.annotateLogs("call", agi.env["agi_uniqueid"] ?? "?"),
          ),
        ),
        Effect.catchTag("AgiHangup", () => Effect.logDebug("caller hung up")),
        Effect.catchAllCause((cause) => Effect.logWarning("AGI session failed", cause)),
        Effect.ensuring(Effect.sync(() => socket.end())),
      )

    yield* Effect.acquireRelease(
      Effect.async<net.Server, Error>((resume) => {
        const server = net.createServer((socket) => {
          socket.on("error", () => { }) // 切断は readLine 側で AgiHangup として扱う
          runFork(session(socket))
        })
        server.once("error", (e) => resume(Effect.fail(e)))
        server.listen(port, () => resume(Effect.succeed(server)))
      }),
      (server) => Effect.async<void>((resume) => void server.close(() => resume(Effect.void))),
    )
    yield* Effect.logInfo(`FastAGI listening on :${port}`)
    return yield* Effect.never
  }).pipe(Effect.scoped)
