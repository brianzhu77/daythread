// Variables and formula values in a button's or a rule's steps (buttons.md §2, G3-10). They're read at the tap, on the server, at the tap's own time, so a retry gives the same answer.
import type { ButtonStep } from './buttons.ts'
import { titleId } from './database.ts'
import { parseFormula, type FormulaNode } from './formula-parse.ts'
import type { Clock, Value, ValueType } from './formula-functions.ts'
import { clockIn, freshWorldOf, isFormula, notBare, stepFormulaFits, stepProgram, WorkedCells, type FormulaProgram, type FormulaWorld } from './formula.ts'
import { cellsReading } from './relations.ts'
import type { Page, Workspace } from './types.ts'

export type VariableTypes = ReadonlyMap<string, ValueType>
export type StepVariables = Map<string, { type: ValueType; value: Value }>

/** A variable's name has to read back as one: it's the formula parser that says so, so what it refuses here can't turn up later. */
export function variableNameProblem(name: string): string | null {
  if (!name) return 'Needs a name'
  if (notBare.has(name.toLocaleLowerCase())) return `"${name}" can't be a name`
  try {
    const { tree } = parseFormula(name, { names: [], memberNames: [], stored: true, idOf: () => null, locals: [name] })
    if (tree?.k === 'var') return null
  } catch { /* Spaces, say. */ }
  return `"${name}" can't be a name`
}
/** What the step at `index` can read: the variables of the steps above it. */
export function variablesBefore(steps: readonly ButtonStep[], index: number, world: FormulaWorld, databaseId: string): VariableTypes {
  const types = new Map<string, ValueType>()
  for (const step of steps.slice(0, index)) if (step.kind === 'variables') for (const v of step.vars) { const program = stepProgram(v.formula, world, databaseId, types); types.set(v.name, program.error ? 'any' : program.type) }
  return types
}
/** What's wrong with each step's formulas, in order. `databaseId` is the row's, or '' with no row to read. */
export function stepFormulaProblems(steps: readonly ButtonStep[], world: FormulaWorld, databaseId: string): (string | null)[] {
  return steps.map((step, i) => {
    const types = variablesBefore(steps, i, world, databaseId)
    if (step.kind === 'variables') {
      const here = new Map(types), seen = new Set<string>()
      for (const v of step.vars) {
        const name = variableNameProblem(v.name)
        if (name) return name
        if (seen.has(v.name)) return `Two variables are called ${v.name}`
        seen.add(v.name)
        if (!v.formula.trim()) return `${v.name} needs a formula`
        const program = stepProgram(v.formula, world, databaseId, here)
        if (program.error) return `${v.name}: ${program.error}`
        here.set(v.name, program.type)
      }
      return null
    }
    if (step.kind !== 'add-row' && step.kind !== 'edit-property' && step.kind !== 'edit-rows') return null
    const reads = step.kind === 'edit-rows' ? step.databaseId : databaseId
    const target = world.databases.get(step.kind === 'edit-property' ? databaseId : step.databaseId)
    if (step.kind === 'add-row' && step.titleFormula !== undefined) {
      if (!step.titleFormula.trim()) return 'Its name needs a formula'
      const program = stepProgram(step.titleFormula, world, reads, types)
      if (program.error) return `Name: ${program.error}`
    }
    for (const set of step.set) {
      if (set.value.kind !== 'formula') continue
      if (!set.value.text.trim()) return `${set.name} needs a formula`
      const program = stepProgram(set.value.text, world, reads, types)
      if (program.error) return `${set.name}: ${program.error}`
      const property = target?.properties.find(p => p.id === set.id)
      const fits = property ? stepFormulaFits(program.type, property) : null
      if (fits) return fits
    }
    return null
  })
}

const prepared = new WeakMap<readonly ButtonStep[], Map<string, { world: FormulaWorld; problems: (string | null)[] }>>()
/**
 * The world and the checks, once for a list of steps however many rows it runs on. Steps can't change a database's properties,
 * so these hold for the whole command; a list is read afresh for each command.
 */
export function preparedSteps(steps: readonly ButtonStep[], ws: Workspace, databaseId: string): { world: FormulaWorld; problems: (string | null)[] } {
  let byScope = prepared.get(steps)
  if (!byScope) { byScope = new Map(); prepared.set(steps, byScope) }
  let found = byScope.get(databaseId)
  if (!found) {
    const world = byScope.values().next().value?.world ?? freshWorldOf(ws)
    found = { world, problems: stepFormulaProblems(steps, world, databaseId) }
    byScope.set(databaseId, found)
  }
  return found
}
/** Does it read only this row's own stored values? Then it needs no other row, and no reading of the whole workspace. */
function readsOnlyRow(node: FormulaNode | null, world: FormulaWorld, databaseId: string): boolean {
  if (!node) return true
  switch (node.k) {
    case 'lit': case 'var': return true
    case 'list': return node.items.every(i => readsOnlyRow(i, world, databaseId))
    case 'let': return readsOnlyRow(node.value, world, databaseId) && readsOnlyRow(node.body, world, databaseId)
    case 'call': return node.args.every(a => readsOnlyRow(a, world, databaseId))
    case 'member': return false
    case 'prop': {
      if (node.id === titleId) return true
      const p = world.databases.get(databaseId)?.properties.find(x => x.id === node.id)
      return p !== undefined && !isFormula(p) && !p.rollup && p.type !== 'relation'
    }
  }
}

/** One step's reading of the workspace: it stops being true once the step has written. */
export class StepReading {
  private readonly ws: Workspace
  private readonly world: FormulaWorld
  private readonly clock: Clock
  private cells: WorkedCells | null = null
  private readonly programs = new Map<string, { program: FormulaProgram; light: boolean }>()
  private readonly whole: () => void
  /** `whole` is told each time the whole workspace is read, which is what such a formula costs. */
  constructor(ws: Workspace, at: string, world: FormulaWorld, whole: () => void = () => {}) {
    this.ws = ws
    this.whole = whole
    this.world = world
    this.clock = clockIn(ws.timezone, Date.parse(at))
  }
  /** One that reads only its row gets cells of its own, which cost nothing; anything else reads the whole workspace, once for the step. */
  private cellsFor(light: boolean, databaseId: string): WorkedCells {
    // A copy, as the workspace is changed in place by the steps before, and what's projected from it is kept by identity.
    if (!light) { if (!this.cells) { this.whole(); this.cells = cellsReading({ ...this.ws }, this.clock, this.world) } return this.cells }
    const db = this.world.databases.get(databaseId)
    return new WorkedCells({ world: this.world, pages: new Map(), databases: new Map(db ? [[databaseId, db]] : []), clock: this.clock, rollup: () => undefined })
  }
  value(stored: string, row: Page, databaseId: string, variables: StepVariables): { value: Value; type: ValueType; error?: string } {
    const key = `${databaseId}\0${stored}`
    let known = this.programs.get(key)
    if (!known) {
      const program = stepProgram(stored, this.world, databaseId, new Map([...variables].map(([name, v]) => [name, v.type])))
      known = { program, light: readsOnlyRow(program.tree, this.world, databaseId) }
      this.programs.set(key, known)
    }
    const { program, light } = known
    if (program.error) return { value: null, type: 'any', error: program.error }
    return { ...this.cellsFor(light, databaseId).stepValue(program.tree, row, new Map([...variables].map(([name, v]) => [name, v.value]))), type: program.type }
  }
}
