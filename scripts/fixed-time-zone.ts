// Imported first by export-core-fixtures.ts: ES modules evaluate their imports in order, and src/components/dates.ts reads
// the device's time zone when it words a date, so the zone is fixed before any of it loads.
process.env.TZ = 'UTC'
