import ExpoModulesCore
import AVFoundation
import os.log

private let log = OSLog(subsystem: "com.loicviatte.inbetweenapp", category: "ContinuousAudioRecorder")
private func dbg(_ msg: String) {
    os_log("%{public}@", log: log, type: .info, msg)
}

struct StartOptionsRecord: Record {
    @Field var outputDir: String = ""
    @Field var sampleRate: Double = 16000
    @Field var channels: Int = 1
    @Field var bitRate: Int = 24000
    @Field var chunkDurationMs: Int = 180000
}

public class ContinuousAudioRecorderModule: Module {
    private let stateLock = NSLock()
    private let engine = AVAudioEngine()

    // Format the tap will deliver buffers in (= native input format, e.g.
    // 48kHz mono Float32 on iPhone). Used to install the tap and to size
    // AVAudioFile's processing format. Captured at start; rebuilt on
    // configuration change if the input route changes.
    private var inputCaptureFormat: AVAudioFormat?
    private var fileSettings: [String: Any] = [:]

    private var currentFile: AVAudioFile?
    private var currentChunkUri: URL?
    private var currentChunkStartedAt: Date?
    private var currentChunkIdx: Int = 0

    private var rotationTimer: DispatchSourceTimer?
    private var outputDirUrl: URL?

    private var sampleRateOpt: Double = 16000
    private var channelsOpt: Int = 1
    private var bitRateOpt: Int = 24000
    private var chunkDurationMs: Int = 180000

    private var recording: Bool = false
    private var lastFinishedUri: URL?
    private var notifObservers: [NSObjectProtocol] = []
    private var tapBufferCount: Int = 0
    private var tapBytesWritten: Int = 0
    private var startedAt: Date?

    // CRITICAL: file writes (especially AAC encoding) must NOT happen on the
    // tap callback thread. The tap runs on a real-time audio thread and MUST
    // return in microseconds. Encoding + file I/O takes ~10ms per write, which
    // causes iOS to drop subsequent audio buffers (we lost ~70% of audio in
    // testing before this fix). All writes are dispatched to this serial queue.
    private let writeQueue = DispatchQueue(
        label: "com.loicviatte.continuous-audio-recorder.write",
        qos: .userInitiated
    )

    public func definition() -> ModuleDefinition {
        Name("ContinuousAudioRecorder")

        Events("chunkReady", "error", "mediaServicesReset")

        AsyncFunction("start") { (opts: StartOptionsRecord) -> [String: Any] in
            return try self.startRecording(opts: opts)
        }

        AsyncFunction("stop") { () -> [String: Any?] in
            return try self.stopRecording()
        }

        Function("isRecording") { () -> Bool in
            return self.recording
        }

        OnDestroy {
            _ = try? self.stopRecording()
        }
    }

    // MARK: - Start

    private func startRecording(opts: StartOptionsRecord) throws -> [String: Any] {
        stateLock.lock()
        if recording {
            stateLock.unlock()
            throw NSError(
                domain: "ContinuousAudioRecorder", code: -10,
                userInfo: [NSLocalizedDescriptionKey: "Already recording"]
            )
        }

        if opts.outputDir.isEmpty {
            stateLock.unlock()
            throw NSError(
                domain: "ContinuousAudioRecorder", code: -11,
                userInfo: [NSLocalizedDescriptionKey: "outputDir is required"]
            )
        }

        let dirString = opts.outputDir.hasPrefix("file://")
            ? String(opts.outputDir.dropFirst("file://".count))
            : opts.outputDir
        let outputDir = URL(fileURLWithPath: dirString, isDirectory: true)

        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: outputDir.path, isDirectory: &isDir),
              isDir.boolValue else {
            stateLock.unlock()
            throw NSError(
                domain: "ContinuousAudioRecorder", code: -12,
                userInfo: [NSLocalizedDescriptionKey: "outputDir does not exist: \(outputDir.path)"]
            )
        }

        self.outputDirUrl = outputDir
        self.sampleRateOpt = opts.sampleRate
        self.channelsOpt = max(1, min(2, opts.channels))
        self.bitRateOpt = opts.bitRate
        self.chunkDurationMs = max(0, opts.chunkDurationMs)
        self.currentChunkIdx = 0
        self.lastFinishedUri = nil

        // Audio session
        let session = AVAudioSession.sharedInstance()
        do {
            // mode .measurement disables iOS audio processing chain (gain
            // shaping, AGC) and asks for raw audio — what we want for
            // transcription. Critically, NO .mixWithOthers: that option puts
            // iOS in power-saving audio path which drops 70% of samples
            // between hardware and tap. For recording we need full-rate.
            try session.setCategory(
                .playAndRecord,
                mode: .measurement,
                options: [.allowBluetooth, .defaultToSpeaker]
            )
            // Do NOT set preferredSampleRate — asking for 16kHz can make iOS
            // throttle the hardware sampling itself. Let iOS use native rate
            // (48kHz on iPhone) and we resample in the tap.
            try session.setActive(true)
        } catch {
            stateLock.unlock()
            throw recorderError(
                code: "audio_session",
                message: error.localizedDescription,
                ns: error as NSError
            )
        }

        // Engine input format (native hardware rate — typically 48kHz)
        let inputNode = engine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
            stateLock.unlock()
            throw recorderError(
                code: "tap_install",
                message: "Invalid input format \(inputFormat)",
                ns: nil
            )
        }

        // Skip our own AVAudioConverter. Record at native input rate (48kHz
        // typically) directly to AAC. AssemblyAI accepts any sample rate.
        // The previous attempt with explicit converter produced more output
        // frames than physically possible (1.64× input duration), suggesting
        // the converter has internal state we're not feeding correctly.
        // Recording native sidesteps the issue.
        self.inputCaptureFormat = inputFormat
        

        // File format MUST match what we'll feed AVAudioFile.write — i.e. the
        // native input format. AAC bitrate scales with sample rate; 24kbps is
        // OK for 16kHz mono speech but too low for 48kHz. Use 48 kbps.
        let nativeBitRate = inputFormat.sampleRate >= 32000 ? 48000 : self.bitRateOpt
        self.fileSettings = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: inputFormat.sampleRate,
            AVNumberOfChannelsKey: Int(inputFormat.channelCount),
            AVEncoderBitRateKey: nativeBitRate,
        ]

        // Open first chunk file before installing tap so we never drop the first frames
        do {
            try openNextChunkFileLocked()
        } catch {
            stateLock.unlock()
            throw recorderError(
                code: "file_open",
                message: error.localizedDescription,
                ns: error as NSError
            )
        }

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] (buffer, _) in
            self?.handleTapBuffer(buffer)
        }

        do {
            engine.prepare()
            try engine.start()
        } catch {
            inputNode.removeTap(onBus: 0)
            self.currentFile = nil
            self.currentChunkUri = nil
            stateLock.unlock()
            throw recorderError(
                code: "engine_start",
                message: error.localizedDescription,
                ns: error as NSError
            )
        }

        if chunkDurationMs > 0 {
            startRotationTimerLocked()
        }

        recording = true
        tapBufferCount = 0
        tapBytesWritten = 0
        startedAt = Date()
        let firstUri = self.currentChunkUri?.absoluteString ?? ""
        let inputSampleRate = inputFormat.sampleRate
        let inputChannels = Int(inputFormat.channelCount)
        stateLock.unlock()

        registerNotifications()
        dbg("START ok — input \(inputSampleRate)Hz/\(inputChannels)ch → output \(self.sampleRateOpt)Hz/\(self.channelsOpt)ch, chunkMs=\(self.chunkDurationMs), file=\(firstUri)")

        return [
            "firstChunkUri": firstUri,
            "inputFormat": [
                "sampleRate": inputSampleRate,
                "channels": inputChannels,
            ]
        ]
    }

    // MARK: - Tap

    private func handleTapBuffer(_ inputBuffer: AVAudioPCMBuffer) {
        // Log raw input characteristics every 12th tap so we can verify what
        // iOS is actually delivering (size, format).
        if (tapBufferCount + 1) % 12 == 1 {
            dbg("TAP raw input — frames=\(inputBuffer.frameLength) format=\(inputBuffer.format.sampleRate)Hz/\(inputBuffer.format.channelCount)ch")
        }

        let frameLen = Int(inputBuffer.frameLength)
        let inputSampleRate = inputBuffer.format.sampleRate

        // Dispatch the actual write off the audio thread. AVAudioFile.write
        // does AAC encoding (and sample rate conversion since file settings
        // target 16kHz while input is 48kHz) which would block the tap if
        // run synchronously here. Since iOS already throttles the tap heavily
        // we want to be sure we don't add more delay.
        writeQueue.async { [weak self] in
            guard let self = self else { return }
            self.stateLock.lock()
            defer { self.stateLock.unlock() }
            guard let file = self.currentFile else {
                self.tapBufferCount += 1
                if self.tapBufferCount % 12 == 1 {
                    dbg("TAP fired but currentFile=nil (count=\(self.tapBufferCount), elapsed=\(self.elapsedMs())ms)")
                }
                return
            }
            do {
                try file.write(from: inputBuffer)
                self.tapBufferCount += 1
                // Track wall-clock-equivalent of audio written (input rate)
                self.tapBytesWritten += Int(Double(frameLen) * 1000.0 / inputSampleRate) // ms
                if self.tapBufferCount % 12 == 1 {
                    dbg("TAP write ok — count=\(self.tapBufferCount) elapsed=\(self.elapsedMs())ms inFrames=\(frameLen) totAudioMs=\(self.tapBytesWritten)")
                }
            } catch {
                dbg("TAP write FAILED at count=\(self.tapBufferCount) elapsed=\(self.elapsedMs())ms: \(error.localizedDescription)")
                self.emitError(code: "file_write", message: error.localizedDescription, ns: error as NSError)
            }
        }
    }

    private func elapsedMs() -> Int {
        guard let st = startedAt else { return 0 }
        return Int(Date().timeIntervalSince(st) * 1000)
    }

    // MARK: - Chunk file management

    // Caller must hold stateLock.
    private func openNextChunkFileLocked() throws {
        guard let outputDir = self.outputDirUrl,
              let processingFormat = self.inputCaptureFormat else { return }
        let idx = self.currentChunkIdx
        let url = outputDir.appendingPathComponent(String(format: "chunk_%04d.m4a", idx))
        try? FileManager.default.removeItem(at: url)
        // Use the convenience init that defaults processingFormat to match
        // the file's settings sample rate. We pass commonFormat/interleaved
        // matching the input buffers we'll write so write(from:) accepts
        // them directly.
        let file = try AVAudioFile(
            forWriting: url,
            settings: self.fileSettings,
            commonFormat: processingFormat.commonFormat,
            interleaved: processingFormat.isInterleaved
        )
        self.currentFile = file
        self.currentChunkUri = url
        self.currentChunkStartedAt = Date()
    }

    private func startRotationTimerLocked() {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        let interval = DispatchTimeInterval.milliseconds(self.chunkDurationMs)
        timer.schedule(deadline: .now() + interval, repeating: interval, leeway: .milliseconds(50))
        timer.setEventHandler { [weak self] in
            self?.rotateChunk()
        }
        timer.resume()
        self.rotationTimer = timer
    }

    private func rotateChunk() {
        var finishedUri: URL?
        var finishedIdx: Int = -1
        var durationMs: Int = 0

        stateLock.lock()
        let startTime = self.currentChunkStartedAt
        let oldUri = self.currentChunkUri
        let oldIdx = self.currentChunkIdx

        // Finalize current file by releasing the reference
        self.currentFile = nil
        self.currentChunkUri = nil
        self.currentChunkStartedAt = nil
        self.currentChunkIdx = oldIdx + 1

        do {
            try openNextChunkFileLocked()
        } catch {
            stateLock.unlock()
            self.emitError(code: "rotate_failed", message: error.localizedDescription, ns: error as NSError)
            return
        }

        finishedUri = oldUri
        finishedIdx = oldIdx
        if let st = startTime {
            durationMs = Int(Date().timeIntervalSince(st) * 1000)
        }
        stateLock.unlock()

        if let uri = finishedUri {
            self.sendEvent("chunkReady", [
                "uri": uri.absoluteString,
                "idx": finishedIdx,
                "durationMs": durationMs,
            ])
            self.lastFinishedUri = uri
        }
    }

    // MARK: - Stop

    private func stopRecording() throws -> [String: Any?] {
        dbg("STOP called — elapsed=\(elapsedMs())ms tapBuffers=\(tapBufferCount) bytesWritten=\(tapBytesWritten) engineRunning=\(engine.isRunning)")
        stateLock.lock()
        guard recording else {
            let last = self.lastFinishedUri?.absoluteString
            stateLock.unlock()
            dbg("STOP — already stopped, returning lastChunkUri=\(String(describing: last))")
            return ["lastChunkUri": last as Any?]
        }

        self.rotationTimer?.cancel()
        self.rotationTimer = nil

        engine.stop()
        engine.inputNode.removeTap(onBus: 0)

        let uri = self.currentChunkUri
        let idx = self.currentChunkIdx
        let startTime = self.currentChunkStartedAt

        self.recording = false
        stateLock.unlock()

        // Flush any in-flight writes before tearing down the file. Without
        // this, the last ~100ms of audio is lost because writeQueue is async.
        writeQueue.sync {}

        // Now safe to release the file (finalize the m4a moov atom).
        stateLock.lock()
        self.currentFile = nil
        self.currentChunkUri = nil
        self.currentChunkStartedAt = nil
        stateLock.unlock()

        unregisterNotifications()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])

        if let uri = uri {
            let durationMs = startTime.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
            self.sendEvent("chunkReady", [
                "uri": uri.absoluteString,
                "idx": idx,
                "durationMs": durationMs,
            ])
            self.lastFinishedUri = uri
        }

        return ["lastChunkUri": self.lastFinishedUri?.absoluteString as Any?]
    }

    // MARK: - Notifications

    private func registerNotifications() {
        let nc = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()

        let interruptObs = nc.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: session,
            queue: nil
        ) { [weak self] note in
            self?.handleInterruption(note: note)
        }
        let resetObs = nc.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: session,
            queue: nil
        ) { [weak self] _ in
            self?.handleMediaServicesReset()
        }
        let configObs = nc.addObserver(
            forName: NSNotification.Name.AVAudioEngineConfigurationChange,
            object: engine,
            queue: nil
        ) { [weak self] _ in
            self?.handleConfigurationChange()
        }
        notifObservers = [interruptObs, resetObs, configObs]
    }

    private func unregisterNotifications() {
        let nc = NotificationCenter.default
        for obs in notifObservers { nc.removeObserver(obs) }
        notifObservers.removeAll()
    }

    private func handleInterruption(note: Notification) {
        guard let info = note.userInfo,
              let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
        dbg("INTERRUPTION fired — type=\(type == .began ? "began" : "ended") elapsed=\(elapsedMs())ms engineRunning=\(engine.isRunning)")
        switch type {
        case .began:
            // Engine pauses automatically; wait for .ended.
            break
        case .ended:
            do {
                try AVAudioSession.sharedInstance().setActive(true)
                if !engine.isRunning {
                    try engine.start()
                }
            } catch {
                self.emitError(
                    code: "interruption_resume",
                    message: error.localizedDescription,
                    ns: error as NSError
                )
            }
        @unknown default:
            break
        }
    }

    private func handleMediaServicesReset() {
        dbg("MEDIA SERVICES RESET fired — elapsed=\(elapsedMs())ms")
        self.sendEvent("mediaServicesReset", [
            "at": ISO8601DateFormatter().string(from: Date())
        ])

        stateLock.lock()
        guard recording else {
            stateLock.unlock()
            return
        }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)

        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            try AVAudioSession.sharedInstance().setCategory(
                .playAndRecord,
                mode: .measurement,
                options: [.allowBluetooth, .defaultToSpeaker]
            )
            try AVAudioSession.sharedInstance().setActive(true)

            let inputNode = engine.inputNode
            let inputFormat = inputNode.outputFormat(forBus: 0)
            self.inputCaptureFormat = inputFormat
            inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] (buffer, _) in
                self?.handleTapBuffer(buffer)
            }
            engine.prepare()
            try engine.start()
        } catch {
            self.emitError(
                code: "media_reset_recover_failed",
                message: error.localizedDescription,
                ns: error as NSError
            )
        }
        stateLock.unlock()
    }

    // (logged at top of handleConfigurationChange below)
    // AVAudioEngineConfigurationChange fires when the engine's I/O config
    // changes — e.g. iOS finalizes the input route after start, the user
    // plugs/unplugs headphones, or the system reconfigures the audio path.
    // CRITICAL: iOS REMOVES the input tap automatically when this fires.
    // Without reinstalling, the tap callback stops being invoked, no audio
    // is captured, and the m4a file just gets finalized at whatever
    // duration was captured up to that point. (This is the root cause of
    // the "10-second cutoff" we hit during the first integration test.)
    // Symptoms: file stops growing silently, no error event fires.
    private func handleConfigurationChange() {
        dbg("CONFIG CHANGE fired — elapsed=\(elapsedMs())ms recording=\(recording) engineRunning=\(engine.isRunning)")
        stateLock.lock()
        defer { stateLock.unlock() }
        guard recording else { return }

        // The old tap was removed by iOS as part of the reset. Read the new
        // input format (may differ from the original — e.g. different sample
        // rate after route change) and reinstall.
        let inputNode = engine.inputNode
        let newInputFormat = inputNode.outputFormat(forBus: 0)
        guard newInputFormat.sampleRate > 0,
              newInputFormat.channelCount > 0 else {
            self.emitError(
                code: "config_change_invalid_format",
                message: "Invalid input format after configuration change: \(newInputFormat)",
                ns: nil
            )
            return
        }
        self.inputCaptureFormat = newInputFormat

        // Defensive removeTap in case iOS didn't actually clear it. Removing
        // a non-existent tap is safe.
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: newInputFormat) { [weak self] (buffer, _) in
            self?.handleTapBuffer(buffer)
        }

        // The engine may have been stopped by iOS as well. Restart if needed.
        if !engine.isRunning {
            do {
                engine.prepare()
                try engine.start()
            } catch {
                self.emitError(
                    code: "config_change_engine_restart_failed",
                    message: error.localizedDescription,
                    ns: error as NSError
                )
            }
        }
    }

    // MARK: - Errors

    private func recorderError(code: String, message: String, ns: NSError?) -> NSError {
        var info: [String: Any] = [
            NSLocalizedDescriptionKey: "\(code): \(message)",
            "code": code,
        ]
        if let ns = ns {
            info["domain"] = ns.domain
            info["nativeCode"] = ns.code
        }
        return NSError(domain: "ContinuousAudioRecorder", code: -1, userInfo: info)
    }

    private func emitError(code: String, message: String, ns: NSError?) {
        var payload: [String: Any] = [
            "code": code,
            "message": message,
        ]
        if let ns = ns {
            payload["domain"] = ns.domain
            payload["nativeCode"] = ns.code
        }
        self.sendEvent("error", payload)
    }
}
