import ActivityKit
import Foundation

public struct FocusPointAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var startedAt: Date
    public var endsAt: Date?    // nil = open session (no target)
    public var focusPointName: String
    public var isPaused: Bool
    public var targetReached: Bool

    public init(startedAt: Date, endsAt: Date?, focusPointName: String, isPaused: Bool, targetReached: Bool) {
      self.startedAt = startedAt
      self.endsAt = endsAt
      self.focusPointName = focusPointName
      self.isPaused = isPaused
      self.targetReached = targetReached
    }
  }

  public init() {}
}
