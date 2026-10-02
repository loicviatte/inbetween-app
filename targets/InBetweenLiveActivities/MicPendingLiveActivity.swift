import ActivityKit
import WidgetKit
import SwiftUI

// The lesson's road after class, as one rail split by weight: Lesson 60 ·
// Mic audio 20 · Focus points 20. The overall % sits top-right, so the step
// labels only say where you are. Waiting for the mic is the one state that
// needs the coach, so it alone turns red and carries a button.

private typealias MicState = MicPendingAttributes.ContentState

private enum Palette {
  static let gold = Color(hex: 0xE8B530)
  static let red = Color(hex: 0xE5484D)
  static let redText = Color(hex: 0xFF6B6F)
  static let ink = Color(hex: 0x0A0A0A)
  static let card = Color(hex: 0x1C1C1E, alpha: 0.92)
  static let alertCard = Color(hex: 0x301618, alpha: 0.94)
  static let track = Color.white.opacity(0.12)
}

private func syne(_ weight: Font.Weight, _ size: CGFloat) -> Font {
  switch weight {
  case .bold: return .custom("Syne-Bold", size: size)
  case .semibold: return .custom("Syne-SemiBold", size: size)
  default: return .custom("Syne-Regular", size: size)
  }
}

private func isAlert(_ s: MicState) -> Bool { s.stage == "waiting" }
private func isReady(_ s: MicState) -> Bool { s.stage == "ready" }

private func clamp01(_ v: Double) -> Double { min(1, max(0, v)) }

// How full each of the three rail segments is.
private func segments(_ s: MicState) -> (Double, Double, Double) {
  switch s.stage {
  case "uploading": return (1, clamp01((s.progress - 0.6) / 0.2), 0)
  case "extracting": return (1, 1, clamp01((s.progress - 0.8) / 0.2))
  case "ready": return (1, 1, 1)
  default: return (1, 0, 0)
  }
}

private func percentText(_ s: MicState) -> String {
  "\(Int((clamp01(s.progress) * 100).rounded()))%"
}

private func url(_ s: MicState) -> URL? { URL(string: s.link) }

// ─── Icons, drawn from the design's 24×24 strokes ───────────────────────

private enum Glyph { case mic, upload, pulse, check }

private struct GlyphShape: Shape {
  let glyph: Glyph
  func path(in rect: CGRect) -> Path {
    let k = min(rect.width, rect.height) / 24
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * k, y: rect.minY + y * k) }
    var path = Path()
    switch glyph {
    case .mic:
      path.addRoundedRect(in: CGRect(x: rect.minX + 9 * k, y: rect.minY + 3 * k, width: 6 * k, height: 11 * k),
                          cornerSize: CGSize(width: 3 * k, height: 3 * k))
      path.move(to: p(5.5, 11))
      path.addArc(center: p(12, 11), radius: 6.5 * k, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
      path.move(to: p(12, 17.5)); path.addLine(to: p(12, 21))
      path.move(to: p(8.5, 21)); path.addLine(to: p(15.5, 21))
    case .upload:
      path.move(to: p(12, 16)); path.addLine(to: p(12, 4))
      path.move(to: p(7, 9)); path.addLine(to: p(12, 4)); path.addLine(to: p(17, 9))
      path.move(to: p(5, 20)); path.addLine(to: p(19, 20))
    case .pulse:
      path.move(to: p(3, 12)); path.addLine(to: p(5.5, 12)); path.addLine(to: p(7.5, 7))
      path.addLine(to: p(10.5, 17)); path.addLine(to: p(13.5, 5)); path.addLine(to: p(16.5, 14))
      path.addLine(to: p(18.5, 12)); path.addLine(to: p(21, 12))
    case .check:
      path.move(to: p(5, 12.5)); path.addLine(to: p(9.5, 17)); path.addLine(to: p(19, 7.5))
    }
    return path
  }
}

private struct GlyphView: View {
  let glyph: Glyph
  var lineWidth: CGFloat = 2
  var body: some View {
    GlyphShape(glyph: glyph)
      .stroke(style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
  }
}

private func glyph(_ s: MicState) -> Glyph {
  switch s.stage {
  case "uploading": return .upload
  case "extracting": return .pulse
  case "ready": return .check
  default: return .mic
  }
}

// ─── Pieces ─────────────────────────────────────────────────────────────

private struct StageIcon: View {
  let state: MicState
  var body: some View {
    let fill: Color = isAlert(state) ? Palette.red : isReady(state) ? Palette.gold : Color.white.opacity(0.08)
    let ink: Color = isReady(state) ? Palette.ink : .white
    ZStack {
      if isAlert(state) {
        Circle().fill(Palette.red.opacity(0.22)).frame(width: 48, height: 48)
      }
      Circle().fill(fill).frame(width: 38, height: 38)
      GlyphView(glyph: glyph(state))
        .foregroundColor(ink)
        .frame(width: 18, height: 18)
    }
    .frame(width: 38, height: 38)
  }
}

private struct PercentLabel: View {
  let state: MicState
  var size: CGFloat = 20
  var body: some View {
    let color: Color = (isAlert(state) || isReady(state)) ? .white : Palette.gold
    Text(percentText(state))
      .font(syne(.bold, size))
      .tracking(-0.03 * size)
      .foregroundColor(color)
      .lineLimit(1)
      .fixedSize()
  }
}

private struct TopRow: View {
  let state: MicState
  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      StageIcon(state: state)
      VStack(alignment: .leading, spacing: 2) {
        Text(state.title)
          .font(syne(.bold, 17))
          .tracking(-0.34)
          .foregroundColor(.white)
          .lineLimit(1)
        Text(state.detail)
          .font(syne(.regular, 13))
          .foregroundColor(.white.opacity(0.6))
          .lineLimit(1)
          .truncationMode(.tail)
      }
      .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
      PercentLabel(state: state)
        .padding(.top, 2)
    }
  }
}

private struct ActionButton: View {
  let state: MicState
  let label: String
  var body: some View {
    let alert = isAlert(state)
    let content = HStack(spacing: 8) {
      if alert {
        GlyphView(glyph: .mic, lineWidth: 2.2).frame(width: 18, height: 18)
      }
      Text(label).font(syne(.bold, 15)).tracking(-0.15)
      if !alert {
        Image(systemName: "arrow.right").font(.system(size: 14, weight: .bold))
      }
    }
    .foregroundColor(alert ? .white : Palette.ink)
    .frame(maxWidth: .infinity)
    .frame(height: 40)
    .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(alert ? Palette.red : Palette.gold))
    if let u = url(state) {
      Link(destination: u) { content }
    } else {
      content
    }
  }
}

private struct RailSegment: View {
  let fill: Double
  let color: Color
  var body: some View {
    GeometryReader { g in
      ZStack(alignment: .leading) {
        RoundedRectangle(cornerRadius: 2).fill(Palette.track)
        RoundedRectangle(cornerRadius: 2).fill(color).frame(width: g.size.width * fill)
      }
    }
  }
}

private struct Rail: View {
  let state: MicState
  var height: CGFloat = 4
  var gap: CGFloat = 3

  var body: some View {
    let seg = segments(state)
    let alert = isAlert(state)
    GeometryReader { geo in
      let w = geo.size.width - gap * 2
      HStack(spacing: gap) {
        RailSegment(fill: seg.0, color: Palette.gold).frame(width: w * 0.6)
        RailSegment(fill: alert ? 1 : seg.1, color: alert ? Palette.red : Palette.gold).frame(width: w * 0.2)
        RailSegment(fill: seg.2, color: Palette.gold).frame(width: w * 0.2)
      }
    }
    .frame(height: height)
  }
}

private enum StepKind { case done, current, ahead }

// "Lesson" under the first segment; "Mic audio" and "Focus points" spread
// under the last two.
private struct RailLabels: View {
  let state: MicState

  private var kinds: (StepKind, StepKind, StepKind) {
    switch state.stage {
    case "extracting": return (.done, .done, .current)
    case "ready": return (.done, .done, .done)
    default: return (.done, .current, .ahead)
    }
  }

  var body: some View {
    let k = kinds
    GeometryReader { geo in
      HStack(spacing: 0) {
        StepText(text: "Lesson", kind: k.0, alert: isAlert(state))
          .frame(width: (geo.size.width - 6) * 0.6 + 3, alignment: .leading)
        HStack(spacing: 8) {
          StepText(text: "Mic audio", kind: k.1, alert: isAlert(state))
          Spacer(minLength: 0)
          StepText(text: "Focus points", kind: k.2, alert: isAlert(state))
        }
      }
    }
    .frame(height: 14)
  }
}

private struct StepText: View {
  let text: String
  let kind: StepKind
  let alert: Bool
  var body: some View {
    let on: Color = alert ? Palette.redText : Palette.gold
    HStack(spacing: 5) {
      if kind == .current {
        Circle().fill(alert ? Palette.red : Palette.gold).frame(width: 5, height: 5)
      }
      Text(text)
        .font(kind == .current ? syne(.semibold, 11.5) : syne(.regular, 11.5))
        .foregroundColor(kind == .current ? on : kind == .done ? .white.opacity(0.72) : .white.opacity(0.4))
        .lineLimit(1)
        .fixedSize()
    }
  }
}

// ─── Lock screen ────────────────────────────────────────────────────────

@available(iOS 16.2, *)
private struct LockScreenCard: View {
  let state: MicState
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      TopRow(state: state)
      if let cta = state.cta {
        ActionButton(state: state, label: cta)
      }
      if !isReady(state) {
        VStack(spacing: 7) {
          Rail(state: state)
          RailLabels(state: state)
        }
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 14)
    .overlay(
      ContainerRelativeShape()
        .strokeBorder(isAlert(state) ? Palette.red : Color.clear, lineWidth: 1.5)
    )
  }
}

// ─── Compact / minimal ──────────────────────────────────────────────────

private struct Mark: View {
  var body: some View {
    Image("InBetweenMark")
      .resizable()
      .aspectRatio(contentMode: .fit)
      .frame(width: 16, height: 16)
  }
}

private struct CompactTrailing: View {
  let state: MicState
  var body: some View {
    if isAlert(state) {
      HStack(spacing: 6) {
        Circle().fill(Palette.red).frame(width: 7, height: 7)
        Text(state.badge ?? "Plug mic")
          .font(syne(.bold, 13))
          .foregroundColor(Palette.redText)
          .lineLimit(1)
      }
    } else if isReady(state) {
      HStack(spacing: 5) {
        GlyphView(glyph: .check, lineWidth: 2.6).frame(width: 15, height: 15)
        Text(state.badge ?? "Ready").font(syne(.bold, 13)).lineLimit(1)
      }
      .foregroundColor(Palette.gold)
    } else {
      Text(percentText(state))
        .font(syne(.bold, 15))
        .tracking(-0.45)
        .foregroundColor(Palette.gold)
        .lineLimit(1)
    }
  }
}

private struct MiniRail: View {
  let state: MicState
  var body: some View {
    if isReady(state) {
      GlyphView(glyph: .check, lineWidth: 2.6)
        .foregroundColor(Palette.gold)
        .frame(width: 16, height: 16)
    } else {
      let seg = segments(state)
      let off = Color.white.opacity(0.22)
      HStack(spacing: 1.5) {
        Capsule().fill(Palette.gold).frame(width: 11, height: 3)
        Capsule().fill(isAlert(state) ? Palette.red : (seg.1 > 0 ? Palette.gold : off)).frame(width: 3.5, height: 3)
        Capsule().fill(seg.2 > 0 ? Palette.gold : off).frame(width: 3.5, height: 3)
      }
      .frame(width: 20)
    }
  }
}

// ─── The activity ───────────────────────────────────────────────────────

@available(iOS 16.2, *)
struct MicPendingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: MicPendingAttributes.self) { context in
      LockScreenCard(state: context.state)
        .activityBackgroundTint(isAlert(context.state) ? Palette.alertCard : Palette.card)
        .activitySystemActionForegroundColor(.white)
        .widgetURL(url(context.state))
    } dynamicIsland: { context in
      let s = context.state
      return DynamicIsland {
        // One row, as on the lock screen: icon, title over detail, the %.
        // In the centre region (under the camera) it gets the full width, so
        // the three line up the way they do on the card.
        DynamicIslandExpandedRegion(.center) {
          TopRow(state: s)
            .padding(.horizontal, 4)
            .padding(.top, 2)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 12) {
            if let cta = s.cta {
              ActionButton(state: s, label: cta)
            }
            if !isReady(s) {
              Rail(state: s)
            }
          }
          .padding(.horizontal, 4)
          .padding(.top, 8)
        }
      } compactLeading: {
        Mark()
      } compactTrailing: {
        CompactTrailing(state: s)
      } minimal: {
        MiniRail(state: s)
      }
      .widgetURL(url(s))
      .keylineTint(isAlert(s) ? Palette.red : Palette.gold)
    }
  }
}
