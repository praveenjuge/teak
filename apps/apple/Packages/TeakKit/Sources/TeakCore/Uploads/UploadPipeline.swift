import Foundation

public struct UploadItem: Sendable, Hashable {
    public var fileURL: URL
    public var fileName: String
    public var mimeType: String?
    public var fileSize: Int?
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

public protocol FileUploadTransport: Sendable {
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
        let (_, response) = try await session.upload(for: request, fromFile: file)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (http.statusCode, http.value(forHTTPHeaderField: "ETag"))
    }
}

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

    public static func validate(_ item: UploadItem) throws -> (format: FileFormat, mimeType: String, size: Int) {
        guard let format = FileFormats.infer(fileName: item.fileName, mimeType: item.mimeType),
              let mimeType = FileFormats.uploadMimeType(fileName: item.fileName, mimeType: item.mimeType)
        else { throw TeakError.card(code: TeakError.unsupportedType, message: nil) }
        let size = item.fileSize ?? (try? item.fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 0 else { throw TeakError(message: tr("native.errors.fileSizeUnreadable")) }
        guard size <= TeakLimits.maxFileSize else {
            throw TeakError.card(code: TeakError.fileTooLarge, message: nil)
        }
        return (format, mimeType, size)
    }

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
        let prepared = try await convex.mutation(ConvexFunctions.uploadAndCreateCard, prepareArgs)
        guard prepared.success, let key = prepared.uploadKey, let rawURL = prepared.uploadUrl,
              let uploadURL = URL(string: rawURL)
        else { throw TeakError.card(code: prepared.errorCode, message: prepared.error, fallback: tr("native.errors.prepareUpload")) }

        let etag = try await put(item.fileURL, to: uploadURL, contentType: mimeType)

        var finalizeArgs = prepareArgs
        finalizeArgs["fileKey"] = .string(key)
        if let etag { finalizeArgs["fileEtag"] = .string(etag) }
        finalizeArgs["source"] = CardSource.apple
        let finalized = try await convex.action(ConvexFunctions.finalizeUploadedCard, finalizeArgs)
        guard finalized.success, let cardId = finalized.cardId else {
            throw TeakError.card(code: finalized.errorCode, message: finalized.error, fallback: tr("native.errors.createCard"))
        }
        return cardId
    }

    func put(_ file: URL, to url: URL, contentType: String) async throws -> String? {
        for delay in retryDelays {
            if case let .uploaded(etag) = try await attemptPut(file, to: url, contentType: contentType) { return etag }
            try await Task.sleep(for: delay)
        }
        switch try await attemptPut(file, to: url, contentType: contentType) {
        case let .uploaded(etag): return etag
        case let .retryable(error): throw error
        }
    }

    private enum PutAttempt {
        case uploaded(etag: String?)
        case retryable(any Error)
    }

    private func attemptPut(_ file: URL, to url: URL, contentType: String) async throws -> PutAttempt {
        do {
            let (status, etag) = try await transport.put(file, to: url, contentType: contentType)
            if (200..<300).contains(status) { return .uploaded(etag: etag) }
            let failure = TeakError(message: tr("native.errors.uploadStatus", String(status)))
            guard Self.isRetryable(status: status) else { throw failure }
            return .retryable(failure)
        } catch let error as URLError where Self.isRetryable(error) {
            return .retryable(error)
        }
    }

    static func isRetryable(status: Int) -> Bool {
        status == 408 || status == 429 || status >= 500
    }

    static func isRetryable(_ error: URLError) -> Bool {
        error.code != .cancelled
    }
}
