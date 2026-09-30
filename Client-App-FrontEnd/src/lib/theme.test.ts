import { describe, expect, it } from "vitest";
import { applyTheme, CREAM, INK } from "./theme";

describe("applyTheme", () => {
  it("sets dark system surfaces on the document", () => {
    document.head.innerHTML = '<meta name="theme-color" content="#F2F2F7" />';
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(INK);
  });

  it("restores light surfaces", () => {
    document.head.innerHTML = `<meta name="theme-color" content="${INK}" />`;
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(CREAM);
  });
});
