import { describe, it, expect } from "vitest";
import { ganzzahlCh } from "./zahlCh";

describe("ganzzahlCh", () => {
  it("trennt Tausender mit typografischem Apostroph, unabhaengig von der ICU-Version", () => {
    expect(ganzzahlCh(79838.4)).toBe("79’838");
    expect(ganzzahlCh(1234567)).toBe("1’234’567");
    expect(ganzzahlCh(950)).toBe("950");
    expect(ganzzahlCh(-81000)).toBe("-81’000");
  });
});
