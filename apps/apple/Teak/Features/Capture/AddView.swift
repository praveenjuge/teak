import PhotosUI
import SwiftUI
import TeakCore
import UniformTypeIdentifiers

struct AddView: View {
    @Environment(AppRouter.self) private var router
    @Environment(CaptureModel.self) private var capture
    @State private var photos: [PhotosPickerItem] = []

    var body: some View {
        content
            .navigationTitle(tr("native.capture.title"))
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
    private var content: some View {
        Form {
            Section(tr("native.capture.write")) {
                AddAction(tr("native.capture.noteOrLink"), detail: tr("native.capture.noteOrLinkDetail"),
                          symbol: "square.and.pencil") {
                    Button(tr("native.capture.newNote")) { router.compose() }
                }
                AddAction(tr("native.capture.voiceMemo"), detail: tr("native.capture.voiceMemoDetail"),
                          symbol: "mic") {
                    Button(tr("native.capture.recordEllipsis")) { router.isRecording = true }
                }
            }
            Section {
                AddAction(tr("native.capture.photosAndVideos"), detail: tr("native.capture.photosDetail"),
                          symbol: "photo.on.rectangle") {
                    PhotosPicker(tr("native.capture.chooseEllipsis"), selection: $photos,
                                 maxSelectionCount: TeakLimits.maxFilesPerUpload,
                                 selectionBehavior: .ordered, matching: .any(of: [.images, .videos]))
                }
                AddAction(tr("native.capture.files"), detail: tr("native.capture.filesDetail", maxFiles, maxFileSize),
                          symbol: "folder") {
                    Button(tr("native.capture.chooseFiles")) { router.isImportingFiles = true }
                }
            } header: {
                Text(tr("native.capture.upload"))
            } footer: {
                Text(tr("native.capture.dropHint"))
                    .foregroundStyle(.secondary)
            }
            if let upload = capture.upload {
                Section {
                    ProgressView(value: Double(upload.done), total: Double(upload.total)) {
                        Text(savingProgress(upload))
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    private var maxFiles: String {
        TeakLimits.maxFilesPerUpload.formatted(.number.locale(AppLanguage.locale))
    }

    private var maxFileSize: String {
        Int64(TeakLimits.maxFileSize).formatted(.byteCount(style: .memory).locale(AppLanguage.locale))
    }
    #else
    private var content: some View {
        @Bindable var router = router
        return List {
            Section(tr("native.capture.write")) {
                row(tr("native.capture.noteOrLink"), symbol: "doc.text.fill", color: .blue) { router.compose() }
                row(tr("native.capture.voiceMemo"), symbol: "mic.fill", color: .orange) { router.isRecording = true }
            }
            Section(tr("native.capture.upload")) {
                PhotosPicker(selection: $photos, maxSelectionCount: TeakLimits.maxFilesPerUpload,
                             selectionBehavior: .ordered, matching: .any(of: [.images, .videos])) {
                    AddRowLabel(title: tr("native.capture.photosAndVideos"), symbol: "photo.on.rectangle", color: .green)
                }
                #if os(iOS)
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    row(tr("native.capture.camera"), symbol: "camera.fill", color: .gray) { router.isUsingCamera = true }
                }
                #endif
                row(tr("native.capture.files"), symbol: "folder.fill", color: .cyan) { router.isImportingFiles = true }
            }
            if let upload = capture.upload {
                Section {
                    ProgressView(value: Double(upload.done), total: Double(upload.total)) {
                        Text(savingProgress(upload))
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

/// "Saving 2 of 5…", with the numbers in the app's language.
private func savingProgress(_ upload: (done: Int, total: Int)) -> String {
    let locale = AppLanguage.locale
    return tr("native.capture.savingProgress", min(upload.done + 1, upload.total).formatted(.number.locale(locale)),
              upload.total.formatted(.number.locale(locale)))
}

#if os(macOS)
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
