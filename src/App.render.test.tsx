import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("keeps the screen on crash points and history files", () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain("Save history");
    expect(html).toContain("Load history");
    expect(html).toContain("Add a crash point");
    expect(html).toContain("Auto last crash");
    expect(html).toContain("Waiting for a crash result");
    expect(html).not.toContain("Stake");
    expect(html).not.toContain("Bankroll");
  });
});
