import Foundation

public enum SharedItem: Sendable, Hashable {
    case text(String)
    case file(UploadItem)
}

public struct ShareImportResult: Sendable, Equatable {
    public enum Reason: String, Sendable { case unauthenticated, tooManyItems, fileTooLarge, uploadFailed, createFailed }

    public struct Failure: Sendable, Equatable {
        public let reason: Reason
        public let message: String

        static let signInRequired = Failure(reason: .unauthenticated, message: "Sign in to save shared content.")

        static func from(_ error: any Error, reason: Reason) -> Failure {
            if (error as? TeakError)?.isSignedOut == true { return signInRequired }
            return Failure(reason: reason, message: error.teakMessage)
        }
    }

    public var totalItems = 0
    public var attemptedItems = 0
    public var createdCardIds: [String] = []
    public var failures: [Failure] = []

    public var successfulItems: Int { createdCardIds.count }
    public var isComplete: Bool { failures.isEmpty && successfulItems > 0 }
    public var isPartial: Bool { successfulItems > 0 && !failures.isEmpty }
    public var needsSignIn: Bool { failures.contains { $0.reason == .unauthenticated } }

    public var summary: String {
        if isComplete { return successfulItems == 1 ? "Saved to Teak" : "Saved \(successfulItems) items" }
        if isPartial { return "Saved \(successfulItems) of \(totalItems)" }
        return failures.first?.message ?? "Nothing to save."
    }
}

public struct ShareImporter: Sendable {
    public typealias CreateText = @Sendable (String) async throws -> String
    public typealias Upload = @Sendable (UploadItem) async throws -> String

    let createText: CreateText
    let upload: Upload

    public init(createText: @escaping CreateText, upload: @escaping Upload) {
        self.createText = createText
        self.upload = upload
    }

    public static func removingEmptyAndDuplicates(_ items: [SharedItem]) -> [SharedItem] {
        var seen = Set<String>()
        return items.compactMap { item in
            switch item {
            case let .text(raw):
                let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty, seen.insert("text:\(text)").inserted else { return nil }
                return .text(text)
            case let .file(file):
                guard seen.insert("file:\(file.fileURL.absoluteString)").inserted else { return nil }
                return item
            }
        }
    }

    public func importItems(_ items: [SharedItem], isAuthenticated: Bool,
                            maxItems: Int = TeakLimits.maxFilesPerUpload) async -> ShareImportResult {
        let items = Self.removingEmptyAndDuplicates(items)
        let processable = items.prefix(maxItems)
        var result = ShareImportResult(totalItems: items.count, attemptedItems: processable.count)
        result.failures = items.dropFirst(maxItems).map { _ in
            .init(reason: .tooManyItems, message: "Only the first \(maxItems) shared items are saved.")
        }
        guard isAuthenticated else {
            result.failures += processable.map { _ in .signInRequired }
            return result
        }
        for item in processable {
            switch item {
            case let .text(text):
                do {
                    result.createdCardIds.append(try await createText(text))
                } catch {
                    result.failures.append(.from(error, reason: .createFailed))
                }
            case let .file(file):
                if let size = file.fileSize, size > TeakLimits.maxFileSize {
                    result.failures.append(.init(reason: .fileTooLarge,
                                                 message: TeakError.card(code: TeakError.fileTooLarge, message: nil).message))
                    continue
                }
                do {
                    result.createdCardIds.append(try await upload(file))
                } catch {
                    result.failures.append(.from(error, reason: .uploadFailed))
                }
            }
        }
        return result
    }
}
