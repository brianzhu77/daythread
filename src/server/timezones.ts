/** The IANA zones this runtime knows, for the account row's picker. */
export function timezones(): string[] {
  return Intl.supportedValuesOf('timeZone')
}
