import AVFoundation
import SwiftUI
import TeakCore

@MainActor @Observable
final class VoiceRecorder {
    static let maxDuration: TimeInterval = 3600

    private(set) var isRecording = false
    private(set) var elapsed: TimeInterval = 0
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
        isRecording = true
        timer = Task {
            while !Task.isCancelled, let recorder = self.recorder {
                elapsed = recorder.currentTime
                if !recorder.isRecording, elapsed > 0 { break }
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
    }

    func stop() -> UploadItem? {
        timer?.cancel()
        let duration = recorder?.currentTime ?? elapsed
        recorder?.stop()
        recorder = nil
        isRecording = false
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
        _ = stop()
    }
}

struct VoiceMemoView: View {
    @Environment(CaptureModel.self) private var capture
    @Environment(\.dismiss) private var dismiss
    @State private var recorder = VoiceRecorder()
    @State private var isSaving = false
    @State private var failure: String?

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
                    recorder.isRecording ? stop() : start()
                } label: {
                    Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill")
                        .font(.largeTitle)
                        .frame(width: 88, height: 88)
                        .symbolEffect(.pulse, isActive: recorder.isRecording)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .tint(.red)
                .disabled(isSaving)
                .accessibilityLabel(recorder.isRecording ? tr("native.capture.stopRecording") : tr("native.capture.record"))
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
                        recorder.cancel()
                        dismiss()
                    }
                }
            }
            .alert(tr("native.capture.couldntRecord"), isPresented: Binding(presenting: $failure)) {
                Button(tr("native.app.ok")) { failure = nil }
            } message: {
                Text(failure ?? "")
            }
            .sensoryFeedback(.start, trigger: recorder.isRecording)
        }
        .frame(minWidth: 360, minHeight: 420)
        .interactiveDismissDisabled(recorder.isRecording || isSaving)
    }

    private var status: String {
        if isSaving { return tr("common.saving") }
        return recorder.isRecording ? tr("native.capture.recording") : tr("native.capture.tapToRecord")
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
        isSaving = true
        Task {
            await capture.upload([item])
            isSaving = false
            if capture.alert == nil { dismiss() }
        }
    }
}
