import ActivityKit
import Foundation

// A lesson's road from the end of class to focus points the coach can
// validate: waiting for the DJI mic's audio → sending it → finding focus
// points → ready. One activity covers the coach's lessons; the app rewrites
// its state wholesale. The words come from the app (so they can change without
// a build); the widget only decides colours, icons and the rail from `stage`.
public struct MicPendingAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    // "waiting" | "uploading" | "extracting" | "ready"
    public var stage: String
    // Overall, 0...1 — Lesson weighs 60%, Mic audio 20%, Focus points 20%.
    public var progress: Double
    public var title: String
    public var detail: String
    // Compact Dynamic Island text in place of the percentage ("Plug mic").
    public var badge: String?
    // The button's label; no button when nil.
    public var cta: String?
    // Where a tap goes (an inbetween:// link).
    public var link: String

    public init(stage: String, progress: Double, title: String, detail: String, badge: String?, cta: String?, link: String) {
      self.stage = stage
      self.progress = progress
      self.title = title
      self.detail = detail
      self.badge = badge
      self.cta = cta
      self.link = link
    }
  }

  public init() {}
}
