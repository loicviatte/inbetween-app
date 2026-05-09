import SwiftUI

extension Color {
  init(hex: UInt32, alpha: Double = 1.0) {
    let r = Double((hex >> 16) & 0xFF) / 255.0
    let g = Double((hex >> 8) & 0xFF) / 255.0
    let b = Double(hex & 0xFF) / 255.0
    self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
  }
}

enum InBetweenTheme {
  static let ink     = Color(hex: 0x141414)
  static let orange  = Color(hex: 0xE8A838)
  static let green   = Color(hex: 0x4AAF52)
  static let red     = Color(hex: 0xD44545)
  static let gray    = Color(hex: 0x999999)
  static let hairlineLight = Color.black.opacity(0.07)
  static let hairlineDark  = Color.white.opacity(0.08)
}

func initials(from name: String?) -> String {
  guard let n = name?.trimmingCharacters(in: .whitespaces), !n.isEmpty else { return "?" }
  let parts = n.split(separator: " ").compactMap { $0.first }.map(String.init)
  return parts.prefix(2).joined().uppercased()
}
