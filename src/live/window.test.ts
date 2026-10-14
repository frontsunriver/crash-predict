import { describe, expect, it } from "vitest";
import { parseLiveTitle } from "./window";

describe("parseLiveTitle", () => {
  it("reads the latest crash point and round from the window title", () => {
    expect(parseLiveTitle("CRASHPOINT 2.45 7 - Microsoft Edge")).toEqual({
      status: "point",
      value: 2.45,
      round: 7,
    });
  });

  it("notices when the CRYGODI tab is on the login page", () => {
    expect(parseLiveTitle("Log In | CRYGODI FunClub - Microsoft Edge").status).toBe("login");
  });

  it("waits when no crash window is open", () => {
    expect(parseLiveTitle("Inbox - Microsoft Edge").status).toBe("idle");
  });
});
