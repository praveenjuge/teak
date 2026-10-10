import Foundation

/// One supported upload format (`FILE_FORMATS` in `packages/convex/shared/fileFormats.ts`).
public struct FileFormat: Decodable, Sendable, Hashable {
    public let id: String
    public let cardType: String
    public let `extension`: String
    public let kind: String
    public let language: String?
    public let mimeType: String
    public let mimeTypes: [String]
    public let preview: String
    let suffixes: [String]
    let fileNames: [String]?

    public var type: CardType { CardType(rawValue: cardType) ?? .document }
}

/// Port of `inferFileFormat` and its helpers, reading the backend's registry.
public enum FileFormats {
    static var formats: [FileFormat] { SharedConstants.shared.fileFormats }

    public static func normalizeMimeType(_ value: String?) -> String {
        (value?.split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? "")
            .trimmingCharacters(in: .whitespaces).lowercased()
    }

    public static func isGenericMimeType(_ value: String?) -> Bool {
        SharedConstants.shared.genericMimeTypes.contains(normalizeMimeType(value))
    }

    /// The trimmed name, or nil when it is empty, too long, a path or has control characters.
    public static func validFileName(_ name: String) -> String? {
        let normalized = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, normalized.count <= SharedConstants.shared.limits.maxFileNameLength,
              normalized != ".", normalized != "..", !normalized.contains("/"), !normalized.contains("\\"),
              !normalized.unicodeScalars.contains(where: { $0.value <= 31 || $0.value == 127 })
        else { return nil }
        return normalized
    }

    private static func matches(_ format: FileFormat, _ lowerName: String) -> Bool {
        if format.fileNames?.contains(lowerName) == true { return true }
        return format.suffixes.contains { lowerName == $0 || lowerName.hasSuffix(".\($0)") }
    }

    private static func byFileName(_ name: String, mimeType: String) -> FileFormat? {
        let lower = name.lowercased()
        let candidates = formats.filter { matches($0, lower) }
        guard let primary = candidates.first else { return nil }
        // `.webm` and `.mp4` exist as audio and video; prefer the one that accepts the MIME type.
        if mimeType.isEmpty || isGenericMimeType(mimeType) || primary.mimeTypes.contains(mimeType) { return primary }
        return candidates.first { $0.mimeTypes.contains(mimeType) } ?? primary
    }

    public static func infer(fileName: String, mimeType: String? = nil) -> FileFormat? {
        guard let name = validFileName(fileName) else { return nil }
        let mime = normalizeMimeType(mimeType)
        if let format = byFileName(name, mimeType: mime) {
            return isGenericMimeType(mime) || format.mimeTypes.contains(mime) ? format : nil
        }
        if isGenericMimeType(mime) { return nil }
        guard let format = formats.first(where: { $0.mimeTypes.contains(mime) }) else { return nil }
        if format.id == "markdown" {
            return FileFormat(id: format.id, cardType: "document", extension: format.extension, kind: format.kind,
                              language: format.language, mimeType: format.mimeType, mimeTypes: format.mimeTypes,
                              preview: format.preview, suffixes: format.suffixes, fileNames: format.fileNames)
        }
        return format
    }

    public static func mimeType(forFileName name: String) -> String {
        infer(fileName: name)?.mimeType ?? "application/octet-stream"
    }

    /// The MIME type to upload with: the given one unless it says nothing, then the format's.
    public static func uploadMimeType(fileName: String, mimeType: String?) -> String? {
        guard let format = infer(fileName: fileName, mimeType: mimeType) else { return nil }
        return isGenericMimeType(mimeType) ? format.mimeType : normalizeMimeType(mimeType)
    }
}
