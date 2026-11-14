import { describe, expect, it } from "vitest";
import { screenshotWasRequested } from "./screenshot-request.ts";

const user = (text: string) => ({ role: "user", kind: "text", text });

describe("screenshot delivery", () => {
  it("posts a picture only when this turn asked for one", () => {
    expect(screenshotWasRequested([user("Open Wikipedia and search for World War 2")])).toBe(false);
    expect(screenshotWasRequested([user("send me a screenshot of that page")])).toBe(true);
    expect(screenshotWasRequested([user("Please take a screen shot")])).toBe(true);
    expect(screenshotWasRequested([user("do not send a screenshot")])).toBe(false);
    expect(screenshotWasRequested([
      user("send me a screenshot"),
      { role: "bot", kind: "text", text: "Working." },
      user("now just click the first result"),
    ])).toBe(false);
  });
});