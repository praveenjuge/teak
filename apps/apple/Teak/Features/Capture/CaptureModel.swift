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

/// Saves what people capture: notes and links, and files uploaded one at a
/// time with a summary at the end, like the iPhone and Mac apps.
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
    /// Bumps on every save, for haptics and the Mac HUD.
    private(set) var savedCount = 0
    private(set) var lastSaved: String?

    @ObservationIgnored private let backend: TeakBackend

    init(backend: TeakBackend) {
        self.backend = backend
    }

    var isUploading: Bool { upload != nil }

    // MARK: Text

    /// Saves a note, or a link when the text is a URL. Returns the card ID.
    @discardableResult
    func saveText(_ raw: String) async -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            alert = Alert(title: "Nothing to Save", message: "Enter a bookmark, URL, or note before saving.")
            return nil
        }
        isSavingText = true
        defer { isSavingText = false }
        do {
            let input = LinkDetection.resolve(raw)
            let id: String = try await backend.mutation("cards:createCard", input.createArgs)
            saved(input.type == .link ? "Link saved" : "Note saved")
            return id
        } catch let error as TeakError where error.isCardLimit {
            alert = Alert(title: "Card limit reached", message: error.message, isCardLimit: true)
        } catch {
            alert = Alert(title: "Couldn't Save", message: "Failed to save card. Please try again.")
        }
        return nil
    }

    // MARK: Files

    /// Uploads up to five files one at a time. The card limit stops the rest.
    func upload(_ items: [UploadItem]) async {
        guard !items.isEmpty, upload == nil else { return }
        let files = Array(items.prefix(TeakLimits.maxFilesPerUpload))
        if items.count > files.count {
            alert = Alert(title: "Too many files",
                          message: "Teak saves up to \(TeakLimits.maxFilesPerUpload) files at a time. The first \(TeakLimits.maxFilesPerUpload) will be saved.")
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
            alert = Alert(title: "Card limit reached", message: lastError.message, isCardLimit: true)
        } else if let lastError {
            alert = Alert(title: saved > 0 ? "Saved \(saved) of \(files.count)" : "Upload failed", message: lastError.message)
        }
        if saved > 0 { self.saved(saved == 1 ? "Saved to Teak" : "Saved \(saved) items") }
    }

    /// Files from a picker: unsupported formats are skipped with a message.
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
            alert = Alert(title: items.isEmpty ? "Unsupported File" : "Some files were skipped",
                          message: items.isEmpty ? "This file format cannot be uploaded." : "Some file formats cannot be uploaded.")
        }
        await upload(items)
    }

    /// Photos and videos, in the order picked, with their size and duration.
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
            alert = Alert(title: "Error", message: "Failed to pick from gallery")
            return
        }
        await upload(items)
    }

    /// Text, links, images and files that were pasted, dropped or shared.
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

    /// Adds pixel size and duration to a local file, like the picker metadata the iPhone app sent.
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

/// A photo or video from the picker, copied out under its own name.
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
