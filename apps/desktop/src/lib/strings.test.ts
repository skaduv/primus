import { describe, expect, it } from "vitest";
import { strings } from "./strings";

function leaves(value: unknown, path = "strings"): Array<[string, unknown]> {
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
  return [[path, value]];
}

describe("界面文案", () => {
  it("每一项都是非空字符串", () => {
    for (const [path, value] of leaves(strings)) {
      expect(typeof value, path).toBe("string");
      expect((value as string).trim().length, path).toBeGreaterThan(0);
    }
  });

  it("产品名统一为乾元 Primus", () => {
    expect(strings.appName).toBe("乾元 Primus");
  });
});
