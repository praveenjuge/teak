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
    struct Alert: Identifiable, Equatable {
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

    init(backend: TeakBackend) {
        self.backend = backend
    }

    var isUploading: Bool { upload != nil }

    @discardableResult
    func saveText(_ raw: String) async -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            alert = Alert(title: tr("native.capture.nothingToSave"), message: tr("native.capture.nothingToSaveMessage"))
            return nil
        }
        isSavingText = true
        defer { isSavingText = false }
        do {
            let input = LinkDetection.resolve(raw)
            let id = try await backend.mutation(ConvexFunctions.createCard, input.createArgs)
            saved(input.type == .link ? tr("native.capture.linkSaved") : tr("native.capture.noteSaved"))
            return id
        } catch let error as TeakError where error.isCardLimit {
            alert = Alert(title: tr("native.capture.cardLimitReached"), message: error.message, isCardLimit: true)
        } catch {
            alert = Alert(title: tr("native.capture.couldntSave"), message: tr("native.capture.saveFailedMessage"))
        }
        return nil
    }

    func upload(_ items: [UploadItem]) async {
        guard !items.isEmpty, upload == nil else { return }
        let files = Array(items.prefix(TeakLimits.maxFilesPerUpload))
        if items.count > files.count {
            alert = Alert(title: tr("native.capture.tooManyFiles"),
                          message: tr("native.capture.tooManyFilesMessage",
                                      TeakLimits.maxFilesPerUpload.formatted(.number.locale(AppLanguage.locale))))
        }
        let pipeline = UploadPipeline(convex: backend)
        upload = (0, files.count)
        defer { upload = nil }
        var saved = 0
        var lastError: TeakError?
        for file in files {
            do {
                _ = try await pipeline.upload(file)
                saved += 1
                upload = (saved, files.count)
            } catch {
                let teak = error as? TeakError ?? TeakError(message: error.teakMessage)
                lastError = teak
                if teak.isCardLimit { break }
            }
        }
        if let lastError, lastError.isCardLimit {
            alert = Alert(title: tr("native.capture.cardLimitReached"), message: lastError.message, isCardLimit: true)
        } else if let lastError {
            let locale = AppLanguage.locale
            let title = saved > 0
                ? tr("native.capture.savedSome", saved.formatted(.number.locale(locale)), files.count.formatted(.number.locale(locale)))
                : tr("native.capture.uploadFailed")
            alert = Alert(title: title, message: lastError.message)
        }
        if saved > 0 {
            self.saved(saved == 1 ? tr("native.capture.savedToTeak") : tr("native.capture.savedItems", count: saved))
        }
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

    func save(_ items: [SharedItem]) async {
        var files: [UploadItem] = []
        for item in items {
            switch item {
            case let .text(text): await saveText(text)
            case let .file(file): files.append(await Self.describe(file.fileURL, mimeType: file.mimeType))
            }
        }
        await upload(files)
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
