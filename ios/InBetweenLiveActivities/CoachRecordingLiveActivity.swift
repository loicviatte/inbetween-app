import ActivityKit
import WidgetKit
import SwiftUI

@available(iOS 16.2, *)
struct CoachRecordingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: CoachRecordingAttributes.self) { context in
      CoachLockScreenView(state: context.state)
        .activityBackgroundTint(Color(hex: 0x1C1C1E))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 10) {
            CoachAvatar(state: context.state)
              .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 3) {
              HStack(spacing: 6) {
                Circle()
                  .fill(context.state.isInterrupted ? InBetweenTheme.gray : InBetweenTheme.red)
                  .frame(width: 6, height: 6)
                Text(context.state.isInterrupted ? "PAUSED" : "REC")
                  .font(.system(size: 9.5, weight: .bold))
                  .tracking(1.0)
                  .foregroundColor(context.state.isInterrupted ? InBetweenTheme.gray : InBetweenTheme.red)
              }
              Text(coachTitle(context.state))
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)
                .truncationMode(.tail)
              Text(context.state.isPrivate ? "Private lesson" : "Group class")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white.opacity(0.55))
                .lineLimit(1)
            }
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 2) {
            Text(context.state.startedAt, style: .timer)
              .font(.system(size: 20, weight: .semibold).monospacedDigit())
              .foregroundColor(.white)
              .multilineTextAlignment(.trailing)
              .lineLimit(1)
              .minimumScaleFactor(0.7)
              .frame(minWidth: 68, alignment: .trailing)
            Text("ELAPSED")
              .font(.system(size: 9.5, weight: .medium))
              .tracking(0.8)
              .foregroundColor(.white.opacity(0.50))
          }
          .padding(.top, 4)
        }
      } compactLeading: {
        Image(systemName: "mic.fill")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(InBetweenTheme.red)
      } compactTrailing: {
        HStack(spacing: 4) {
          Circle()
            .fill(context.state.isInterrupted ? InBetweenTheme.gray : InBetweenTheme.red)
            .frame(width: 6, height: 6)
          Text(context.state.startedAt, style: .timer)
            .font(.system(size: 13, weight: .semibold).monospacedDigit())
            .foregroundColor(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: 56)
      } minimal: {
        Image(systemName: "mic.fill")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(InBetweenTheme.red)
      }
      .keylineTint(InBetweenTheme.red)
    }
  }
}

private func coachTitle(_ s: CoachRecordingAttributes.ContentState) -> String {
  if !s.isPrivate { return "Group class" }
  return s.studentName?.isEmpty == false ? s.studentName! : "Private lesson"
}

@available(iOS 16.2, *)
private struct CoachAvatar: View {
  let state: CoachRecordingAttributes.ContentState
  var body: some View {
    ZStack {
      Circle().fill(
        LinearGradient(
          colors: [Color(hex: 0xE26A6A), Color(hex: 0xA83333)],
          startPoint: .topLeading, endPoint: .bottomTrailing
        )
      )
      if state.isPrivate {
        Text(initials(from: state.studentName))
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(.white)
      } else {
        Image(systemName: "person.2.fill")
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(.white)
      }
    }
  }
}

@available(iOS 16.2, *)
struct CoachLockScreenView: View {
  let state: CoachRecordingAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        HStack(spacing: 8) {
          Image("InBetweenLogo")
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: 18, height: 18)
          Text("InBetween")
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(.white.opacity(0.55))
        }
        Spacer()
        HStack(spacing: 7) {
          Circle()
            .fill(state.isInterrupted ? InBetweenTheme.gray : InBetweenTheme.red)
            .frame(width: 8, height: 8)
          Text(state.isInterrupted ? "PAUSED" : "REC")
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.0)
            .foregroundColor(state.isInterrupted ? InBetweenTheme.gray : InBetweenTheme.red)
        }
      }

      HStack(alignment: .center, spacing: 14) {
        CoachAvatar(state: state)
          .frame(width: 46, height: 46)
        VStack(alignment: .leading, spacing: 3) {
          Text(coachTitle(state))
            .font(.system(size: 18, weight: .semibold))
            .foregroundColor(.white)
            .lineLimit(1)
          Text(state.isPrivate ? "Private lesson" : "Group class")
            .font(.system(size: 12.5, weight: .medium))
            .foregroundColor(.white.opacity(0.55))
            .lineLimit(1)
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 2) {
          Text(state.startedAt, style: .timer)
            .font(.system(size: 22, weight: .semibold).monospacedDigit())
            .foregroundColor(.white)
            .lineLimit(1)
            .multilineTextAlignment(.trailing)
            .frame(minWidth: 76, alignment: .trailing)
          Text("ELAPSED")
            .font(.system(size: 10, weight: .medium))
            .tracking(1.0)
            .foregroundColor(.white.opacity(0.50))
        }
      }
      .padding(.top, 14)
    }
    .padding(16)
  }
}
