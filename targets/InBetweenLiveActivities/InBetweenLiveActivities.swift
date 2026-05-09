import WidgetKit
import SwiftUI

@main
struct InBetweenLiveActivitiesBundle: WidgetBundle {
  var body: some Widget {
    if #available(iOS 16.2, *) {
      CoachRecordingLiveActivity()
      FocusPointLiveActivity()
    }
  }
}
