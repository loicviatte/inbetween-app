import ActivityKit
import WidgetKit
import SwiftUI

@available(iOS 16.2, *)
struct FocusPointLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: FocusPointAttributes.self) { context in
      FocusLockScreenView(state: context.state)
        .activityBackgroundTint(Color.white)
        .activitySystemActionForegroundColor(InBetweenTheme.ink)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 10) {
            ZStack {
              Circle().fill(InBetweenTheme.orange)
              Image(systemName: "scope")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(InBetweenTheme.ink)
            }
            .frame(width: 32, height: 32)
            VStack(alignment: .leading, spacing: 2) {
              Text(context.state.focusPointName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)
              Text("Focus point")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white.opacity(0.55))
            }
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 2) {
            timerText(context.state, size: 19)
              .foregroundColor(.white)
              .lineLimit(1)
              .minimumScaleFactor(0.7)
              .frame(minWidth: 64, alignment: .trailing)
            Text(captionText(context.state))
              .font(.system(size: 9.5, weight: .medium))
              .tracking(0.8)
              .foregroundColor(.white.opacity(0.50))
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack(spacing: 10) {
            if let endsAt = context.state.endsAt {
              ProgressView(timerInterval: context.state.startedAt...endsAt, countsDown: false)
                .tint(InBetweenTheme.orange)
                .labelsHidden()
                .progressViewStyle(.linear)
            } else {
              HStack(spacing: 8) {
                Image(systemName: "infinity")
                  .font(.system(size: 11, weight: .semibold))
                  .foregroundColor(InBetweenTheme.orange)
                Text("Open session")
                  .font(.system(size: 12, weight: .medium))
                  .foregroundColor(.white.opacity(0.62))
                Spacer()
              }
            }
          }
          .padding(.top, 6)
        }
      } compactLeading: {
        Image(systemName: "scope")
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(InBetweenTheme.orange)
      } compactTrailing: {
        timerText(context.state, size: 13)
          .foregroundColor(.white)
          .frame(maxWidth: 54)
          .padding(.leading, 14)
          .padding(.trailing, 2)
      } minimal: {
        Image(systemName: "scope")
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(InBetweenTheme.orange)
      }
      .keylineTint(InBetweenTheme.orange)
    }
  }
}

@available(iOS 16.2, *)
@ViewBuilder
private func timerText(_ s: FocusPointAttributes.ContentState, size: CGFloat) -> some View {
  if let endsAt = s.endsAt {
    Text(timerInterval: s.startedAt...endsAt, countsDown: true)
      .font(.system(size: size, weight: .semibold).monospacedDigit())
      .multilineTextAlignment(.trailing)
  } else {
    Text(s.startedAt, style: .timer)
      .font(.system(size: size, weight: .semibold).monospacedDigit())
      .multilineTextAlignment(.trailing)
  }
}

private func captionText(_ s: FocusPointAttributes.ContentState) -> String {
  s.endsAt == nil ? "ELAPSED" : "REMAINING"
}

private func captionLetterSpacing(_ s: FocusPointAttributes.ContentState) -> CGFloat {
  s.endsAt == nil ? 1.0 : 1.0
}

@available(iOS 16.2, *)
struct FocusLockScreenView: View {
  let state: FocusPointAttributes.ContentState

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
            .foregroundColor(InBetweenTheme.ink.opacity(0.55))
        }
        Spacer()
        HStack(spacing: 7) {
          Image(systemName: "scope")
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(InBetweenTheme.orange)
          Text("FOCUS")
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.0)
            .foregroundColor(InBetweenTheme.orange)
        }
      }

      HStack(alignment: .center, spacing: 14) {
        ZStack {
          Circle().fill(InBetweenTheme.orange)
          Image(systemName: "scope")
            .font(.system(size: 22, weight: .semibold))
            .foregroundColor(InBetweenTheme.ink)
        }
        .frame(width: 46, height: 46)
        VStack(alignment: .leading, spacing: 3) {
          Text(state.focusPointName)
            .font(.system(size: 18, weight: .semibold))
            .foregroundColor(InBetweenTheme.ink)
            .lineLimit(1)
            .truncationMode(.tail)
          Text("Focus point")
            .font(.system(size: 12.5, weight: .medium))
            .foregroundColor(InBetweenTheme.ink.opacity(0.55))
            .lineLimit(1)
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 2) {
          timerText(state, size: 22)
            .foregroundColor(InBetweenTheme.ink)
            .lineLimit(1)
            .multilineTextAlignment(.trailing)
            .frame(minWidth: 76, alignment: .trailing)
          Text(captionText(state))
            .font(.system(size: 10, weight: .medium))
            .tracking(1.0)
            .foregroundColor(InBetweenTheme.ink.opacity(0.50))
        }
      }
      .padding(.top, 14)

      if let endsAt = state.endsAt {
        ProgressView(timerInterval: state.startedAt...endsAt, countsDown: false)
          .tint(InBetweenTheme.orange)
          .labelsHidden()
          .progressViewStyle(.linear)
          .padding(.top, 12)
          .overlay(alignment: .top) {
            Rectangle().fill(InBetweenTheme.hairlineLight).frame(height: 0.5)
          }
      }
    }
    .padding(16)
  }
}
