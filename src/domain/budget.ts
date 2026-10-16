export interface BudgetAttempt {
  id: string;
  day: string;
  reserved: number;
  actual: number | null;
  state: "reserved" | "unknown" | "settled" | "not-sent";
}
export interface BudgetLedger {
  attempts: BudgetAttempt[];
  breached?: boolean;
}
const units = (usd: number) => Math.ceil(usd * 1_000_000);
export function reserveBudget(
  ledger: BudgetLedger,
  id: string,
  day: string,
  upperBound: number,
  cap = 10,
): BudgetLedger {
  if (
    !id ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(upperBound) ||
    upperBound < 0 ||
    !Number.isFinite(cap) ||
    cap < 0
  )
    throw new Error("Invalid budget reservation");
  const existing = ledger.attempts.find((a) => a.id === id);
  if (existing) {
    if (existing.day !== day || existing.reserved !== upperBound)
      throw new Error("Attempt identity reused with different input");
    return structuredClone(ledger);
  }
  if (
    ledger.breached ||
    ledger.attempts.some((a) => a.state === "reserved" || a.state === "unknown")
  )
    throw new Error("An in-flight or unknown charge must settle first");
  const used = ledger.attempts
    .filter((a) => a.day === day && a.state !== "not-sent")
    .reduce((sum, a) => sum + units(a.actual ?? a.reserved), 0);
  if (used + units(upperBound) > units(cap))
    throw new Error("Daily budget reached");
  return {
    ...structuredClone(ledger),
    attempts: [
      ...structuredClone(ledger.attempts),
      { id, day, reserved: upperBound, actual: null, state: "reserved" },
    ],
  };
}
export function settleBudget(
  ledger: BudgetLedger,
  id: string,
  actual: number | null,
): BudgetLedger {
  if (actual !== null && (!Number.isFinite(actual) || actual < 0))
    throw new Error("Invalid actual cost");
  const next = structuredClone(ledger);
  const attempt = next.attempts.find((a) => a.id === id);
  if (!attempt) throw new Error("Unknown attempt");
  if (attempt.state === "settled") {
    if (attempt.actual !== actual)
      throw new Error("Settled cost cannot be overwritten");
    return next;
  }
  if (attempt.state === "not-sent")
    throw new Error("Unsent attempt cannot be charged");
  attempt.actual = actual;
  attempt.state = actual === null ? "unknown" : "settled";
  if (actual !== null && units(actual) > units(attempt.reserved))
    next.breached = true;
  return next;
}
