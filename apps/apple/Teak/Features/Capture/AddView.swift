import PhotosUI
import SwiftUI
import TeakCore
import UniformTypeIdentifiers

/// The Add tab: write a note or link, record a voice memo, or upload.
struct AddView: View {
    @Environment(AppRouter.self) private var router
    @Environment(CaptureModel.self) private var capture
    @State private var photos: [PhotosPickerItem] = []

    var body: some View {
        @Bindable var router = router
        List {
            Section("Write") {
                row("Note or Link", symbol: "doc.text.fill", color: .blue) { router.compose() }
                row("Voice Memo", symbol: "mic.fill", color: .orange) { router.isRecording = true }
            }
            Section("Upload") {
                PhotosPicker(selection: $photos, maxSelectionCount: TeakLimits.maxFilesPerUpload,
                             selectionBehavior: .ordered, matching: .any(of: [.images, .videos])) {
                    AddRowLabel(title: "Photos & Videos", symbol: "photo.on.rectangle", color: .green)
                }
                #if os(iOS)
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    row("Camera", symbol: "camera.fill", color: .gray) { router.isUsingCamera = true }
                }
                #endif
                row("Files", symbol: "folder.fill", color: .cyan) { router.isImportingFiles = true }
                PasteButton(supportedContentTypes: [.fileURL, .image, .url, .plainText]) { providers in
                    Task { await capture.save(providers) }
                }
                .labelStyle(.titleAndIcon)
            }
            if let upload = capture.upload {
                Section {
                    ProgressView(value: Double(upload.done), total: Double(upload.total)) {
                        Text("Saving \(min(upload.done + 1, upload.total)) of \(upload.total)…")
                    }
                }
            }
        }
        .navigationTitle("Add")
        .disabled(capture.isUploading)
        .onChange(of: photos) { _, selection in
            guard !selection.isEmpty else { return }
            Task {
                await capture.uploadPhotos(selection)
                photos = []
            }
        }
    }

    private func row(_ title: String, symbol: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) { AddRowLabel(title: title, symbol: symbol, color: color) }
    }
}

private struct AddRowLabel: View {
    let title: String
    let symbol: String
    let color: Color

    var body: some View {
        Label {
            Text(title).foregroundStyle(.primary)
        } icon: {
            Image(systemName: symbol)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(color.gradient, in: .rect(cornerRadius: 7))
        }
    }
}

#if os(iOS)
/// Takes a photo or video with the camera.
struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (URL) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.image.identifier, UTType.movie.identifier]
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            let stamp = Int(Date().timeIntervalSince1970 * 1000)
            if let movie = info[.mediaURL] as? URL,
               let folder = try? ItemProviders.temporaryFolder() {
                let destination = folder.appending(path: "capture_\(stamp).\(movie.pathExtension.isEmpty ? "mov" : movie.pathExtension)")
                if (try? FileManager.default.copyItem(at: movie, to: destination)) != nil { parent.onCapture(destination) }
            } else if let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.95),
                      let folder = try? ItemProviders.temporaryFolder() {
                let destination = folder.appending(path: "capture_\(stamp).jpg")
                if (try? data.write(to: destination)) != nil { parent.onCapture(destination) }
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
#endif
