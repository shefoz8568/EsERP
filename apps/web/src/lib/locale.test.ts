import { describe, expect, it } from "vitest";
import { applyDocumentDir, dirFor, isRTL, switchLocalePath } from "./locale";

describe("RTL helpers", () => {
  it("dirFor returns rtl for ar and ltr for en", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
    expect(isRTL("ar")).toBe(true);
    expect(isRTL("en")).toBe(false);
  });

  it("applyDocumentDir sets document.dir to rtl for ar", () => {
    expect(applyDocumentDir("ar")).toBe("rtl");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");
  });

  it("applyDocumentDir sets document.dir to ltr for en", () => {
    expect(applyDocumentDir("en")).toBe("ltr");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("switchLocalePath swaps the locale segment", () => {
    expect(switchLocalePath("/en/settings?tab=users".split("?")[0], "ar")).toBe("/ar/settings");
    expect(switchLocalePath("/en/dashboard", "ar")).toBe("/ar/dashboard");
    expect(switchLocalePath("/", "ar")).toBe("/ar");
  });
});
