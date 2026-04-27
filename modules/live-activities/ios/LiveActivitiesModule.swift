import ExpoModulesCore
import ActivityKit
import Foundation

public class LiveActivitiesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveActivities")

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
}
