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

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Record audio").font(.title3.weight(.semibold))
            Label(audio.isRecording ? "Recording…" : audio.file == nil ? "Ready to record" : "Recording ready",
                  systemImage: "waveform")
            Text("Up to 1 hour. Audio is uploaded when you save.").font(.caption).foregroundStyle(.secondary)
            Button(audio.isRecording ? "Stop Recording" : audio.file == nil ? "Start Recording" : "Record Again") {
                if audio.isRecording { audio.stop() }
                else {
                    isStarting = true
                    idempotencyKey = UUID().uuidString
                    Task { await audio.start(); isStarting = false }
                }
            }
            .disabled(isSaving || isStarting)
            if let message = error ?? audio.error { Text(message).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.disabled(isSaving || isStarting)
                Button(isSaving ? "Uploading…" : "Save") { Task { await save() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSaving || isStarting || audio.isRecording || audio.file == nil)
            }
        }
        .padding(24).frame(width: 460)
        .interactiveDismissDisabled(isSaving || isStarting || audio.isRecording)
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
