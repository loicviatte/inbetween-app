import ExpoModulesCore
import AVKit
import AVFoundation

public class AudioRoutePickerModule: Module {
  private var routeObserver: NSObjectProtocol?

  static func typeString(for port: AVAudioSession.Port) -> String {
    switch port {
    case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE: return "bluetooth"
    case .builtInMic: return "builtin"
    case .headsetMic, .lineIn: return "wired"
    case .usbAudio: return "usb"
    case .airPlay: return "airplay"
    default: return port.rawValue
    }
  }

  static func reasonString(for reason: AVAudioSession.RouteChangeReason) -> String {
    switch reason {
    case .oldDeviceUnavailable: return "oldDeviceUnavailable"
    case .newDeviceAvailable: return "newDeviceAvailable"
    case .categoryChange: return "categoryChange"
    case .override: return "override"
    case .wakeFromSleep: return "wakeFromSleep"
    case .noSuitableRouteForCategory: return "noSuitableRouteForCategory"
    case .routeConfigurationChange: return "routeConfigurationChange"
    case .unknown: return "unknown"
    @unknown default: return "unknown"
    }
  }

  public func definition() -> ModuleDefinition {
    Name("AudioRoutePicker")

    Events("onRouteChange")

    OnStartObserving {
      self.routeObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] notification in
        guard let self = self else { return }
        let reasonRaw = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 0
        let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw) ?? .unknown
        let session = AVAudioSession.sharedInstance()
        let input = session.currentRoute.inputs.first
        let port = input?.portType ?? .builtInMic
        let bluetoothPorts: [AVAudioSession.Port] = [.bluetoothHFP, .bluetoothA2DP, .bluetoothLE]
        self.sendEvent("onRouteChange", [
          "reason": AudioRoutePickerModule.reasonString(for: reason),
          "name": input?.portName as Any,
          "uid": input?.uid as Any,
          "type": AudioRoutePickerModule.typeString(for: port),
          "isBluetooth": bluetoothPorts.contains(port),
        ])
      }
    }

    OnStopObserving {
      if let obs = self.routeObserver {
        NotificationCenter.default.removeObserver(obs)
        self.routeObserver = nil
      }
    }

    Function("getCurrentInputRoute") { () -> [String: Any?] in
      let session = AVAudioSession.sharedInstance()
      guard let input = session.currentRoute.inputs.first else {
        return ["name": nil, "type": "none", "isBluetooth": false]
      }
      let port = input.portType
      let bluetoothPorts: [AVAudioSession.Port] = [.bluetoothHFP, .bluetoothA2DP, .bluetoothLE]
      let isBluetooth = bluetoothPorts.contains(port)
      let typeStr = AudioRoutePickerModule.typeString(for: port)
      return [
        "name": input.portName,
        "uid": input.uid,
        "type": typeStr,
        "isBluetooth": isBluetooth,
      ]
    }

    AsyncFunction("listAvailableInputs") { (promise: Promise) in
      let session = AVAudioSession.sharedInstance()
      // Do NOT call setActive(true) here. Activating .playAndRecord ejects
      // any A2DP output route (e.g. Spotify on a Bluetooth speaker), even
      // with .mixWithOthers — that flag controls session mixing, not
      // hardware route arbitration. setCategory alone has no effect on
      // routing per Apple docs; routing only changes on activation.
      // setCategory is still required so availableInputs returns mic
      // candidates (BT HFP, USB audio, headset, builtin).
      do {
        try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .allowBluetoothA2DP, .mixWithOthers])
      } catch {
        NSLog("[AudioRoutePicker] listAvailableInputs setCategory error: \(error)")
      }
      NSLog("[AudioRoutePicker] listAvailableInputs called, currentRoute=\(session.currentRoute)")
      let currentUid = session.currentRoute.inputs.first?.uid
      let inputs = session.availableInputs ?? []
      let result: [[String: Any?]] = inputs.map { input in
        let port = input.portType
        let bluetoothPorts: [AVAudioSession.Port] = [.bluetoothHFP, .bluetoothA2DP, .bluetoothLE]
        return [
          "uid": input.uid,
          "name": input.portName,
          "type": AudioRoutePickerModule.typeString(for: port),
          "isBluetooth": bluetoothPorts.contains(port),
          "isCurrent": input.uid == currentUid,
        ]
      }
      promise.resolve(result)
    }

    AsyncFunction("setPreferredInput") { (uid: String, promise: Promise) in
      let session = AVAudioSession.sharedInstance()
      let inputs = session.availableInputs ?? []
      guard let target = inputs.first(where: { $0.uid == uid }) else {
        promise.reject("E_INPUT_NOT_FOUND", "No available input matches uid \(uid)")
        return
      }
      do {
        try session.setPreferredInput(target)
        promise.resolve(nil)
      } catch {
        promise.reject("E_SET_INPUT", error.localizedDescription)
      }
    }

    AsyncFunction("presentPicker") { (promise: Promise) in
      DispatchQueue.main.async {
        NSLog("[AudioRoutePicker] presentPicker invoked")

        // Ensure an active audio session so AVRoutePickerView has routes to show
        do {
          let session = AVAudioSession.sharedInstance()
          // .mixWithOthers ensures opening the picker / listing inputs does
          // not eject another app's audio session (e.g. Spotify playing on a
          // Bluetooth speaker). Without it, activating .playAndRecord here
          // takes exclusive audio focus and kills the music.
          try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker, .mixWithOthers])
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
