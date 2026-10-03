import AVFoundation
import Combine
import SwiftUI

@MainActor
final class AudioCapture: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var file: URL?
    @Published private(set) var error: String?
    private var recorder: AVAudioRecorder?

    func start() async {
        guard await AVAudioApplication.requestRecordPermission() else {
            error = "Allow microphone access in System Settings to record audio."
            return
        }
        discard()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Teak recording \(UUID().uuidString).m4a")
        do {
            let recorder = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 128_000,
            ])
            recorder.delegate = self
            guard recorder.record(forDuration: 3600) else { throw SafariServiceError.message("Couldn’t start recording.") }
            self.recorder = recorder
            file = url
            isRecording = true
            error = nil
        } catch {
            try? FileManager.default.removeItem(at: url)
            self.error = error.localizedDescription
        }
    }

    func stop() {
        recorder?.stop()
        isRecording = false
    }

    func discard() {
        stop()
        if let file { try? FileManager.default.removeItem(at: file) }
        file = nil
        recorder = nil
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in
            guard self.recorder === recorder else { return }
            self.isRecording = false
            if !flag { self.error = "Recording failed. Please try again."; self.discard() }
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        Task { @MainActor in
            guard self.recorder === recorder else { return }
            self.error = "Recording failed. Please try again."
            self.discard()
        }
    }
}

struct AudioCaptureSheet: View {
    let onCreated: (String) -> Void
    let onAuthenticationRequired: () -> Void
    @Environment(\.dismiss) private var dismiss
    @StateObject private var audio = AudioCapture()
    @State private var isSaving = false
    @State private var isStarting = false
    @State private var error: String?
    @State private var api = LibraryAPI()
    @State private var idempotencyKey = UUID().uuidString

    @State private var startedAt = Date()

    var body: some View {
        VStack {
            Text("Recording audio").font(.headline)
            Text("Speak naturally. Teak will save this as an audio card.")
            TimelineView(.periodic(from: startedAt, by: 1)) { context in
                let elapsed = max(0, Int(context.date.timeIntervalSince(startedAt)))
                Text(String(format: "%d:%02d", elapsed / 60, elapsed % 60)).monospacedDigit()
            }
            if let message = error ?? audio.error { Text(message).foregroundStyle(.red) }
            HStack {
                Button("Cancel") { dismiss() }.disabled(isSaving || isStarting)
                Button("Stop and Save") {
                    audio.stop()
                    Task { await save() }
                }.disabled(isSaving || isStarting || audio.file == nil || audio.error != nil)
            }
        }
        .scenePadding()
        .frame(minWidth: 460)
        .interactiveDismissDisabled(isSaving || isStarting)
        .task {
            isStarting = true
            await audio.start()
            startedAt = Date()
            isStarting = false
        }
        .onDisappear { audio.discard() }
    }

    private func save() async {
        guard !isSaving, let file = audio.file else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let id = try await api.createFile(file, mimeType: "audio/mp4", idempotencyKey: idempotencyKey)
            onCreated(id)
            dismiss()
        } catch SafariServiceError.unauthenticated { onAuthenticationRequired() }
        catch { self.error = error.localizedDescription }
    }
}
