import ExpoModulesCore
import AVFoundation

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

    private var converter: AVAudioConverter?
    private var outputFormat: AVAudioFormat?
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
            try session.setCategory(
                .playAndRecord,
                mode: .default,
                options: [.allowBluetooth, .defaultToSpeaker, .mixWithOthers]
            )
            try session.setPreferredSampleRate(self.sampleRateOpt)
            try session.setActive(true)
        } catch {
            stateLock.unlock()
            throw recorderError(
                code: "audio_session",
                message: error.localizedDescription,
                ns: error as NSError
            )
        }

        // Output format (for tap converter and AVAudioFile processing)
        guard let outputFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: self.sampleRateOpt,
            channels: AVAudioChannelCount(self.channelsOpt),
            interleaved: false
        ) else {
            stateLock.unlock()
            throw recorderError(
                code: "output_format",
                message: "Failed to construct output format",
                ns: nil
            )
        }
        self.outputFormat = outputFormat

        self.fileSettings = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: self.sampleRateOpt,
            AVNumberOfChannelsKey: self.channelsOpt,
            AVEncoderBitRateKey: self.bitRateOpt,
        ]

        // Engine input format
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

        guard let conv = AVAudioConverter(from: inputFormat, to: outputFormat) else {
            stateLock.unlock()
            throw recorderError(
                code: "tap_install",
                message: "Cannot create converter \(inputFormat) → \(outputFormat)",
                ns: nil
            )
        }
        self.converter = conv

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
        let firstUri = self.currentChunkUri?.absoluteString ?? ""
        let inputSampleRate = inputFormat.sampleRate
        let inputChannels = Int(inputFormat.channelCount)
        stateLock.unlock()

        registerNotifications()

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
        guard let converter = self.converter, let outputFormat = self.outputFormat else { return }

        let ratio = outputFormat.sampleRate / inputBuffer.format.sampleRate
        let outCapacity = AVAudioFrameCount(Double(inputBuffer.frameLength) * ratio + 1024)
        guard outCapacity > 0,
              let outBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: outCapacity) else {
            return
        }

        var error: NSError?
        var inputProvided = false
        let status = converter.convert(to: outBuffer, error: &error) { _, outStatus in
            if inputProvided {
                outStatus.pointee = .noDataNow
                return nil
            }
            inputProvided = true
            outStatus.pointee = .haveData
            return inputBuffer
        }

        if let error = error {
            self.emitError(code: "convert_failed", message: error.localizedDescription, ns: error)
            return
        }
        guard status == .haveData || status == .endOfStream else { return }
        if outBuffer.frameLength == 0 { return }

        stateLock.lock()
        defer { stateLock.unlock() }
        guard let file = self.currentFile else { return }
        do {
            try file.write(from: outBuffer)
        } catch {
            self.emitError(code: "file_write", message: error.localizedDescription, ns: error as NSError)
        }
    }

    // MARK: - Chunk file management

    // Caller must hold stateLock.
    private func openNextChunkFileLocked() throws {
        guard let outputDir = self.outputDirUrl else { return }
        let idx = self.currentChunkIdx
        let url = outputDir.appendingPathComponent(String(format: "chunk_%04d.m4a", idx))
        try? FileManager.default.removeItem(at: url)
        let file = try AVAudioFile(
            forWriting: url,
            settings: self.fileSettings,
            commonFormat: .pcmFormatFloat32,
            interleaved: false
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
        stateLock.lock()
        guard recording else {
            let last = self.lastFinishedUri?.absoluteString
            stateLock.unlock()
            return ["lastChunkUri": last as Any?]
        }

        self.rotationTimer?.cancel()
        self.rotationTimer = nil

        engine.stop()
        engine.inputNode.removeTap(onBus: 0)

        let uri = self.currentChunkUri
        let idx = self.currentChunkIdx
        let startTime = self.currentChunkStartedAt
        self.currentFile = nil
        self.currentChunkUri = nil
        self.currentChunkStartedAt = nil

        self.recording = false
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
                mode: .default,
                options: [.allowBluetooth, .defaultToSpeaker, .mixWithOthers]
            )
            try AVAudioSession.sharedInstance().setActive(true)

            let inputNode = engine.inputNode
            let inputFormat = inputNode.outputFormat(forBus: 0)
            if let outFormat = self.outputFormat,
               let conv = AVAudioConverter(from: inputFormat, to: outFormat) {
                self.converter = conv
            }
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

    private func handleConfigurationChange() {
        stateLock.lock()
        defer { stateLock.unlock() }
        let inputFormat = engine.inputNode.outputFormat(forBus: 0)
        if let outFormat = self.outputFormat,
           let conv = AVAudioConverter(from: inputFormat, to: outFormat) {
            self.converter = conv
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
