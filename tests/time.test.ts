import { describe, expect, it } from "vitest";
import {
  currentOperationalContext, findOpenShift, formatDateReport, getLocalParts, lastAllowedSecond, windowState,
  type ShiftWindowConfig,
} from "../src/lib/time";
import { isWeakPin, generatePin } from "../src/lib/crypto";
import { mx } from "./helpers";

const DIA: ShiftWindowConfig = { id: 1, code: "DIA", name: "Día", openTime: "05:00:00", closeTime: "07:20:00" };
const NOCHE: ShiftWindowConfig = { id: 2, code: "NOCHE", name: "Noche", openTime: "17:00:00", closeTime: "19:20:00" };

describe("Horarios (hora del servidor en America/Mexico_City)", () => {
  it("convierte UTC a hora local de Ciudad de México", () => {
    expect(getLocalParts(new Date("2026-11-23T11:00:00Z"))).toMatchObject({ date: "2026-11-23", time: "05:00:00" });
    expect(getLocalParts(new Date("2026-11-24T01:39:59Z"))).toMatchObject({ date: "2026-11-23", time: "19:39:59" });
  });

  it.each([
    ["2026-11-23T04:59:59", "BEFORE"],
    ["2026-11-23T05:00:00", "OPEN"],
    ["2026-11-23T07:19:59", "OPEN"],
    ["2026-11-23T07:20:00", "CLOSED"],
  ])("turno de día a las %s -> %s", (t, expected) => {
    expect(windowState(mx(t), DIA, "2026-11-23")).toBe(expected);
  });

  it.each([
    ["2026-11-23T16:59:59", "BEFORE"],
    ["2026-11-23T17:00:00", "OPEN"],
    ["2026-11-23T19:19:59", "OPEN"],
    ["2026-11-23T19:20:00", "CLOSED"],
  ])("turno de noche a las %s -> %s", (t, expected) => {
    expect(windowState(mx(t), NOCHE, "2026-11-23")).toBe(expected);
  });

  it("detecta automáticamente el turno abierto", () => {
    expect(findOpenShift(mx("2026-11-23T06:10:00"), [DIA, NOCHE])?.shift.code).toBe("DIA");
    expect(findOpenShift(mx("2026-11-23T18:00:00"), [DIA, NOCHE])?.shift.code).toBe("NOCHE");
    expect(findOpenShift(mx("2026-11-23T12:00:00"), [DIA, NOCHE])).toBeNull();
  });

  it("contexto operativo: madrugada pertenece a la noche anterior", () => {
    expect(currentOperationalContext(mx("2026-11-24T02:00:00"), [DIA, NOCHE])).toEqual({ date: "2026-11-23", shiftCode: "NOCHE" });
    expect(currentOperationalContext(mx("2026-11-24T09:00:00"), [DIA, NOCHE])).toEqual({ date: "2026-11-24", shiftCode: "DIA" });
  });

  it("formatos", () => {
    expect(formatDateReport("2026-11-23")).toBe("23 DE NOVIEMBRE");
    expect(lastAllowedSecond("07:20:00")).toBe("07:19:59");
  });

  it("PIN aleatorio nunca es trivial", () => {
    expect(isWeakPin("111111")).toBe(true);
    expect(isWeakPin("123456")).toBe(true);
    expect(isWeakPin("654321")).toBe(true);
    for (let i = 0; i < 200; i++) {
      const p = generatePin();
      expect(p).toMatch(/^\d{6}$/);
      expect(isWeakPin(p)).toBe(false);
    }
  });
});
