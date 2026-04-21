import ExpoModulesCore
import AVKit
import AVFoundation

public class AudioRoutePickerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioRoutePicker")

    AsyncFunction("presentPicker") { (promise: Promise) in
      DispatchQueue.main.async {
        NSLog("[AudioRoutePicker] presentPicker invoked")

        // Ensure an active audio session so AVRoutePickerView has routes to show
        do {
          let session = AVAudioSession.sharedInstance()
          try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker])
          try session.setActive(true)
        } catch {
          NSLog("[AudioRoutePicker] audio session error: \(error)")
        }
        guard
          let scene = UIApplication.shared.connectedScenes
            .filter({ $0.activationState == .foregroundActive })
            .compactMap({ $0 as? UIWindowScene })
            .first,
          let keyWindow = scene.windows.first(where: { $0.isKeyWindow })
        else {
          NSLog("[AudioRoutePicker] no window")
          promise.reject("E_NO_WINDOW", "No active window found")
          return
        }

        var host: UIViewController? = keyWindow.rootViewController
        while let presented = host?.presentedViewController {
          host = presented
        }
        let hostView: UIView = host?.view ?? keyWindow

        let picker = AVRoutePickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
        picker.tintColor = UIColor.clear
        picker.activeTintColor = UIColor.clear
        picker.alpha = 0.01
        hostView.addSubview(picker)
        hostView.layoutIfNeeded()

        func findButton(in view: UIView) -> UIButton? {
          for sv in view.subviews {
            if let b = sv as? UIButton { return b }
            if let nested = findButton(in: sv) { return nested }
          }
          return nil
        }

        if let button = findButton(in: picker) {
          NSLog("[AudioRoutePicker] tapping internal button")
          button.sendActions(for: .touchUpInside)
        } else {
          NSLog("[AudioRoutePicker] no internal button found (subviews: \(picker.subviews.count))")
          // Fallback: call private selector directly
          let sel = NSSelectorFromString("_routePickerButtonTapped:")
          if picker.responds(to: sel) {
            NSLog("[AudioRoutePicker] using _routePickerButtonTapped fallback")
            picker.perform(sel, with: picker)
          } else {
            NSLog("[AudioRoutePicker] no fallback selector available")
          }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
          picker.removeFromSuperview()
          promise.resolve(nil)
        }
      }
    }
  }
}
