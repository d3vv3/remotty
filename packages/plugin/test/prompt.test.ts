import { describe, expect, it } from "vitest"
import { promptBody } from "../src/prompt"

describe("remote prompt body", () => {
  it("passes the phone-generated stable message id to OpenCode", () => {
    expect(promptBody({}, "Continue", undefined, "msg_phone-message-1")).toMatchObject({
      messageID: "msg_phone-message-1",
      parts: [{ type: "text", text: "Continue" }],
    })
  })
})
