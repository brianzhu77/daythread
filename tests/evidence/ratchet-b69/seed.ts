import { harness, todo, under, flat, text, dayId } from '../../v2-helpers.ts'
import { writeFileSync } from 'node:fs'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
const db = process.argv[2]
if (!db?.startsWith('/tmp/ratchet230-')) throw Error('own copy only')
const h = harness(),
  today = '2026-10-30',
  yesterday = '2026-10-29'
h.day(yesterday)
h.day(today)
h.save(
  dayId(yesterday),
  (d) =>
    under(
      d,
      'TODO',
      todo('b69-named', 'Named yesterday', 'plan', yesterday),
      todo('b69-blank', 'Seed blank', 'plan', yesterday),
      todo('b69-spaces', 'Seed spaces', 'plan', yesterday),
    ),
  { today },
)
h.save(
  dayId(today),
  (d) => under(d, 'TODO', todo('b69-today-blank', 'Seed today', 'plan', today)),
  { today },
)
for (const d of [yesterday, today])
  h.save(
    dayId(d),
    (doc) => {
      for (const n of flat(doc))
        if (['b69-blank', 'b69-spaces', 'b69-today-blank'].includes(n.id))
          n.content = [text(n.id === 'b69-spaces' ? ' \u3000 ' : '')]
      return doc
    },
    { today },
  )
writeFileSync(db + '.json', JSON.stringify(h.ws))
await new SqliteWorkspaceRepository(db, db + '.json', { today }).load()
console.log(db)
