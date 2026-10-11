import Foundation
import UniformTypeIdentifiers

/// Turns shared, pasted or dropped item providers into text and files.
/// Files are copied into a private temporary folder, so they outlive the
/// provider and upload straight from disk.
public enum ItemProviders {
    /// Loads up to `limit` items, preferring files, then images, then URLs, then text.
    @MainActor public static func load(_ providers: [NSItemProvider], limit: Int = TeakLimits.maxFilesPerUpload) async -> [SharedItem] {
        var items: [SharedItem] = []
        for provider in providers.prefix(limit * 2) {
            if let item = await load(provider) { items.append(item) }
        }
        return items
    }

    @MainActor public static func load(_ provider: NSItemProvider) async -> SharedItem? {
        let types = provider.registeredTypeIdentifiers.compactMap(UTType.init)
        // A web page shared from Safari carries its URL; save the link, not a file.
        if types.contains(where: { $0.conforms(to: .url) && !$0.conforms(to: .fileURL) }),
           let url = try? await loadURL(provider), !url.isFileURL {
            return .text(url.absoluteString)
        }
        if let fileType = types.first(where: isFileType), let file = try? await copyFile(provider, type: fileType) {
            return .file(file)
        }
        if types.contains(where: { $0.conforms(to: .plainText) }), let text = try? await loadText(provider) {
            return .text(text)
        }
        return nil
    }

    private static func isFileType(_ type: UTType) -> Bool {
        guard !type.conforms(to: .url), !type.conforms(to: .plainText) || type.conforms(to: .sourceCode) else { return false }
        return type.conforms(to: .image) || type.conforms(to: .audiovisualContent) || type.conforms(to: .data)
            || type.conforms(to: .fileURL) || type.conforms(to: .content)
    }

    @MainActor private static func loadURL(_ provider: NSItemProvider) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { url, error in
                if let url { continuation.resume(returning: url) } else {
                    continuation.resume(throwing: error ?? CocoaError(.fileReadUnknown))
                }
            }
        }
    }

    @MainActor private static func loadText(_ provider: NSItemProvider) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            _ = provider.loadObject(ofClass: String.self) { text, error in
                if let text { continuation.resume(returning: text) } else {
                    continuation.resume(throwing: error ?? CocoaError(.fileReadUnknown))
                }
            }
        }
    }

    /// Copies the provider's file under its suggested name.
    @MainActor static func copyFile(_ provider: NSItemProvider, type: UTType) async throws -> UploadItem {
        let folder = try temporaryFolder()
        let suggestedName = provider.suggestedName
        let copied: URL = try await withCheckedThrowingContinuation { continuation in
            _ = provider.loadFileRepresentation(for: type, openInPlace: false) { url, _, error in
                guard let url else { return continuation.resume(throwing: error ?? CocoaError(.fileReadUnknown)) }
                do {
                    let name = fileName(suggested: suggestedName, original: url, type: type)
                    let destination = folder.appending(path: name)
                    try FileManager.default.copyItem(at: url, to: destination)
                    continuation.resume(returning: destination)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
        return item(for: copied, type: type)
    }

    /// An upload item for a local file, with its size and MIME type.
    public static func item(for file: URL, type: UTType? = nil) -> UploadItem {
        let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? nil
        let utType = type ?? UTType(filenameExtension: file.pathExtension)
        return UploadItem(fileURL: file, fileName: file.lastPathComponent, mimeType: utType?.preferredMIMEType,
                          fileSize: size)
    }

    /// Copies a file the person picked (security-scoped) into a private folder.
    public static func copyPicked(_ url: URL) throws -> UploadItem {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let destination = try temporaryFolder().appending(path: url.lastPathComponent)
        try FileManager.default.copyItem(at: url, to: destination)
        return item(for: destination)
    }

    public static func temporaryFolder() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appending(path: "Uploads/\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    static func fileName(suggested: String?, original: URL, type: UTType) -> String {
        let base = suggested?.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "/", with: "_")
        let name = (base?.isEmpty == false ? base! : original.deletingPathExtension().lastPathComponent)
        let ext = original.pathExtension.isEmpty ? (type.preferredFilenameExtension ?? "") : original.pathExtension
        if ext.isEmpty || (name as NSString).pathExtension.lowercased() == ext.lowercased() { return name }
        return "\(name).\(ext)"
    }
}
