# Daythread for iPhone, iPad and Mac

A native app on Apple's frameworks only (UIKit, SwiftUI for the sign-in form, SwiftData, the Keychain). No
third-party packages, no web view.

- `Daythread.xcodeproj`: the app (`Daythread`; iPhone, iPad, Mac Catalyst; iOS 26), its unit tests hosted in the app
  (`Tests/`) and its UI tests (`UITests/`). The `App/`, `Tests/` and `UITests/` folders are synchronised groups: a file
  added there is in the target without a project edit.
- `Packages/`: `DaythreadCore` (records, lossless JSON), `DaythreadSync` (server client, Keychain, store on the device,
  `SyncEngine`), `DaythreadEditor` (a page's rows; a line's words are typed into, one row at a time, and a to-do's
  circle ticks), `DaythreadUI` (the screens and `AppModel`). Each package's own tests run with `swift test` in its
  folder.

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
`http://127.0.0.1:3000` (`npm run dev`, sign-in off), Release `https://daythread.dogrod.com`. In a Debug build only, a
launch argument overrides it and another picks the store file; a Release build always uses the `Info.plist` value:

```sh
xcrun simctl launch <simulator> app.daythread.Daythread \
  -DaythreadServerURL http://127.0.0.1:3741 -DaythreadStoreName scratch
```

To run your own server on another port, start it the way `scripts/ui-test.sh` does: `DAYTHREAD_STORAGE=sqlite`,
`DAYTHREAD_SQLITE_PATH` and `DAYTHREAD_LOCAL_DATA_PATH` in a throwaway directory, `vite --port <port>`.

## Tests

```sh
native/scripts/ui-test.sh                                                       # unit and UI tests
native/scripts/ui-test.sh -only-testing:DaythreadUITests                        # extra arguments go to xcodebuild
native/scripts/ui-test.sh -only-testing:DaythreadUITests/TickUITests/test_a_tap_ticks_and_a_second_tap_unticks
native/scripts/ui-test.sh --serve                                               # the seeded servers only, until Ctrl-C
```

The wrapper starts two throwaway servers from this checkout, each on SQLite in a directory under the system temp
directory: 3741 with sign-in off, seeded with today's page and its to-dos, and 3742 with sign-in on. "Water the
plants" is only read by the tests; each test that ticks has a to-do of its own ("Tick me offline", "Tick me twice";
"Tick me" is left for looking by hand), since the seed is shared by every test and never reset. It passes the
addresses and the seeded day to the UI tests (`TEST_RUNNER_DAYTHREAD_SERVER_URL`,
`TEST_RUNNER_DAYTHREAD_SIGN_IN_SERVER_URL`, `TEST_RUNNER_DAYTHREAD_TODAY`), runs
`xcodebuild test`, and on exit stops both servers, removes their directories and removes the stores the tests made in
the app's container. Run any other way, the UI tests skip. The app hosting the unit tests is pointed at `127.0.0.1:9`,
where nothing listens. A full run takes a few minutes; `-only-testing:` runs one class or one test.

The UI tests read the server the way any client does (`GET /api/v1/workspace` on 3741, where sign-in is off). Offline
is a launch with `-DaythreadServerURL http://127.0.0.1:9` and the same `-DaythreadStoreName` as the launch before it.

The writing tests (`UITests/WritingUITests.swift`) type into today's page and read the page back from the server:
each types words of its own, at the end of the page under Notes or in the template's empty to-do, since the seed is
shared and never reset. The one that changes the page "on another device" saves it through `POST /api/v1/saves`
with the page's revision and content key read first (`SeededServer.save` in `UITests/Launch.swift`, which holds its
own copy of the web's `textKey`). The simulator keeps the keyboard last used: the tests turn it to English with the
globe key before typing, and the Chinese test turns it to Pinyin and taps the keys one by one (`typeText` would put
the letters in past the input method), then back. They need the simulator's keyboard list to hold
`zh_Hans-Pinyin@sw=Pinyin` after English (Settings, General, Keyboard, Keyboards); the test changes nothing there.

## How typing feels

`Tests/TypingFeelTests.swift` times a keystroke to the list laid out again, 50 characters into the 150th line of a
page of 300 lines and, for comparison, the 5th of 10, five runs each, with the engine and a store on disk real and a
server that never answers. It prints each run and the median (search the output for `TypingFeel:`). It only measures
unless asked to hold the budget, one and a half times the medians measured on the machine that set it (written in
the test):

```sh
TEST_RUNNER_DAYTHREAD_FEEL_BUDGET=1 xcodebuild test -project native/Daythread.xcodeproj -scheme Daythread \
  -only-testing:DaythreadTests/TypingFeelTests \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -derivedDataPath native/DerivedData
```

Leave it off in CI and on other machines: their times differ, and a budget from this Mac would only be noise there.

`--serve` seeds the same two servers and keeps them until Ctrl-C, for looking at the app by hand: launch it with
`xcrun simctl launch <simulator> app.daythread.Daythread -DaythreadServerURL http://127.0.0.1:3741
-DaythreadStoreName test-<anything>` (a `test-` store is removed when the wrapper stops). Screenshots:
`xcrun simctl io <simulator> screenshot <file>.png`.

The UI tests are not run in CI: they need the simulator and the local servers. Run them before merging a change to
the app's screens.

Rules for a shared machine:

- Port 3000 and `.daythread-local/` belong to the server you use day to day: tests never start anything on 3000,
  never point the app at it, and never read that directory.
- One simulator: `iPhone 17`, iOS 26.5, named in the wrapper (`DAYTHREAD_SIMULATOR_NAME` and
  `DAYTHREAD_SIMULATOR_OS` override it). Leave the other simulators alone; put its appearance and text size back if you
  change them.
- Build output goes to `native/DerivedData` (ignored).

## On the device

The server's origin (scheme, host and port) is part of who you are signed in to: the store and the session are named
after it, so a build pointed at one server and later at another keeps two copies and two sessions, and never sends one
server's token to the other. The origin's slug is the origin lower-cased with every character outside `[a-z0-9.-]`
replaced by `-` (`https://daythread.dogrod.com` is `https---daythread.dogrod.com`).

- The store: `Application Support/Daythread/workspace-<slug>.store` (in a Debug build, `<name>.store` with
  `-DaythreadStoreName`), left out of backups, and on iPhone and iPad readable once the device has been unlocked after
  a restart. In the simulator: `xcrun simctl get_app_container <simulator> app.daythread.Daythread data`, then
  `Library/Application Support/Daythread`.
- The session: one Keychain item, service `app.daythread.Daythread.<slug>`, readable once the device has been unlocked
  after a restart, and on this device only (no backup, no migration).

## When a load fails

With nothing on the device to show, a failed load shows "Couldn't load" and a "Retry" button; with a copy shown, the
prompt reads "Offline · showing what was last loaded" or, for any other failure, "Couldn't update · showing what was
last loaded". The app refreshes whenever it becomes active. The sync engine logs each pass, each failure (its case and
status), each outbox outcome (operation id and outcome) and each sign-in and sign-out under subsystem
`app.daythread.Daythread`, category `sync`, never a token, a title or a document's text; a workspace that does not
read is logged with the row and field that failed:

```sh
xcrun simctl spawn <simulator> log show --last 1h --info \
  --predicate 'subsystem == "app.daythread.Daythread" AND category == "sync"'
```

## The audit

Debug builds check, for each new revision of the workspace, that every page's document writes back byte for byte,
and log the result under subsystem `app.daythread.Daythread`, category `audit`:

```sh
xcrun simctl spawn <simulator> log show --last 1h --info \
  --predicate 'subsystem == "app.daythread.Daythread" AND category == "audit"'
```

When any page fails, the More menu (`ellipsis`, the navigation bar's last item) gains a first row, "Round trip · N
of M pages fail".

The More menu offers "Sign out" only while a session is stored (never against a server with sign-in off); with
nothing to put in it, the More button is not shown.
