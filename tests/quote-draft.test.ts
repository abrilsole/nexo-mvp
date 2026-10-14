import { describe, expect, it } from "vitest";
import { initialCalcState } from "@/components/budget/calculator-state";
import { clearQuoteDraft, peekQuoteDraft, setQuoteDraft } from "@/components/budget/quote-draft";

describe("cotización en curso", () => {
  it("se guarda, se lee sin consumirla y se limpia", () => {
    expect(peekQuoteDraft()).toBeNull();
    setQuoteDraft({ state: initialCalcState(), projectType: "Local comercial", salesPrice: 1000 });
    expect(peekQuoteDraft()?.salesPrice).toBe(1000);
    expect(peekQuoteDraft()?.salesPrice).toBe(1000);
    clearQuoteDraft();
    expect(peekQuoteDraft()).toBeNull();
  });
});
