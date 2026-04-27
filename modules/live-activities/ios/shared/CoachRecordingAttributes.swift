import ActivityKit
import Foundation

public struct CoachRecordingAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var startedAt: Date
    public var studentName: String?
    public var isPrivate: Bool
    public var isInterrupted: Bool

    public init(startedAt: Date, studentName: String?, isPrivate: Bool, isInterrupted: Bool) {
      self.startedAt = startedAt
      self.studentName = studentName
      self.isPrivate = isPrivate
      self.isInterrupted = isInterrupted
    }
  }

  public init() {}
}
