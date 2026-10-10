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
        content
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

    #if os(macOS)
    /// A grouped form like System Settings: each way to add has a push button.
    private var content: some View {
        Form {
            Section("Write") {
                AddAction("Note or Link", detail: "Write a note, or paste a link to save the page.",
                          symbol: "square.and.pencil") {
                    Button("New Note") { router.compose() }
                }
                AddAction("Voice Memo", detail: "Record a voice note and save it with its transcript.",
                          symbol: "mic") {
                    Button("Record…") { router.isRecording = true }
                }
            }
            Section {
                AddAction("Photos & Videos", detail: "Choose from your Photos library.", symbol: "photo.on.rectangle") {
                    PhotosPicker("Choose…", selection: $photos, maxSelectionCount: TeakLimits.maxFilesPerUpload,
                                 selectionBehavior: .ordered, matching: .any(of: [.images, .videos]))
                }
                AddAction("Files", detail: "Up to \(TeakLimits.maxFilesPerUpload) at a time, \(maxFileSize) each.",
                          symbol: "folder") {
                    Button("Choose Files…") { router.isImportingFiles = true }
                }
            } header: {
                Text("Upload")
            } footer: {
                Text("You can also drop files onto the library, or paste them with ⌘V.")
                    .foregroundStyle(.secondary)
            }
            if let upload = capture.upload {
                Section {
                    ProgressView(value: Double(upload.done), total: Double(upload.total)) {
                        Text("Saving \(min(upload.done + 1, upload.total)) of \(upload.total)…")
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    private var maxFileSize: String {
        Int64(TeakLimits.maxFileSize).formatted(.byteCount(style: .memory))
    }
    #else
    private var content: some View {
        @Bindable var router = router
        return List {
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
            }
            if let upload = capture.upload {
                Section {
                    ProgressView(value: Double(upload.done), total: Double(upload.total)) {
                        Text("Saving \(min(upload.done + 1, upload.total)) of \(upload.total)…")
                    }
                }
            }
        }
        .tint(.primary)
    }

    private func row(_ title: String, symbol: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) { AddRowLabel(title: title, symbol: symbol, color: color) }
    }
    #endif
}

#if os(macOS)
/// One way to add on the Mac: what it is on the left, its button on the right.
private struct AddAction<Control: View>: View {
    let title: String
    let detail: String
    let symbol: String
    @ViewBuilder let control: Control

    init(_ title: String, detail: String, symbol: String, @ViewBuilder control: () -> Control) {
        self.title = title
        self.detail = detail
        self.symbol = symbol
        self.control = control()
    }

    var body: some View {
        LabeledContent {
            control
        } label: {
            Label {
                Text(title)
                Text(detail)
            } icon: {
                Image(systemName: symbol)
            }
        }
    }
}
#endif

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
