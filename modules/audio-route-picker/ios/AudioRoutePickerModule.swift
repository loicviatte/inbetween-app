import ExpoModulesCore
import AVKit

public class AudioRoutePickerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioRoutePicker")

    AsyncFunction("presentPicker") { (promise: Promise) in
      DispatchQueue.main.async {
        // AVRoutePickerView is the modern iOS audio route picker (iOS 11+)
        // Same UI as Spotify, Apple Music, Control Center
        let picker = AVRoutePickerView(frame: CGRect(x: -200, y: -200, width: 44, height: 44))
        picker.tintColor = UIColor.systemOrange

        guard
          let scene = UIApplication.shared.connectedScenes
            .filter({ $0.activationState == .foregroundActive })
            .compactMap({ $0 as? UIWindowScene })
            .first,
          let keyWindow = scene.windows.first(where: { $0.isKeyWindow })
        else {
          promise.reject("E_NO_WINDOW", "No active window found")
          return
        }

        keyWindow.addSubview(picker)

        // Trigger the internal UIButton — opens the system route picker sheet
        for subview in picker.subviews {
          if let button = subview as? UIButton {
            button.sendActions(for: .touchUpInside)
            break
          }
        }

        // Remove the off-screen view after the sheet has had time to appear
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
          picker.removeFromSuperview()
          promise.resolve(nil)
        }
      }
    }
  }
}
