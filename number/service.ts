import { Effect } from "effect"
import { Agi } from "./agi"
import { Directory, extensionText, stationText } from "./directory"
import { Prompts, Voice } from "./voice"

/** 番号案内の IVR 本体 */
export const bango = Effect.gen(function* () {
  const agi = yield* Agi
  const directory = yield* Directory
  const voice = yield* Voice
  const play = (text: string) => agi.streamFile(voice.say(text))

  yield* agi.answer
  yield* Effect.sleep("500 millis") // 応答直後の頭切れ対策
  yield* play(Prompts.intro)

  const input = yield* agi.getData(voice.say(Prompts.enter), "10 seconds", 16)
  if (input === "") {
    yield* play(Prompts.noInput)
    return yield* agi.hangup
  }

  const hit = yield* directory.lookup(input)
  yield* Effect.logInfo(`lookup ${input} -> ${hit._tag}`)

  switch (hit._tag) {
    case "NotFound": {
      yield* play(Prompts.notFoundHead)
      yield* Effect.forEach(input, (d) => agi.streamFile(voice.digit(d)), { discard: true })
      yield* play(Prompts.notFoundTail)
      break
    }
    case "Station": {
      yield* play(stationText(hit.station))
      break
    }
    case "Extension": {
      yield* play(extensionText(hit.extension))
      const choice = yield* agi.getData(voice.say(Prompts.connect), "5 seconds", 1)
      if (choice === "1") {
        yield* play(Prompts.connecting)
        // AGI を抜けた後、ダイヤルプラン側がこの番号へ発信する
        return yield* agi.setVariable("BANGO_TARGET", hit.extension.dial)
      }
      break
    }
  }

  yield* play(Prompts.goodbye)
  yield* agi.hangup
})
