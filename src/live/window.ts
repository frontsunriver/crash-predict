export type LiveWindow =
  | { status: "point"; value: number; round: number }
  | { status: "login" }
  | { status: "idle" };

export function parseLiveTitle(titles: string): LiveWindow {
  const match = titles.match(/CRASHPOINT\s+(\d+(?:\.\d+)?)\s+(\d+)/);
  if (match) {
    const value = Number(match[1]);
    const round = Number(match[2]);
    if (value >= 1 && Number.isInteger(round)) return { status: "point", value, round };
  }
  if (/crygodi/i.test(titles) && /log in/i.test(titles)) return { status: "login" };
  return { status: "idle" };
}
