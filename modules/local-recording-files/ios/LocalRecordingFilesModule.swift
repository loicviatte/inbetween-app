// ───────────────────────────────────────────────────────────────────────
// LocalRecordingFilesModule
//
// iOS native bridge for the DJI mic file-import flow.
//
// What it does:
//   1. The first time a coach uses local-recording mode, the JS layer
//      calls `pickFolder()` — this presents a UIDocumentPickerViewController
//      restricted to folders. The coach navigates to "NO NAME" →
//      "DJI_Audio_001" and taps Open. iOS asks "Allow InBetween to access
//      this folder?"; on Allow, we get a security-scoped URL.
//   2. We persist the URL as bookmark data in UserDefaults. Bookmarks
//      survive across launches and device restarts, so the coach never
//      has to re-grant access (until they reformat the mic or take it on
//      a different iPhone).
//   3. Subsequent imports call `listFiles()` — we restore the bookmark,
//      start a security-scoped resource session, enumerate audio files
//      in the folder (metadata only — name, size, modification date),
//      then stop the security-scoped session.
//   4. To actually transfer one of those files, JS calls
//      `copyFileToCache(name)` — we re-open the security-scoped session,
//      copy the WAV to the app's cache directory, and return the local
//      URI which expo-document-picker / fetch / supabase-js can all read
//      transparently without any further iOS file-system permissions.
//
// Why we DON'T just read the file inline on every listFiles call:
//   - Reading 100 MB of WAV per file would block the listFiles call for
//     several seconds.
//   - For matching, we only need metadata.
//   - For the actual upload we want a stable local copy anyway (so we
//     can retry without re-entering the security-scoped session if it
//     expires mid-upload).
// ───────────────────────────────────────────────────────────────────────

import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers
import AVFoundation

// Stores the picked folder bookmark across launches. NSData blob,
// persisted in UserDefaults under this key.
private let BOOKMARK_KEY = "inbetween.dji.folder.bookmark.v1"

// Cooperative-cancellation state for the copy / transcode operations. A
// JS-side timeout (mic unplugged mid-copy, or a stalled transcode) calls
// cancelCopy()/cancelTranscode() so the native op aborts promptly instead of
// holding the security scope / burning CPU for minutes. The module is a
// singleton and these ops run one-at-a-time, so file-scoped state is safe; the
// lock only guards a cancel arriving on a different thread than the worker.
private let opLock = NSLock()
private var pendingCopyCancel = false
private var pendingExport: AVAssetExportSession?

public class LocalRecordingFilesModule: Module {
  // Strong reference to the picker delegate while a picker is on screen.
  // Without this, the delegate is deallocated immediately and the picker's
  // completion callback never fires.
  private var pickerDelegate: FolderPickerDelegate?

  // Audio route monitor — used pre-class to detect when the coach plugs
  // the DJI mic in (so we can prompt for first-time folder access). We
  // set an `.ambient` session (output-only, mixes with other audio) just
  // to get the route change notifications — no actual audio is played
  // or recorded. JS must call stopAudioRouteMonitor() before starting a
  // class so the local-recording-mode invariant "no audio session
  // active" holds during the cours itself.
  private var audioMonitorActive = false
  private var routeChangeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("LocalRecordingFiles")

    // ─── Events emitted to JS ───────────────────────────────────────
    // onDjiDeviceDetected: fired when the audio route monitor sees a
    // new USB / DJI-named input or output appear (i.e. mic was plugged
    // in via USB-C). Payload: { deviceName }
    Events("onDjiDeviceDetected")

    // ─── pickFolder() ────────────────────────────────────────────────
    // Presents a folder picker. On success, persists a security-scoped
    // bookmark for the chosen folder and resolves with the folder's
    // display name. On cancel, resolves with null.
    AsyncFunction("pickFolder") { (promise: Promise) in
      DispatchQueue.main.async {
        guard let host = LocalRecordingFilesModule.topViewController() else {
          promise.reject("E_NO_HOST", "No view controller to present the folder picker on")
          return
        }

        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
        picker.allowsMultipleSelection = false
        picker.shouldShowFileExtensions = true

        let delegate = FolderPickerDelegate(
          onPick: { [weak self] folderURL in
            self?.pickerDelegate = nil
            // Save bookmark for future calls. The url ALREADY has security
            // scope from the picker — we explicitly start/stop accessing
            // it around bookmark creation to be safe on edge cases where
            // iOS has not auto-started it yet.
            let started = folderURL.startAccessingSecurityScopedResource()
            defer { if started { folderURL.stopAccessingSecurityScopedResource() } }
            do {
              let bookmark = try folderURL.bookmarkData(
                options: [],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
              )
              UserDefaults.standard.set(bookmark, forKey: BOOKMARK_KEY)
              promise.resolve(folderURL.lastPathComponent)
            } catch {
              promise.reject("E_BOOKMARK", "Failed to create bookmark: \(error.localizedDescription)")
            }
          },
          onCancel: { [weak self] in
            self?.pickerDelegate = nil
            promise.resolve(nil)
          }
        )
        self.pickerDelegate = delegate
        picker.delegate = delegate
        picker.modalPresentationStyle = .formSheet
        host.present(picker, animated: true, completion: nil)
      }
    }

    // ─── hasFolder() ──────────────────────────────────────────────────
    // Whether the coach is set up (has a folder bookmark). Lets the JS layer
    // decide "Pick folder" (first-time onboarding) vs "Plug your mic" (already
    // set up). We resolve first so iOS can drop a bookmark it flags STALE (the
    // mic was reformatted / its identity changed) — resolveFolderURL() removes
    // the blob in that case — then report whether a bookmark STILL exists.
    // A merely transient resolve failure (mic simply unplugged right now) keeps
    // the blob, so this still returns true ("set up, just not plugged in") and
    // does NOT regress to the onboarding banner every time the mic is unplugged.
    Function("hasFolder") { () -> Bool in
      _ = LocalRecordingFilesModule.resolveFolderURL()
      return UserDefaults.standard.data(forKey: BOOKMARK_KEY) != nil
    }

    // ─── clearFolder() ────────────────────────────────────────────────
    // Drops the saved bookmark. Used for "switch mic" scenarios or
    // recovery when the bookmark has gone stale.
    Function("clearFolder") { () -> Void in
      UserDefaults.standard.removeObject(forKey: BOOKMARK_KEY)
    }

    // ─── listFiles() ──────────────────────────────────────────────────
    // Enumerates files in the bookmarked folder. Returns metadata only:
    // name, size in bytes, modificationDate as ISO string. The actual
    // bytes are not read here — call copyFileToCache(name) to retrieve
    // a usable local URI for a specific file.
    AsyncFunction("listFiles") { (promise: Promise) in
      guard let folderURL = LocalRecordingFilesModule.resolveFolderURL() else {
        promise.reject("E_NO_FOLDER", "No folder access — call pickFolder() first")
        return
      }

      let started = folderURL.startAccessingSecurityScopedResource()
      defer { if started { folderURL.stopAccessingSecurityScopedResource() } }

      let fm = FileManager.default

      // Recursive enumeration: the coach may have picked the device
      // root ("NO NAME") instead of the DJI_Audio_001 subfolder, so we
      // descend into every subdirectory and collect WAV files wherever
      // they are. We also tolerate the case where DJI's firmware changes
      // its folder naming in a future release.
      guard let enumerator = fm.enumerator(
        at: folderURL,
        includingPropertiesForKeys: [
          .fileSizeKey,
          .contentModificationDateKey,
          .isDirectoryKey,
        ],
        options: [.skipsHiddenFiles, .skipsPackageDescendants]
      ) else {
        promise.reject("E_ENUMERATE", "Could not create enumerator for \(folderURL.path)")
        return
      }

      let dateFormatter = ISO8601DateFormatter()
      dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

      // Cap recursion depth at 4 levels so an accidentally-picked root
      // of an enormous drive doesn't grind through tens of thousands of
      // unrelated files. DJI's actual layout is /DJI_Audio_001/*.WAV
      // which is 1 level deep.
      var results: [[String: Any]] = []
      var inspected = 0
      let folderPathLen = folderURL.path.count

      while let url = enumerator.nextObject() as? URL {
        inspected += 1
        if inspected > 5000 {
          NSLog("[LocalRecordingFiles] enumeration capped at 5000 entries")
          break
        }

        let resVals = try? url.resourceValues(forKeys: [
          .fileSizeKey,
          .contentModificationDateKey,
          .isDirectoryKey,
        ])
        if resVals?.isDirectory == true {
          continue
        }

        // Only return audio files — anything else (system metadata,
        // images, etc.) would just confuse the matcher.
        let ext = url.pathExtension.lowercased()
        guard ["wav", "m4a", "aac", "mp3", "flac"].contains(ext) else { continue }

        let size = resVals?.fileSize ?? 0
        let modDate = resVals?.contentModificationDate ?? Date(timeIntervalSince1970: 0)

        // Path relative to the picked folder — used by copyFileToCache
        // to locate the source file via the security-scoped bookmark.
        let fullPath = url.path
        let relativePath = fullPath.count > folderPathLen + 1
          ? String(fullPath.suffix(fullPath.count - folderPathLen - 1))
          : url.lastPathComponent

        results.append([
          "name": url.lastPathComponent,
          "relativePath": relativePath,
          "sizeBytes": size,
          "modificationDate": dateFormatter.string(from: modDate),
        ])
      }

      NSLog("[LocalRecordingFiles] listFiles inspected=\(inspected) audioFiles=\(results.count)")
      promise.resolve(results)
    }

    // ─── copyFileToCache(name) ────────────────────────────────────────
    // Copies the named file out of the bookmarked folder into the app's
    // tmp/ directory. Returns the local file:// URI of the copy. The
    // copy survives the security-scoped session — JS can fetch() this
    // URI later for upload without re-entering the security scope.
    AsyncFunction("copyFileToCache") { (relativePath: String, promise: Promise) in
      guard let folderURL = LocalRecordingFilesModule.resolveFolderURL() else {
        promise.reject("E_NO_FOLDER", "No folder access")
        return
      }
      // Fresh cancel state for this copy (copies run one at a time).
      opLock.lock(); pendingCopyCancel = false; opLock.unlock()

      let started = folderURL.startAccessingSecurityScopedResource()
      defer { if started { folderURL.stopAccessingSecurityScopedResource() } }

      // Build the source URL by appending each path component
      // individually. Passing a multi-level path string to
      // appendingPathComponent is fragile on external/USB-mounted
      // volumes — we've seen "file couldn't be opened" errors even
      // though the bookmark covers the file's parent. Walking the
      // components avoids any URL-parsing surprises.
      var sourceURL = folderURL
      for component in relativePath.split(separator: "/") {
        sourceURL = sourceURL.appendingPathComponent(String(component))
      }
      sourceURL = sourceURL.standardizedFileURL

      let leafName = sourceURL.lastPathComponent
      let tmpDir = FileManager.default.temporaryDirectory
        .appendingPathComponent("inbetween-dji-import", isDirectory: true)
      let destURL = tmpDir.appendingPathComponent(leafName)

      let fm = FileManager.default
      let exists = fm.fileExists(atPath: sourceURL.path)
      NSLog("[LocalRecordingFiles] copy source=\(sourceURL.path) exists=\(exists) scope=\(started)")

      do {
        try fm.createDirectory(at: tmpDir, withIntermediateDirectories: true, attributes: nil)
        if fm.fileExists(atPath: destURL.path) {
          try fm.removeItem(at: destURL)
        }
      } catch {
        promise.reject("E_DEST", "Cannot prepare destination: \(error.localizedDescription)")
        return
      }

      // NSFileCoordinator is Apple's recommended path for reading
      // security-scoped files. It handles the coordination dance with
      // the file provider that backs USB volumes; raw Data(contentsOf:)
      // can fail with a misleading "couldn't be opened" error on these
      // volumes even when the scope is valid.
      let coordinator = NSFileCoordinator()
      var coordErr: NSError?
      var innerErr: Error?
      coordinator.coordinate(
        readingItemAt: sourceURL,
        options: [.withoutChanges],
        error: &coordErr
      ) { (resolvedURL) in
        // Chunked read instead of one big Data(contentsOf:) so that (a) a
        // JS-side timeout can cancel between chunks (via cancelCopy) and (b) a
        // vanished USB volume tends to error per-chunk rather than the whole
        // 266 MB read hanging while holding the security scope. (A read already
        // blocked in-kernel still can't be interrupted mid-syscall — the JS
        // timeout is the backstop there.) We write to a ".part" sibling and
        // atomic-rename at the end, so destURL is never a truncated/partial file.
        let partURL = destURL.appendingPathExtension("part")
        do {
          try? fm.removeItem(at: partURL)
          guard fm.createFile(atPath: partURL.path, contents: nil) else {
            throw NSError(domain: "LRF", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "could not create part file"])
          }
          let readHandle = try FileHandle(forReadingFrom: resolvedURL)
          defer { try? readHandle.close() }
          let writeHandle = try FileHandle(forWritingTo: partURL)
          defer { try? writeHandle.close() }
          let chunkSize = 4 * 1024 * 1024 // 4 MB
          var total = 0
          while true {
            opLock.lock(); let cancelled = pendingCopyCancel; opLock.unlock()
            if cancelled {
              throw NSError(domain: "LRF", code: 2,
                            userInfo: [NSLocalizedDescriptionKey: "E_COPY_CANCELLED: copy cancelled (mic likely unplugged)"])
            }
            guard let chunk = try readHandle.read(upToCount: chunkSize), !chunk.isEmpty else { break }
            try writeHandle.write(contentsOf: chunk)
            total += chunk.count
          }
          try fm.moveItem(at: partURL, to: destURL)
          NSLog("[LocalRecordingFiles] copy ok chunked: \(total) bytes → \(destURL.path)")
        } catch {
          NSLog("[LocalRecordingFiles] chunked copy failed: \(error)")
          try? fm.removeItem(at: partURL)
          innerErr = error
        }
      }
      if let coordErr = coordErr {
        NSLog("[LocalRecordingFiles] coordinator failed: \(coordErr)")
        promise.reject("E_COORD", "File coordinator failed: \(coordErr.localizedDescription)")
        return
      }
      if let innerErr = innerErr {
        promise.reject("E_COPY", "Failed to copy file: \(innerErr.localizedDescription)")
        return
      }
      promise.resolve(destURL.absoluteString)
    }

    // ─── transcodeToM4A(inputUri) ────────────────────────────────────
    // Compresses a (large, uncompressed) WAV into a small AAC/.m4a file in
    // the app cache, returning its file:// URI. The DJI mic records 48 kHz /
    // 24-bit WAV (~8.6 MB/min), which blows past Supabase's 50 MB free-tier
    // per-object limit and is needlessly heavy to upload over mobile. AAC is
    // plenty for speech transcription — AssemblyAI handles m4a natively, and
    // it's the same format the live recording pipeline already uses.
    //
    // AVAssetExportSession + the AppleM4A preset: robust, Apple-maintained,
    // runs off the main thread. A 30-min part lands ~25-30 MB, well under
    // the 50 MB cap.
    AsyncFunction("transcodeToM4A") { (inputUri: String, promise: Promise) in
      let inputURL = URL(string: inputUri) ?? URL(fileURLWithPath: inputUri)
      let asset = AVURLAsset(url: inputURL)
      let outURL = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
        .appendingPathExtension("m4a")
      try? FileManager.default.removeItem(at: outURL)

      guard let export = AVAssetExportSession(
        asset: asset,
        presetName: AVAssetExportPresetAppleM4A
      ) else {
        promise.reject("E_TRANSCODE", "Could not create export session")
        return
      }
      export.outputURL = outURL
      export.outputFileType = .m4a
      // Publish the session so a JS-side timeout can cancelExport() it instead
      // of leaving it encoding after we've abandoned the result.
      opLock.lock(); pendingExport = export; opLock.unlock()
      export.exportAsynchronously {
        opLock.lock(); if pendingExport === export { pendingExport = nil }; opLock.unlock()
        switch export.status {
        case .completed:
          promise.resolve(outURL.absoluteString)
        case .failed:
          promise.reject("E_TRANSCODE", export.error?.localizedDescription ?? "transcode failed")
        case .cancelled:
          promise.reject("E_TRANSCODE", "transcode cancelled")
        default:
          promise.reject("E_TRANSCODE", "unexpected export status \(export.status.rawValue)")
        }
      }
    }

    // ─── cancelCopy() ─────────────────────────────────────────────────
    // Aborts an in-flight copyFileToCache. JS calls this when its copy timeout
    // fires (mic unplugged mid-copy): the chunked read checks this flag between
    // chunks and bails, releasing the security scope early. Best-effort — if a
    // read is already blocked in-kernel on a fully-dead volume the flag is only
    // seen once that read returns; the JS-side timeout stays the hard backstop.
    Function("cancelCopy") { () -> Void in
      opLock.lock(); pendingCopyCancel = true; opLock.unlock()
    }

    // ─── cancelTranscode() ────────────────────────────────────────────
    // Aborts an in-flight transcodeToM4A. JS calls this when its transcode
    // timeout fires so AVAssetExportSession stops burning CPU on a result we've
    // already given up on.
    Function("cancelTranscode") { () -> Void in
      opLock.lock(); let export = pendingExport; opLock.unlock()
      export?.cancelExport()
    }

    // ─── startAudioRouteMonitor() ────────────────────────────────────
    // Activates an `.ambient` AVAudioSession purely to listen for route
    // change notifications. When iOS reports a new device available
    // (e.g. the coach plugged in the DJI mic over USB-C), we emit
    // `onDjiDeviceDetected` to JS with the device's port name so the
    // dashboard can pop the first-run setup modal.
    //
    // `.ambient` is the safest category: output-only, mixes with other
    // audio. It does NOT force BT speakers into HFP (which would happen
    // with .record / .playAndRecord because iOS thinks a mic is needed).
    // So we can leave this running on the dashboard without disturbing
    // the coach's BT speaker playback (Spotify, etc.).
    //
    // IMPORTANT: JS must call stopAudioRouteMonitor() before kicking
    // off a class — local-recording mode's whole premise is "no audio
    // session active during class". Leaving this active during the
    // cours would defeat the purpose.
    AsyncFunction("startAudioRouteMonitor") { (promise: Promise) in
      DispatchQueue.main.async { [weak self] in
        guard let self = self else {
          promise.resolve(false)
          return
        }
        if self.audioMonitorActive {
          promise.resolve(true)
          return
        }
        let session = AVAudioSession.sharedInstance()
        do {
          try session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
          try session.setActive(true)
        } catch {
          NSLog("[LocalRecordingFiles] audio monitor session setup failed: \(error)")
          promise.reject(
            "E_AUDIO_SESSION",
            "Failed to activate ambient audio session: \(error.localizedDescription)"
          )
          return
        }

        // Subscribe to route changes. We only care about
        // `.newDeviceAvailable` — fires when any audio device comes
        // online, regardless of whether iOS picks it as the active
        // route. So the USB-C mic plug-in event is captured even
        // though we're not actively routing audio to it.
        self.routeChangeObserver = NotificationCenter.default.addObserver(
          forName: AVAudioSession.routeChangeNotification,
          object: nil,
          queue: .main
        ) { [weak self] notif in
          guard let self = self else { return }
          guard let reasonRaw = notif.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw) else {
            return
          }
          guard reason == .newDeviceAvailable else { return }

          let current = AVAudioSession.sharedInstance().currentRoute
          var detected: AVAudioSessionPortDescription?
          // USB-C audio devices can register as either input or output
          // depending on the device class. Check both.
          for port in current.inputs {
            NSLog("[LocalRecordingFiles] input port: \(port.portName) type=\(port.portType.rawValue)")
            if LocalRecordingFilesModule.isDjiLikePort(port) {
              detected = port
              break
            }
          }
          if detected == nil {
            for port in current.outputs {
              NSLog("[LocalRecordingFiles] output port: \(port.portName) type=\(port.portType.rawValue)")
              if LocalRecordingFilesModule.isDjiLikePort(port) {
                detected = port
                break
              }
            }
          }
          if let port = detected {
            self.sendEvent("onDjiDeviceDetected", [
              "deviceName": port.portName,
              "portType": port.portType.rawValue,
            ])
          }
        }
        self.audioMonitorActive = true
        promise.resolve(true)
      }
    }

    // ─── stopAudioRouteMonitor() ─────────────────────────────────────
    // Tears down the listener and deactivates the audio session. Safe
    // to call when not active (idempotent). Must be called before a
    // class starts so the phone holds no audio session during local-
    // recording capture.
    AsyncFunction("stopAudioRouteMonitor") { (promise: Promise) in
      DispatchQueue.main.async { [weak self] in
        guard let self = self else {
          promise.resolve(false)
          return
        }
        if let observer = self.routeChangeObserver {
          NotificationCenter.default.removeObserver(observer)
          self.routeChangeObserver = nil
        }
        do {
          try AVAudioSession.sharedInstance().setActive(
            false,
            options: [.notifyOthersOnDeactivation]
          )
        } catch {
          NSLog("[LocalRecordingFiles] session deactivate warning: \(error)")
          // Best-effort — the listener removal is what really matters.
        }
        self.audioMonitorActive = false
        promise.resolve(true)
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  /// True if the given audio port looks like a USB-attached DJI mic.
  /// We match on either port type (USB audio) or name (case-insensitive
  /// "DJI") to catch both DJI Mic 1/2 and the Mobile Receiver variants.
  static func isDjiLikePort(_ port: AVAudioSessionPortDescription) -> Bool {
    if port.portType == .usbAudio { return true }
    if port.portName.range(of: "DJI", options: .caseInsensitive) != nil { return true }
    return false
  }

  /// Topmost foreground view controller, used for presenting modal
  /// pickers. Walks the presentedViewController chain so we don't try to
  /// present on top of an already-modal screen.
  static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }
    guard let keyWindow = scene?.windows.first(where: { $0.isKeyWindow }),
          var top = keyWindow.rootViewController else {
      return nil
    }
    while let presented = top.presentedViewController {
      top = presented
    }
    return top
  }

  /// Restores the saved bookmark into a usable URL. Returns nil if the
  /// bookmark is missing, stale, or temporarily unresolvable.
  ///
  /// Bookmark deletion policy: we ONLY drop the saved blob when iOS
  /// flags it `isStale` (the URL it points to has changed — e.g. the
  /// volume was reformatted). Plain resolution failures (volume not
  /// mounted right now) are TRANSIENT — they would have nuked an
  /// otherwise-valid bookmark every time the coach unplugged the mic
  /// and re-opened the app. Keeping the blob means the bookmark
  /// resolves cleanly the next time the volume mounts.
  ///
  /// The downside: a truly corrupted bookmark stays in UserDefaults
  /// until the coach hits "Reset folder access" manually. Acceptable
  /// trade-off vs. auto-losing valid bookmarks.
  static func resolveFolderURL() -> URL? {
    guard let bookmarkData = UserDefaults.standard.data(forKey: BOOKMARK_KEY) else {
      return nil
    }
    var isStale = false
    do {
      let url = try URL(
        resolvingBookmarkData: bookmarkData,
        options: [],
        relativeTo: nil,
        bookmarkDataIsStale: &isStale
      )
      if isStale {
        UserDefaults.standard.removeObject(forKey: BOOKMARK_KEY)
        return nil
      }
      return url
    } catch {
      // Transient failure (e.g. volume unmounted). Keep the bookmark
      // for the next attempt.
      NSLog("[LocalRecordingFiles] bookmark resolve failed (kept): \(error)")
      return nil
    }
  }
}

// MARK: - UIDocumentPickerDelegate wrapper
//
// UIDocumentPickerViewController requires a delegate that conforms to
// UIDocumentPickerDelegate. We can't make the Module class itself
// conform (it's not NSObject), so this stand-alone delegate forwards
// the two outcomes (pick / cancel) back to closures captured at
// presentation time.
private final class FolderPickerDelegate: NSObject, UIDocumentPickerDelegate {
  private let onPick: (URL) -> Void
  private let onCancel: () -> Void

  init(onPick: @escaping (URL) -> Void, onCancel: @escaping () -> Void) {
    self.onPick = onPick
    self.onCancel = onCancel
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    if let url = urls.first {
      onPick(url)
    } else {
      onCancel()
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    onCancel()
  }
}
