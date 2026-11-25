# Daythread for iPhone, iPad and Mac

A native app on Apple's frameworks only (UIKit, SwiftUI for the sign-in form, SwiftData, the Keychain). No
third-party packages, no web view.

- `Daythread.xcodeproj`: the app (`Daythread`; iPhone, iPad, Mac Catalyst; iOS 26), its unit tests hosted in the app
  (`Tests/`) and its UI tests (`UITests/`). The `App/`, `Tests/` and `UITests/` folders are synchronised groups: a file
  added there is in the target without a project edit.
- `Packages/`: `DaythreadCore` (records, lossless JSON), `DaythreadSync` (server client, Keychain, store on the device,
  `SyncEngine`), `DaythreadEditor` (a page, read only), `DaythreadUI` (the screens and `AppModel`). Each package's own
  tests run with `swift test` in its folder.

## Build

```sh
xcodebuild build -project native/Daythread.xcodeproj -scheme Daythread \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -derivedDataPath native/DerivedData
xcodebuild build -project native/Daythread.xcodeproj -scheme Daythread \
  -destination 'platform=macOS,variant=Mac Catalyst' -derivedDataPath native/DerivedData
```

No development team is set; simulator builds need none and the Mac build is signed to run locally. Under that
ad-hoc signature the Mac build cannot use the Keychain (`errSecMissingEntitlement`, -34018), so it cannot keep a
session yet; that waits for a team.

## Run against a local server

The server is the build setting `DAYTHREAD_SERVER_URL`, written into `Info.plist` as `DaythreadServerURL`: Debug
`http://127.0.0.1:3000` (`npm run dev`, sign-in off), Release `https://daythread.dogrod.com`. A launch argument
overrides it, and another picks the store file:

```sh
xcrun simctl launch <simulator> app.daythread.Daythread \
  -DaythreadServerURL http://127.0.0.1:3741 -DaythreadStoreName scratch
```

To run your own server on another port, start it the way `scripts/ui-test.sh` does: `DAYTHREAD_STORAGE=sqlite`,
`DAYTHREAD_SQLITE_PATH` and `DAYTHREAD_LOCAL_DATA_PATH` in a throwaway directory, `vite --port <port>`.

## Tests

```sh
native/scripts/ui-test.sh                                   # unit and UI tests
native/scripts/ui-test.sh -only-testing:DaythreadUITests    # extra arguments go to xcodebuild
```

The wrapper starts two throwaway servers from this checkout, each on SQLite in a directory under the system temp
directory: 3741 with sign-in off, seeded with today's page and the to-do "Water the plants", and 3742 with sign-in
on. It passes their addresses to the UI tests (`TEST_RUNNER_DAYTHREAD_SERVER_URL`,
`TEST_RUNNER_DAYTHREAD_SIGN_IN_SERVER_URL`, `TEST_RUNNER_DAYTHREAD_TODAY_TITLE`), runs `xcodebuild test`, and on exit
stops both servers, removes their directories and removes the stores the tests made in the app's container. Run any
other way, the UI tests skip. The app hosting the unit tests is pointed at `127.0.0.1:9`, where nothing listens.

Rules for a shared machine:

- Port 3000 and `.daythread-local/` belong to the server you use day to day: tests never start anything on 3000,
  never point the app at it, and never read that directory.
- One simulator: `iPhone 17`, iOS 26.5 (`0D25B4A2-E761-45AC-9857-5FBB3B90E2BE`), set in the wrapper. Leave the other
  simulators alone; put its appearance and text size back if you change them.
- Build output goes to `native/DerivedData` (ignored).

## On the device

- The store: `Application Support/Daythread/workspace.store` (or `<name>.store` with `-DaythreadStoreName`), left out
  of backups, and on iPhone and iPad readable once the device has been unlocked after a restart. In the simulator:
  `xcrun simctl get_app_container <simulator> app.daythread.Daythread data`, then `Library/Application Support/Daythread`.
- The session: one Keychain item, service `app.daythread.Daythread`.

## The audit

Debug builds check, for each new revision of the workspace, that every page's document writes back byte for byte,
and log the result under subsystem `app.daythread.Daythread`, category `audit`:

```sh
xcrun simctl spawn <simulator> log show --last 1h --info \
  --predicate 'subsystem == "app.daythread.Daythread" AND category == "audit"'
```

When any page fails, the account menu gains a first row, "Round trip · N of M pages fail".
