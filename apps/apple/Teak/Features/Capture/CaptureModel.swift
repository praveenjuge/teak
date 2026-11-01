import AVFoundation
import CoreTransferable
import Foundation
import ImageIO
import Observation
import PhotosUI
import SwiftUI
import TeakCore
import TeakSync
import UniformTypeIdentifiers

@MainActor @Observable
final class CaptureModel {
    struct Alert: Identifiable, Equatable, Error {
        let id = UUID()
        let title: String
        let message: String
        var isCardLimit = false
    }

    private(set) var isSavingText = false
    private(set) var upload: (done: Int, total: Int)?
    var alert: Alert?
    private(set) var savedCount = 0
    private(set) var lastSaved: String?

    @ObservationIgnored private let backend: TeakBackend
    @ObservationIgnored private var uploadQueue: Task<Void, Never>?
    /// Moves on at each sign-out, so batches queued before it are dropped.
    @ObservationIgnored private var epoch = 0

    init(backend: TeakBackend) {
        self.backend = backend
    }

    var isUploading: Bool { upload != nil }

    @discardableResult
    func saveText(_ raw: String) async -> String? {
        // A second Return or ⌘Return can queue before the first save sets the flag; it saves nothing.
        guard !isSavingText else { return nil }
        let result = await createText(raw)
        if case let .failure(failure) = result { alert = failure }
        return try? result.get()
    }

    private func createText(_ raw: String) async -> Result<String, Alert> {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return .failure(Alert(title: tr("native.share.nothingToSave"), message: tr("native.capture.nothingToSaveMessage")))
        }
        isSavingText = true
        defer { isSavingText = false }
        do {
            let input = LinkDetection.resolve(raw)
            let id = try await backend.mutation(ConvexFunctions.createCard, input.createArgs)
            saved(input.type == .link ? tr("native.capture.linkSaved") : tr("native.capture.noteSaved"))
            return .success(id)
        } catch let error as TeakError where error.isCardLimit {
            return .failure(Alert(title: tr("native.capture.cardLimitReached"), message: error.message, isCardLimit: true))
        } catch {
            return .failure(Alert(title: tr("native.capture.couldntSave"), message: tr("native.capture.saveFailedMessage")))
        }
    }

    func reset() {
        epoch += 1
        uploadQueue = nil
        upload = nil
        alert = nil
    }

    @discardableResult
    func upload(_ items: [UploadItem], showsAlert: Bool = true) async -> Alert? {
        guard !items.isEmpty else { return nil }
        let previous = uploadQueue
        let queuedIn = epoch
        let batch = Task {
            await previous?.value
            return await self.run(items, queuedIn: queuedIn)
        }
        uploadQueue = Task { _ = await batch.value }
        let failure = await batch.value
        if showsAlert, let failure { alert = failure }
        return failure
    }

    private func run(_ items: [UploadItem], queuedIn: Int) async -> Alert? {
        // A batch queued before signing out never starts, so it can't bring back the progress `reset()` cleared.
        guard queuedIn == epoch else { return nil }
        // Background time on iOS, so leaving the app doesn't cut an upload off.
        let finish = await SystemActivity().begin(reason: "Uploading to Teak") {}
        defer { finish?() }
        let files = Array(items.prefix(TeakLimits.maxFilesPerUpload))
        var failure: Alert?
        if items.count > files.count {
            failure = Alert(title: tr("native.capture.tooManyFiles"),
                            message: tr("native.capture.tooManyFilesMessage",
                                        TeakLimits.maxFilesPerUpload.formatted(.number.locale(AppLanguage.locale))))
        }
        let pipeline = UploadPipeline(convex: backend)
        upload = (0, files.count)
        defer { if queuedIn == epoch { upload = nil } }
        var saved = 0
        var lastError: TeakError?
        for file in files {
            // Signing out drops the rest: they belong to the account that queued them.
            guard queuedIn == epoch, !Task.isCancelled else { return nil }
            do {
                _ = try await pipeline.upload(file)
                guard queuedIn == epoch else { return nil }
                saved += 1
                upload = (saved, files.count)
            } catch {
                let teak = error as? TeakError ?? TeakError(message: error.teakMessage)
                lastError = teak
                if teak.isCardLimit { break }
            }
        }
        guard queuedIn == epoch else { return nil }
        if let lastError, lastError.isCardLimit {
            failure = Alert(title: tr("native.capture.cardLimitReached"), message: lastError.message, isCardLimit: true)
        } else if let lastError {
            let locale = AppLanguage.locale
            let title = saved > 0
                ? tr("native.capture.savedSome", saved.formatted(.number.locale(locale)), files.count.formatted(.number.locale(locale)))
                : tr("native.capture.uploadFailed")
            failure = Alert(title: title, message: lastError.message)
        }
        if saved > 0 {
            self.saved(saved == 1 ? tr("native.capture.savedToTeak") : tr("native.capture.savedItems", count: saved))
        }
        return failure
    }

    func uploadPicked(_ urls: [URL]) async {
        var items: [UploadItem] = []
        var skipped = 0
        for url in urls {
            guard let item = try? ItemProviders.copyPicked(url), (try? UploadPipeline.validate(item)) != nil else {
                skipped += 1
                continue
            }
            items.append(item)
        }
        if skipped > 0 {
            alert = items.isEmpty
                ? Alert(title: tr("native.capture.unsupportedFile"), message: tr("native.capture.unsupportedFileMessage"))
                : Alert(title: tr("native.capture.someSkipped"), message: tr("native.capture.someSkippedMessage"))
        }
        await upload(items)
    }

    func uploadPhotos(_ selection: [PhotosPickerItem]) async {
        var items: [UploadItem] = []
        for (index, picked) in selection.prefix(TeakLimits.maxFilesPerUpload).enumerated() {
            guard let file = try? await picked.loadTransferable(type: PickedFile.self) else { continue }
            var item = await Self.describe(file.url)
            if item.fileName.isEmpty {
                item.fileName = "upload_\(Int(Date().timeIntervalSince1970 * 1000))_\(index + 1).jpg"
            }
            items.append(item)
        }
        if items.isEmpty, !selection.isEmpty {
            alert = Alert(title: tr("native.capture.errorTitle"), message: tr("native.capture.photosFailed"))
            return
        }
        await upload(items)
    }

    @discardableResult
    func save(_ items: [SharedItem], showsAlert: Bool = true) async -> Alert? {
        var files: [UploadItem] = []
        var failure: Alert?
        for item in items {
            switch item {
            case let .text(text):
                if case let .failure(textFailure) = await createText(text) { failure = textFailure }
            case let .file(file): files.append(await Self.describe(file.fileURL, mimeType: file.mimeType))
            }
        }
        if let uploadFailure = await upload(files, showsAlert: false) { failure = uploadFailure }
        if showsAlert, let failure { alert = failure }
        return failure
    }

    func save(_ providers: [NSItemProvider]) async {
        await save(await ItemProviders.load(providers))
    }

    private func saved(_ message: String) {
        lastSaved = message
        savedCount += 1
    }

    static func describe(_ url: URL, mimeType: String? = nil) async -> UploadItem {
        var item = ItemProviders.item(for: url)
        if let mimeType { item.mimeType = mimeType }
        let type = UTType(filenameExtension: url.pathExtension)
        if type?.conforms(to: .image) == true,
           let source = CGImageSourceCreateWithURL(url as CFURL, nil),
           let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] {
            item.width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue
            item.height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue
        } else if type?.conforms(to: .audiovisualContent) == true {
            let asset = AVURLAsset(url: url)
            if let duration = try? await asset.load(.duration), duration.seconds.isFinite {
                item.duration = duration.seconds
            }
            if let track = try? await asset.loadTracks(withMediaType: .video).first,
               let size = try? await track.load(.naturalSize), let transform = try? await track.load(.preferredTransform) {
                let rect = CGRect(origin: .zero, size: size).applying(transform)
                item.width = abs(rect.width)
                item.height = abs(rect.height)
            }
        }
        return item
    }
}

extension View {
    /// Shows what went wrong saving or uploading, while `active`. Only one
    /// view at a time can present it: the one on top.
    func captureAlert(when active: Bool = true) -> some View {
        modifier(CaptureAlert(active: active))
    }
}

private struct CaptureAlert: ViewModifier {
    let active: Bool
    @Environment(CaptureModel.self) private var capture

    func body(content: Content) -> some View {
        content.alert(capture.alert?.title ?? "",
                      isPresented: Binding(get: { active && capture.alert != nil }, set: { if !$0 { capture.alert = nil } }),
                      presenting: capture.alert) { alert in
            #if os(macOS)
            if alert.isCardLimit {
                Button(tr("native.app.upgrade")) { NSWorkspace.shared.open(AppServices.shared.app.config.webURL.appending(path: "settings")) }
            }
            #endif
            Button(tr("native.app.ok"), role: .cancel) {}
        } message: { alert in
            Text(alert.message)
        }
    }
}

struct PickedFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie, importing: copy)
        FileRepresentation(importedContentType: .image, importing: copy)
    }

    private static func copy(_ received: ReceivedTransferredFile) throws -> PickedFile {
        let destination = try ItemProviders.temporaryFolder().appending(path: received.file.lastPathComponent)
        try FileManager.default.copyItem(at: received.file, to: destination)
        return PickedFile(url: destination)
    }
}
