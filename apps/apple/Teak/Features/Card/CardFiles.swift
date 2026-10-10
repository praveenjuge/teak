import CoreTransferable
import Foundation
import TeakCore
import UniformTypeIdentifiers

/// Downloads a card's file under its own name, for sharing and saving.
enum CardFiles {
    static func download(_ url: URL, as fileName: String) async throws -> URL {
        let (temporary, response) = try await URLSession.shared.download(from: url)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw TeakError(message: "Unable to download this file.")
        }
        let folder = FileManager.default.temporaryDirectory.appending(path: "Shared/\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appending(path: fileName)
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }
}

/// A card's file, downloaded only when someone picks where to send it.
struct CardFile: Transferable, Sendable {
    let fileName: String
    let contentType: UTType
    /// Finds the file's URL; for a grid tile this loads the full card first.
    let resolve: @Sendable () async throws -> URL

    init(fileName: String, resolve: @escaping @Sendable () async throws -> URL) {
        self.fileName = fileName
        contentType = UTType.forFileName(fileName)
        self.resolve = resolve
    }

    private func export() async throws -> SentTransferredFile {
        SentTransferredFile(try await CardFiles.download(try await resolve(), as: fileName))
    }

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .image) { try await $0.export() }
            .exportingCondition { $0.contentType.conforms(to: .image) }
        FileRepresentation(exportedContentType: .movie) { try await $0.export() }
            .exportingCondition { $0.contentType.conforms(to: .movie) }
        FileRepresentation(exportedContentType: .audio) { try await $0.export() }
            .exportingCondition { $0.contentType.conforms(to: .audio) }
        FileRepresentation(exportedContentType: .pdf) { try await $0.export() }
            .exportingCondition { $0.contentType.conforms(to: .pdf) }
        FileRepresentation(exportedContentType: .data) { try await $0.export() }
            .suggestedFileName { $0.fileName }
    }
}
