import { describe, expect, it } from "vitest"
import { promptBody } from "../src/prompt"

describe("remote prompt body", () => {
  it("passes the phone-generated stable message id to OpenCode", () => {
    expect(promptBody({}, "Continue", undefined, "phone-message-1")).toMatchObject({
      messageID: "phone-message-1",
      parts: [{ type: "text", text: "Continue" }],
    })
  })
})
