// Variables and formula values in a button's or a rule's steps (buttons.md §2, G3-10). They're read at the tap, on the server, at the tap's own time, so a retry gives the same answer.
import type { ButtonStep } from './buttons.ts'
import { parseFormula } from './formula-parse.ts'
import { format, type Value, type ValueType } from './formula-functions.ts'
import { freshWorldOf, clockIn, stepFormulaFits, stepProgram, type FormulaProgram, type FormulaWorld, type WorkedCells } from './formula.ts'
import { cellsReading } from './relations.ts'
import type { Page, Workspace } from './types.ts'

export type VariableTypes = ReadonlyMap<string, ValueType>
export type StepVariables = Map<string, { type: ValueType; value: Value }>

/** A variable's name has to read back as one: it's the formula parser that says so, so what it refuses here can't turn up later. */
export function variableNameProblem(name: string): string | null {
  if (!name) return 'Needs a name'
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

/** One step's reading of the workspace: it stops being true once the step has written. */
export class StepReading {
  private readonly world: FormulaWorld
  private readonly cells: WorkedCells
  private readonly programs = new Map<string, FormulaProgram>()
  constructor(ws: Workspace, at: string) {
    this.world = freshWorldOf(ws)
    this.cells = cellsReading(ws, clockIn(ws.timezone, Date.parse(at)), this.world)
  }
  value(stored: string, row: Page, databaseId: string, variables: StepVariables): { value: Value; type: ValueType; error?: string } {
    const key = `${databaseId}\0${stored}`
    let program = this.programs.get(key)
    if (!program) {
      program = stepProgram(stored, this.world, databaseId, new Map([...variables].map(([name, v]) => [name, v.type])))
      this.programs.set(key, program)
    }
    if (program.error) return { value: null, type: 'any', error: program.error }
    return { ...this.cells.stepValue(program.tree, row, new Map([...variables].map(([name, v]) => [name, v.value]))), type: program.type }
  }
}
export const formulaText = (value: Value): string => format(value)
