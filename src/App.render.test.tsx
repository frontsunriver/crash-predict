import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App, RecentCrashDots, RecentCrashLine } from "./App";

describe("App", () => {
  it("keeps the screen on crash points and history files", () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain("Save history");
    expect(html).toContain("Load history");
    expect(html).toContain("Load database");
    expect(html).toContain("Study");
    expect(html).toContain("Add a crash point");
    expect(html).toContain("Auto last crash");
    expect(html).toContain("Waiting for a crash result");
    expect(html).toContain("Waiting for history");
    expect(html).toContain("Salt");
    expect(html).not.toContain("Stake");
    expect(html).not.toContain("Bankroll");
  });

  it("draws a line through the recent crash values", () => {
    const html = renderToStaticMarkup(createElement(RecentCrashLine, { values: [1.1, 2.4, 8.2, 14] }));
    expect(html).toContain("Line chart of the last 4 crash values");
    expect(html).toContain("<polyline");
    expect(html).toContain("1.10x");
    expect(html).toContain("8.20x");
    expect(html).toContain("14.00x");
  });

  it("draws BC.Game style crash dots", () => {
    const html = renderToStaticMarkup(createElement(RecentCrashDots, { values: [1.23, 2, 10, 120.4] }));
    expect(html).toContain("Dot chart of the last 4 crash values");
    expect(html).toContain("crash-dot-red");
    expect(html).toContain("crash-dot-green");
    expect(html).toContain("crash-dot-moon");
    expect(html).toContain("1.23x");
    expect(html).toContain("2.00x");
    expect(html).toContain("10.0x");
    expect(html).toContain("120x");
    expect(html).toContain("Under 2x");
    expect(html).toContain("10x and above");
  });

  it("stacks crash dots of the same range in one column", () => {
    const html = renderToStaticMarkup(createElement(RecentCrashDots, { values: [1.1, 1.4, 3.2, 8.1, 1.2] }));
    expect(html.match(/dot-column/g)).toHaveLength(3);
    const streak = renderToStaticMarkup(
      createElement(RecentCrashDots, { values: [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.15] }),
    );
    expect(streak.match(/dot-column/g)).toHaveLength(2);
    const wide = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? 1.1 : 2.2));
    const wideHtml = renderToStaticMarkup(createElement(RecentCrashDots, { values: wide }));
    expect(wideHtml.match(/dot-column/g)).toHaveLength(35);
  });
});
