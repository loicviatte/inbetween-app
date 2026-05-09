# live-activities — InBetween iOS Live Activities

Two ActivityKit Live Activities + Dynamic Island presentations:
- **Coach recording** (red, mic) — surfaced while a coach records a class
- **Focus point** (orange, scope) — surfaced while a student practices a focus point

## Architecture

```
modules/live-activities/
├── index.ts                          JS API (consumed by app)
├── ios/
│   ├── LiveActivities.podspec        Pod that linked into the main app
│   ├── LiveActivitiesModule.swift    Expo module — start/update/end
│   ├── shared/                       Shared between app + widget extension
│   │   ├── CoachRecordingAttributes.swift
│   │   └── FocusPointAttributes.swift
│   └── widget/                       Widget Extension target sources
│       ├── InBetweenLiveActivities.swift   (@main bundle)
│       ├── CoachRecordingLiveActivity.swift
│       ├── FocusPointLiveActivity.swift
│       ├── Theme.swift
│       └── Info.plist
```

The **podspec** only links `LiveActivitiesModule.swift` + `shared/*.swift` into the main app. The Widget Extension is a **separate Xcode target** you must add manually — `pod install` does not create extension targets.

## Manual Xcode setup (one-time)

Live Activities require a Widget Extension target. Since this project commits `ios/` (no `expo prebuild`), the target must be added by hand in Xcode.

### 1. Add the Widget Extension target

1. Open `ios/InBetween.xcworkspace` in Xcode.
2. **File → New → Target…**
3. Pick **Widget Extension**. Click Next.
4. Product Name: `InBetweenLiveActivities`
5. Team: same as the main app (Apple Team ID `66DQR8326F`).
6. Bundle Identifier: leave default — it should resolve to `com.loicviatte.inbetweenapp.InBetweenLiveActivities`.
7. **Uncheck** "Include Configuration Intent" — we don't use it.
8. **Check** "Include Live Activity".
9. Activate the new scheme when prompted: **Activate**.

Xcode generates a stub `InBetweenLiveActivities/` folder at `ios/InBetweenLiveActivities/`.

### 2. Replace the stub sources with our files

In Finder:
- Delete every `.swift` file Xcode generated inside `ios/InBetweenLiveActivities/` (keep `Assets.xcassets` and `Info.plist` if you want — we'll override `Info.plist`).
- Drag the four files from `modules/live-activities/ios/widget/` into the `InBetweenLiveActivities` group in Xcode:
  - `InBetweenLiveActivities.swift`
  - `CoachRecordingLiveActivity.swift`
  - `FocusPointLiveActivity.swift`
  - `Theme.swift`
- In the dialog: **uncheck** "Copy items if needed", select **Create groups**, target = **InBetweenLiveActivities only**.
- Replace the stub `Info.plist` with the one from `modules/live-activities/ios/widget/Info.plist`.

### 3. Add the shared ActivityAttributes to BOTH targets

This is the critical step. The `*Attributes.swift` files must compile into both the main app **and** the widget extension.

In Xcode:
- Drag `modules/live-activities/ios/shared/CoachRecordingAttributes.swift` into the project navigator.
- In the dialog: **uncheck** "Copy items if needed", select **Create groups**, **check both targets** (`InBetween` and `InBetweenLiveActivities`).
- Repeat for `FocusPointAttributes.swift`.

(They are already linked to the main app via the podspec, but Xcode-added file membership wins. Easiest is to check both target memberships in the File Inspector after dragging.)

### 4. Set deployment target & capabilities

- Select the `InBetweenLiveActivities` target → **Deployment Info** → iOS **16.2** minimum.
- Main app target: ensure deployment target is also at least **16.2** (Live Activities require it).

### 5. Build settings sanity check

For the `InBetweenLiveActivities` target:
- **Skip Install** = `YES`
- **Embed in Containing Application** = automatic (Xcode handles)

For the main app target, in **Build Phases → Embed Foundation Extensions**, confirm `InBetweenLiveActivities.appex` is listed.

### 6. Provisioning

EAS will need to know about the new bundle ID. After your next `eas build`:
- Bundle IDs = `com.loicviatte.inbetweenapp` AND `com.loicviatte.inbetweenapp.InBetweenLiveActivities`
- Both must have a provisioning profile under your Apple Team.
- If EAS prompts, let it generate them automatically (EAS handles widget extension bundle IDs).

### 7. Build & test

```bash
# Run a fresh EAS build (Live Activities need a real device + dev client / TestFlight)
eas build --platform ios --profile development
```

Test on a real iPhone (iOS 16.2+, Dynamic Island appears on iPhone 14 Pro / 15 Pro / 16 Pro). The simulator works for Lock Screen but not for Dynamic Island.

## When iOS regenerates `ios/`

If you ever run `npx expo prebuild --clean`, the manually-added Widget Extension target **will be wiped**. Two options:
1. Don't run `prebuild --clean` (current strategy — `ios/` is committed).
2. Or write a config plugin that re-adds the target programmatically (see `plugins/withAudioRoutePicker.js` for the pattern; adding extension targets is significantly more involved).

## v1 limitations (intentional)

- **No Stop button in the LA itself.** Tap the activity to open the app, stop from there. Adding it requires App Intents (iOS 17+) and another target — punted to v2.
- **No Android equivalent.** `index.ts` short-circuits on non-iOS — no errors, no notifications. Persistent foreground notification is a separate v2 task.
- **No push updates.** All updates go through the Expo module (local). Fine because both activities live alongside an active app session.
