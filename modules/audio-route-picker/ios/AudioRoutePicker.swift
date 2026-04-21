import Foundation
import AVKit
import React

@objc(AudioRoutePicker)
class AudioRoutePicker: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { return true }

  @objc func presentPicker(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      // AVRoutePickerView is the modern iOS audio route picker (same as Spotify/Apple Music)
      let picker = AVRoutePickerView(frame: CGRect(x: -200, y: -200, width: 44, height: 44))
      picker.tintColor = UIColor.systemOrange

      guard let scene = UIApplication.shared.connectedScenes
        .filter({ $0.activationState == .foregroundActive })
        .compactMap({ $0 as? UIWindowScene })
        .first,
        let keyWindow = scene.windows.first(where: { $0.isKeyWindow }) else {
        reject("E_NO_WINDOW", "No active window found", nil)
        return
      }

      keyWindow.addSubview(picker)

      // Find the internal UIButton and trigger it — this opens the system route picker sheet
      for subview in picker.subviews {
        if let button = subview as? UIButton {
          button.sendActions(for: .touchUpInside)
          break
        }
      }

      // Remove the off-screen view after the sheet has had time to present
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
        picker.removeFromSuperview()
        resolve(nil)
      }
    }
  }
}
