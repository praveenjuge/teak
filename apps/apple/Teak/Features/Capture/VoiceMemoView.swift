import AVFoundation
import SwiftUI
import TeakCore

@MainActor @Observable
final class VoiceRecorder {
    static let maxDuration: TimeInterval = 3600

    private(set) var isRecording = false
    private(set) var elapsed: TimeInterval = 0
    /// The system stopped the recording: a call, Siri, the screen locking, or the hour running out.
    private(set) var stoppedOnItsOwn = false
    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var timer: Task<Void, Never>?
    @ObservationIgnored private var fileURL: URL?

    enum Failure: Error { case permission, start }

    func start() async throws {
        guard await AVAudioApplication.requestRecordPermission() else { throw Failure.permission }
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try session.setActive(true)
        #endif
        let url = try ItemProviders.temporaryFolder()
            .appending(path: "recording-\(Int(Date().timeIntervalSince1970 * 1000)).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        guard recorder.record(forDuration: Self.maxDuration) else { throw Failure.start }
        self.recorder = recorder
        fileURL = url
        elapsed = 0
        stoppedOnItsOwn = false
        isRecording = true
        timer = Task {
            while !Task.isCancelled, let recorder = self.recorder {
                // A stopped recorder reads 0, so the last time read is the length.
                guard recorder.isRecording else {
                    stoppedOnItsOwn = true
                    break
                }
                elapsed = recorder.currentTime
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
    }

    func stop() -> UploadItem? {
        timer?.cancel()
        let duration = recorder?.isRecording == true ? recorder?.currentTime ?? elapsed : elapsed
        recorder?.stop()
        recorder = nil
        isRecording = false
        stoppedOnItsOwn = false
        elapsed = 0
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
        guard let fileURL else { return nil }
        self.fileURL = nil
        var item = ItemProviders.item(for: fileURL)
        item.mimeType = "audio/mp4"
        item.duration = duration > 0 ? duration : nil
        return item
    }

    func cancel() {
        if let item = stop() { VoiceRecorder.discard(item) }
    }

    static func discard(_ item: UploadItem) {
        ItemProviders.discard(item)
    }
}

struct VoiceMemoView: View {
    @Environment(CaptureModel.self) private var capture
    @Environment(\.dismiss) private var dismiss
    @State private var recorder = VoiceRecorder()
    @State private var isSaving = false
    @State private var failure: String?
    @State private var recording: UploadItem?
    @State private var uploadFailure: CaptureModel.Alert?
    @State private var confirmDiscard = false
    @State private var stoppedWhileConfirming = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 28) {
                Spacer()
                Text(CardSheet.formatDuration(recorder.elapsed))
                    .font(.system(size: 56, weight: .medium, design: .rounded).monospacedDigit())
                    .contentTransition(.numericText())
                    .accessibilityLabel(tr("native.capture.recordingTime", CardSheet.formatDuration(recorder.elapsed)))
                Text(status).foregroundStyle(.secondary)
                Button {
                    if recording != nil { upload() } else if recorder.isRecording { stop() } else { start() }
                } label: {
                    Image(systemName: symbol)
                        .font(.largeTitle)
                        .frame(width: 88, height: 88)
                        .symbolEffect(.pulse, isActive: recorder.isRecording)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .tint(.red)
                .disabled(isSaving)
                .accessibilityLabel(buttonLabel)
                .keyboardShortcut(.space, modifiers: [])
                Spacer()
            }
            .frame(maxWidth: .infinity)
            .navigationTitle(tr("native.capture.voiceMemo"))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(tr("common.cancel")) {
                        if recorder.isRecording || recording != nil { confirmDiscard = true } else { discard() }
                    }
                    .disabled(isSaving)
                    .confirmationDialog(tr("native.capture.discardTitle"), isPresented: $confirmDiscard) {
                        Button(tr("native.capture.discard"), role: .destructive) { discard() }
                        Button(tr("common.cancel"), role: .cancel) {
                            if stoppedWhileConfirming { upload() }
                        }
                    } message: {
                        if recorder.isRecording { Text(tr("native.capture.discardMessage")) }
                    }
                }
            }
            .alert(uploadFailure?.title ?? "", isPresented: Binding(presenting: $uploadFailure), presenting: uploadFailure) { _ in
                Button(tr("common.tryAgain")) { upload() }
                Button(tr("native.app.ok"), role: .cancel) {}
            } message: { alert in
                Text(alert.message)
            }
            .alert(tr("native.capture.couldntRecord"), isPresented: Binding(presenting: $failure)) {
                Button(tr("native.app.ok")) { failure = nil }
            } message: {
                Text(failure ?? "")
            }
            .sensoryFeedback(.start, trigger: recorder.isRecording)
            .onChange(of: recorder.stoppedOnItsOwn) { _, stopped in
                guard stopped else { return }
                if confirmDiscard {
                    recording = recorder.stop()
                    stoppedWhileConfirming = true
                } else {
                    stop()
                }
            }
        }
        .frame(minWidth: 360, minHeight: 420)
        .interactiveDismissDisabled(recorder.isRecording || isSaving || recording != nil)
        .captureAlert()
        // Signing out or closing the Mac window can take the sheet away
        // mid-recording: stop the mic and drop the file.
        .onDisappear {
            recorder.cancel()
            if let recording, !isSaving { VoiceRecorder.discard(recording) }
        }
    }

    private var status: String {
        if isSaving { return tr("common.saving") }
        if recording != nil { return tr("native.capture.uploadFailed") }
        return recorder.isRecording ? tr("native.capture.recording") : tr("native.capture.tapToRecord")
    }

    private var symbol: String {
        if recording != nil { return "arrow.clockwise" }
        return recorder.isRecording ? "stop.fill" : "mic.fill"
    }

    private var buttonLabel: String {
        if recording != nil { return tr("common.tryAgain") }
        return recorder.isRecording ? tr("native.capture.stopRecording") : tr("native.capture.record")
    }

    private func start() {
        Task {
            do {
                try await recorder.start()
            } catch VoiceRecorder.Failure.permission {
                failure = tr("native.capture.micNeeded")
            } catch {
                failure = tr("native.capture.startFailed")
            }
        }
    }

    private func stop() {
        guard let item = recorder.stop() else { return }
        recording = item
        upload()
    }

    private func upload() {
        stoppedWhileConfirming = false
        guard let item = recording else { return }
        isSaving = true
        Task {
            let failure = await capture.upload([item], showsAlert: false)
            isSaving = false
            if let failure {
                if failure.isCardLimit { capture.alert = failure } else { uploadFailure = failure }
            } else {
                recording = nil
                dismiss()
            }
        }
    }

    private func discard() {
        recorder.cancel()
        if let recording { VoiceRecorder.discard(recording) }
        recording = nil
        dismiss()
    }
}
