import CoreTransferable
import Foundation
import TeakCore
import UniformTypeIdentifiers

enum CardFiles {
    static var sharedFolder: URL { FileManager.default.temporaryDirectory.appending(path: "Shared") }

    static func download(_ url: URL, as fileName: String) async throws -> URL {
        let (temporary, response) = try await URLSession.shared.download(from: url)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw TeakError(message: tr("native.card.failed.download"))
        }
        let folder = sharedFolder.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appending(path: name(fileName, url: url, mimeType: response.mimeType))
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }

    static func contentType(_ type: CardType) -> UTType {
        switch type {
        case .image: .image
        case .video: .movie
        case .audio: .audio
        default: .data
        }
    }

    static func safeName(_ fileName: String) -> String {
        let name = fileName.trimmingCharacters(in: .whitespacesAndNewlines).replacing(/[\/\\]+/, with: "_")
        return name.isEmpty || name == "." || name == ".." ? "download" : name
    }

    private static func name(_ fileName: String, url: URL, mimeType: String?) -> String {
        let name = safeName(fileName)
        guard !isKnownExtension((name as NSString).pathExtension) else { return name }
        let fromURL = isKnownExtension(url.pathExtension) ? url.pathExtension : nil
        let fromMime = mimeType.flatMap { UTType(mimeType: $0)?.preferredFilenameExtension }
        return (fromURL ?? fromMime).map { "\(name).\($0)" } ?? name
    }

    private static func isKnownExtension(_ value: String) -> Bool {
        !value.isEmpty && UTType(filenameExtension: value).map { !$0.isDynamic } == true
    }
}

struct CardFile: Transferable, Sendable {
    let fileName: String
    let contentType: UTType
    let resolve: @Sendable () async throws -> URL

    init(fileName: String, kind: UTType = .data, resolve: @escaping @Sendable () async throws -> URL) {
        self.fileName = CardFiles.safeName(fileName)
        let named = UTType.forFileName(self.fileName)
        contentType = named.conforms(to: kind) ? named : kind
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
