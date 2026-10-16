export interface BudgetAttempt { id: string; day: string; reserved: number; actual: number | null; state: 'reserved' | 'unknown' | 'settled' | 'not-sent' }
export interface BudgetLedger { attempts: BudgetAttempt[] }
// USD amounts; pure helpers, no provider or network requests.
export function reserveBudget(_ledger: BudgetLedger, _id: string, _day: string, _upperBound: number, _cap = 10): BudgetLedger { throw new Error('Implementation in progress') }
export function settleBudget(_ledger: BudgetLedger, _id: string, _actual: number | null): BudgetLedger { throw new Error('Implementation in progress') }
