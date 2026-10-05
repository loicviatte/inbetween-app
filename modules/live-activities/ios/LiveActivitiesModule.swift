import ExpoModulesCore
import ActivityKit
import Foundation

public class LiveActivitiesModule: Module {
  // Activities whose push token we already follow (the app's own, and the
  // ones the server starts by push-to-start).
  private var observed = Set<String>()
  private let observedLock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("LiveActivities")

    // A mic-pending activity's push token, as Apple hands it over (and again
    // whenever it rotates) — the server pushes the lesson's later steps to it.
    Events("onMicPendingPushToken", "onMicPendingPushToStartToken")

    OnCreate {
      if #available(iOS 16.2, *) {
        for activity in Activity<MicPendingAttributes>.activities {
          self.observePushToken(activity)
        }
      }
      if #available(iOS 17.2, *) {
        // The token the server uses to START an activity on this phone
        // (live-activity-restart), handed over again whenever it rotates.
        Task { [weak self] in
          for await data in Activity<MicPendingAttributes>.pushToStartTokenUpdates {
            self?.sendEvent("onMicPendingPushToStartToken", ["token": hex(data)])
          }
        }
        // An activity the server started: follow its update token too.
        Task { [weak self] in
          for await activity in Activity<MicPendingAttributes>.activityUpdates {
            self?.observePushToken(activity)
          }
        }
      }
    }

    AsyncFunction("startCoachRecording") { (params: [String: Any], promise: Promise) in
      guard #available(iOS 16.2, *) else { promise.resolve(nil); return }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        promise.reject("E_LA_DISABLED", "Live Activities are disabled in iOS Settings")
        return
      }
      let kind = (params["kind"] as? String) ?? "private"
      let studentName = params["studentName"] as? String
      let startedAtMs = (params["startedAt"] as? Double) ?? (Date().timeIntervalSince1970 * 1000)
      let attrs = CoachRecordingAttributes()
      let state = CoachRecordingAttributes.ContentState(
        startedAt: Date(timeIntervalSince1970: startedAtMs / 1000),
        studentName: studentName,
        isPrivate: kind == "private",
        isInterrupted: false
      )
      do {
        let activity = try Activity.request(
          attributes: attrs,
          content: .init(state: state, staleDate: nil),
          pushType: nil
        )
        promise.resolve(activity.id)
      } catch {
        promise.reject("E_LA_START", error.localizedDescription)
      }
    }

    AsyncFunction("updateCoachRecording") { (params: [String: Any], promise: Promise) in
      guard #available(iOS 16.2, *) else { promise.resolve(nil); return }
      let activityId = params["activityId"] as? String
      let isInterrupted = params["isInterrupted"] as? Bool
      let staleSeconds = params["staleSeconds"] as? Double
      Task {
        for activity in Activity<CoachRecordingAttributes>.activities where activity.id == activityId {
          var newState = activity.content.state
          if let v = isInterrupted { newState.isInterrupted = v }
          let staleDate: Date? = staleSeconds.map { Date().addingTimeInterval($0) }
          await activity.update(.init(state: newState, staleDate: staleDate))
          break
        }
        promise.resolve(nil)
      }
    }

    AsyncFunction("endCoachRecording") { (params: [String: Any], promise: Promise) in
      guard #available(iOS 16.2, *) else { promise.resolve(nil); return }
      let activityId = params["activityId"] as? String
      Task {
        for activity in Activity<CoachRecordingAttributes>.activities where activity.id == activityId {
          await activity.end(nil, dismissalPolicy: .immediate)
          break
        }
        promise.resolve(nil)
      }
    }

    AsyncFunction("getActiveCoachRecordings") { (promise: Promise) in
      guard #available(iOS 16.2, *) else { promise.resolve([]); return }
      let ids = Activity<CoachRecordingAttributes>.activities.map { $0.id }
      promise.resolve(ids)
    }

    AsyncFunction("endAllCoachRecordings") { (promise: Promise) in
      guard #available(iOS 16.2, *) else { promise.resolve(nil); return }
      Task {
        for activity in Activity<CoachRecordingAttributes>.activities {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
        promise.resolve(nil)
      }
    }

    // ─── Mic pending (a lesson's road from class to focus points) ─────────
    // One activity at a time: start creates it, update rewrites its state,
    // end closes it.

    AsyncFunction("startMicPending") { (params: [String: Any], promise: Promise) in
      guard #available(iOS 16.2, *) else { promise.resolve(nil); return }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        promise.reject("E_LA_DISABLED", "Live Activities are disabled in iOS Settings")
        return
      }
      do {
        let activity = try Activity.request(
          attributes: MicPendingAttributes(),
          content: .init(state: micPendingState(params), staleDate: nil),
          pushType: .token
        )
        self.observePushToken(activity)
        promise.resolve(activity.id)
      } catch {
        promise.reject("E_LA_START", error.localizedDescription)
      }
    }

    AsyncFunction("updateMicPending") { (params: [String: Any], promise: Promise) in
      guard #available(iOS 16.2, *) else { promise.resolve(0); return }
      let state = micPendingState(params)
      Task {
        var updated = 0
        for activity in Activity<MicPendingAttributes>.activities where activity.activityState == .active {
          await activity.update(.init(state: state, staleDate: nil))
          updated += 1
        }
        promise.resolve(updated)
      }
    }

    AsyncFunction("endMicPending") { (promise: Promise) in
      guard #available(iOS 16.2, *) else { promise.resolve(nil); return }
      Task {
        for activity in Activity<MicPendingAttributes>.activities {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
        promise.resolve(nil)
      }
    }

    // The tokens already known, for activities started in an earlier run.
    AsyncFunction("micPendingPushTokens") { (promise: Promise) in
      guard #available(iOS 16.2, *) else { promise.resolve([]); return }
      let list: [[String: String]] = Activity<MicPendingAttributes>.activities.compactMap { activity in
        guard activity.activityState == .active, let token = activity.pushToken else { return nil }
        return ["activityId": activity.id, "token": hex(token)]
      }
      promise.resolve(list)
    }

    // The push-to-start token, when iOS already gave one (iOS 17.2+).
    AsyncFunction("micPendingPushToStartToken") { (promise: Promise) in
      if #available(iOS 17.2, *) {
        promise.resolve(Activity<MicPendingAttributes>.pushToStartToken.map { hex($0) })
      } else {
        promise.resolve(nil)
      }
    }

    // Which of Apple's push environments this build talks to: a development-
    // signed build (local, Xcode) uses the sandbox; TestFlight and the App
    // Store carry no embedded profile and use production.
    Function("apnsEnvironment") { () -> String in
      return apnsEnvironment()
    }

    AsyncFunction("startFocusPoint") { (params: [String: Any], promise: Promise) in
      guard #available(iOS 16.2, *) else { promise.resolve(nil); return }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        promise.reject("E_LA_DISABLED", "Live Activities are disabled in iOS Settings")
        return
      }
      let name = (params["focusPointName"] as? String) ?? "Focus point"
      let startedAtMs = (params["startedAt"] as? Double) ?? (Date().timeIntervalSince1970 * 1000)
      let targetSec = params["targetSec"] as? Double
      let started = Date(timeIntervalSince1970: startedAtMs / 1000)
      let endsAt: Date? = targetSec.map { started.addingTimeInterval($0) }
      let attrs = FocusPointAttributes()
      let state = FocusPointAttributes.ContentState(
        startedAt: started,
        endsAt: endsAt,
        focusPointName: name,
        isPaused: false,
        targetReached: false
      )
      do {
        let activity = try Activity.request(
          attributes: attrs,
          content: .init(state: state, staleDate: nil),
          pushType: nil
        )
        promise.resolve(activity.id)
      } catch {
        promise.reject("E_LA_START", error.localizedDescription)
      }
    }

    AsyncFunction("updateFocusPoint") { (params: [String: Any], promise: Promise) in
      guard #available(iOS 16.2, *) else { promise.resolve(nil); return }
      let activityId = params["activityId"] as? String
      let isPaused = params["isPaused"] as? Bool
      Task {
        for activity in Activity<FocusPointAttributes>.activities where activity.id == activityId {
          var newState = activity.content.state
          if let v = isPaused { newState.isPaused = v }
          await activity.update(.init(state: newState, staleDate: nil))
          break
        }
        promise.resolve(nil)
      }
    }

    AsyncFunction("endFocusPoint") { (params: [String: Any], promise: Promise) in
      guard #available(iOS 16.2, *) else { promise.resolve(nil); return }
      let activityId = params["activityId"] as? String
      let targetReached = (params["targetReached"] as? Bool) ?? false
      Task {
        for activity in Activity<FocusPointAttributes>.activities where activity.id == activityId {
          var finalState = activity.content.state
          finalState.targetReached = targetReached
          await activity.end(.init(state: finalState, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(4)))
          break
        }
        promise.resolve(nil)
      }
    }
  }

  @available(iOS 16.2, *)
  private func observePushToken(_ activity: Activity<MicPendingAttributes>) {
    observedLock.lock()
    let isNew = observed.insert(activity.id).inserted
    observedLock.unlock()
    guard isNew else { return }
    Task { [weak self] in
      for await token in activity.pushTokenUpdates {
        self?.sendEvent("onMicPendingPushToken", ["activityId": activity.id, "token": hex(token)])
      }
    }
  }
}

@available(iOS 16.2, *)
private func micPendingState(_ params: [String: Any]) -> MicPendingAttributes.ContentState {
  return MicPendingAttributes.ContentState(
    stage: (params["stage"] as? String) ?? "waiting",
    progress: min(1, max(0, (params["progress"] as? Double) ?? 0.6)),
    title: (params["title"] as? String) ?? "No audio yet",
    detail: (params["detail"] as? String) ?? "",
    badge: params["badge"] as? String,
    cta: params["cta"] as? String,
    link: (params["link"] as? String) ?? "inbetween://mic-sync"
  )
}

private func hex(_ data: Data) -> String {
  data.map { String(format: "%02x", $0) }.joined()
}

private func apnsEnvironment() -> String {
  guard
    let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
    let data = try? Data(contentsOf: url),
    // The profile is a signed plist; its XML sits in the clear inside.
    let text = String(data: data, encoding: .isoLatin1)
  else { return "production" }
  let pattern = "<key>aps-environment</key>\\s*<string>development</string>"
  return text.range(of: pattern, options: .regularExpression) != nil ? "sandbox" : "production"
}
