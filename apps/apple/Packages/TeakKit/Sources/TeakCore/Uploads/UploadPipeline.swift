import Foundation

/// A file to save as a card.
public struct UploadItem: Sendable, Hashable {
    public var fileURL: URL
    public var fileName: String
    public var mimeType: String?
    public var fileSize: Int?
    /// Pixel size and duration, when the picker knows them.
    public var width: Double?
    public var height: Double?
    public var duration: Double?

    public init(fileURL: URL, fileName: String? = nil, mimeType: String? = nil, fileSize: Int? = nil,
                width: Double? = nil, height: Double? = nil, duration: Double? = nil) {
        self.fileURL = fileURL
        self.fileName = fileName ?? fileURL.lastPathComponent
        self.mimeType = mimeType
        self.fileSize = fileSize
        self.width = width
        self.height = height
        self.duration = duration
    }

    var additionalMetadata: ConvexValue? {
        var metadata: ConvexArgs = [:]
        if let width { metadata["width"] = .number(width) }
        if let height { metadata["height"] = .number(height) }
        if let duration { metadata["duration"] = .number(duration) }
        return metadata.isEmpty ? nil : .object(metadata)
    }
}

/// PUTs a file to a signed URL. Abstracted so tests can answer uploads.
public protocol FileUploadTransport: Sendable {
    /// Returns the HTTP status and the `ETag` header.
    func put(_ file: URL, to url: URL, contentType: String) async throws -> (status: Int, etag: String?)
}

public struct URLSessionFileUpload: FileUploadTransport {
    let session: URLSession

    public init(session: URLSession = URLSession(configuration: .ephemeral)) {
        self.session = session
    }

    public func put(_ file: URL, to url: URL, contentType: String) async throws -> (status: Int, etag: String?) {
        var request = URLRequest(url: url, timeoutInterval: 300)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        // Streams from disk, so a 100 MB video never sits in memory.
        let (_, response) = try await session.upload(for: request, fromFile: file)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (http.statusCode, http.value(forHTTPHeaderField: "ETag"))
    }
}

/// `uploadAndCreateCard`, a signed PUT, then `finalizeUploadedCard`, like
/// `uploadFileFromUri` in the web and iPhone apps.
public struct UploadPipeline: Sendable {
    struct Prepared: Decodable, Sendable {
        let success: Bool
        let uploadKey: String?
        let uploadUrl: String?
        let error: String?
        let errorCode: String?
    }

    struct Finalized: Decodable, Sendable {
        let success: Bool
        let cardId: String?
        let error: String?
        let errorCode: String?
    }

    let convex: any ConvexCaller
    let transport: any FileUploadTransport
    let retryDelays: [Duration]

    public init(convex: any ConvexCaller, transport: any FileUploadTransport = URLSessionFileUpload(),
                retryDelays: [Duration] = [.milliseconds(300), .milliseconds(900)]) {
        self.convex = convex
        self.transport = transport
        self.retryDelays = retryDelays
    }

    /// Checks a file before any network work: a supported format, at most 100 MB.
    /// Returns the format and the MIME type to upload with.
    public static func validate(_ item: UploadItem) throws -> (format: FileFormat, mimeType: String, size: Int) {
        guard let format = FileFormats.infer(fileName: item.fileName, mimeType: item.mimeType),
              let mimeType = FileFormats.uploadMimeType(fileName: item.fileName, mimeType: item.mimeType)
        else { throw TeakError(code: TeakError.unsupportedType, message: "Unsupported file type") }
        let size = item.fileSize ?? (try? item.fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 0 else { throw TeakError(message: "Unable to read the file size.") }
        guard size <= TeakLimits.maxFileSize else {
            throw TeakError.card(code: TeakError.fileTooLarge, message: nil)
        }
        return (format, mimeType, size)
    }

    /// Uploads one file and returns the new card's ID.
    public func upload(_ item: UploadItem) async throws -> String {
        let (format, mimeType, size) = try Self.validate(item)
        var prepareArgs: ConvexArgs = [
            "fileName": .string(item.fileName),
            "fileType": .string(mimeType),
            "fileSize": .number(size),
            "cardType": .string(format.cardType),
            "content": .string(item.fileName),
        ]
        if let metadata = item.additionalMetadata { prepareArgs["additionalMetadata"] = metadata }
        let prepared: Prepared = try await convex.mutation("cards:uploadAndCreateCard", prepareArgs)
        guard prepared.success, let key = prepared.uploadKey, let rawURL = prepared.uploadUrl,
              let uploadURL = URL(string: rawURL)
        else { throw TeakError.card(code: prepared.errorCode, message: prepared.error, fallback: "Failed to prepare upload") }

        let etag = try await put(item.fileURL, to: uploadURL, contentType: mimeType)

        var finalizeArgs = prepareArgs
        finalizeArgs["fileKey"] = .string(key)
        if let etag { finalizeArgs["fileEtag"] = .string(etag) }
        let finalized: Finalized = try await convex.action("cards:finalizeUploadedCard", finalizeArgs)
        guard finalized.success, let cardId = finalized.cardId else {
            throw TeakError.card(code: finalized.errorCode, message: finalized.error, fallback: "Failed to create card")
        }
        return cardId
    }

    /// Retries timeouts, rate limits, server errors and dropped connections.
    func put(_ file: URL, to url: URL, contentType: String) async throws -> String? {
        var attempt = 0
        while true {
            do {
                let (status, etag) = try await transport.put(file, to: url, contentType: contentType)
                if (200..<300).contains(status) { return etag }
                guard status == 408 || status == 429 || status >= 500, attempt < retryDelays.count else {
                    throw TeakError(message: "Upload failed with status \(status)")
                }
            } catch let error as URLError where error.code != .cancelled && attempt < retryDelays.count {
                // A dropped connection is retried below, like a 5xx.
            }
            try await Task.sleep(for: retryDelays[attempt])
            attempt += 1
        }
    }
}
