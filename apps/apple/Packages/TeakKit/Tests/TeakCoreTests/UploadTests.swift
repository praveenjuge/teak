import Foundation
import Testing
@testable import TeakCore

private let convexURL = URL(string: "https://x.convex.cloud")!

private func file(_ name: String, bytes: Int = 1024) -> URL {
    let url = Fixture.tempDirectory().appending(path: name)
    FileManager.default.createFile(atPath: url.path, contents: Data(count: bytes))
    return url
}

/// A backend that prepares, accepts the PUT and finalizes, recording each step.
private func backend(putStatuses: [Int] = [200], finalize: [String: Any] = ["success": true, "cardId": "card_1"])
    -> ScriptedTransport {
    let puts = Counter()
    nonisolated(unsafe) let finalize = finalize
    return ScriptedTransport { request, body in
        if request.httpMethod == "PUT" {
            let index = puts.next()
            return (putStatuses[min(index, putStatuses.count - 1)], [:])
        }
        switch body["path"] as? String {
        case "cards:uploadAndCreateCard":
            return (200, ["status": "success", "value": ["success": true, "uploadKey": "users/u/file/a.png",
                                                         "uploadUrl": "https://files.example/put?sig=1"]])
        case "cards:finalizeUploadedCard":
            return (200, ["status": "success", "value": finalize])
        default:
            return (404, [:])
        }
    }
}

private func pipeline(_ transport: ScriptedTransport) -> UploadPipeline {
    UploadPipeline(convex: ConvexHTTP(baseURL: convexURL, transport: transport) { "token" },
                   transport: transport, retryDelays: [.zero, .zero])
}

@Suite struct UploadTests {
    @Test func preparesUploadsThenFinalizesWithTheETag() async throws {
        let transport = backend()
        let item = UploadItem(fileURL: file("photo.png"), mimeType: "application/octet-stream", width: 800, height: 600)
        #expect(try await pipeline(transport).upload(item) == "card_1")

        let steps = transport.requests
        #expect(steps.map { $0.1["path"] as? String ?? $0.0.httpMethod! }
            == ["cards:uploadAndCreateCard", "PUT", "cards:finalizeUploadedCard"])
        let prepare = steps[0].1["args"] as! [String: Any]
        #expect(prepare["fileType"] as? String == "image/png")
        #expect(prepare["cardType"] as? String == "image")
        #expect(prepare["fileSize"] as? Double == 1024)
        #expect((prepare["additionalMetadata"] as? [String: Any])?["width"] as? Double == 800)
        #expect(steps[1].0.value(forHTTPHeaderField: "Content-Type") == "image/png")
        let finalize = steps[2].1["args"] as! [String: Any]
        #expect(finalize["fileKey"] as? String == "users/u/file/a.png")
        #expect(finalize["fileEtag"] as? String == "\"etag-1\"")
    }

    @Test func retriesTransientUploadFailures() async throws {
        let transport = backend(putStatuses: [503, 429, 200])
        #expect(try await pipeline(transport).upload(UploadItem(fileURL: file("a.png"))) == "card_1")
        #expect(transport.requests.filter { $0.0.httpMethod == "PUT" }.count == 3)
    }

    @Test func doesNotRetryARejectedUpload() async throws {
        let transport = backend(putStatuses: [403])
        await #expect(throws: TeakError.self) { try await pipeline(transport).upload(UploadItem(fileURL: file("a.png"))) }
        #expect(transport.requests.filter { $0.0.httpMethod == "PUT" }.count == 1)
        #expect(!transport.requests.contains { $0.1["path"] as? String == "cards:finalizeUploadedCard" })
    }

    @Test func rejectsUnsupportedAndOversizedFilesBeforeAnyNetworkWork() async throws {
        let transport = backend()
        await #expect(throws: TeakError(code: TeakError.unsupportedType, message: "Unsupported file type")) {
            try await pipeline(transport).upload(UploadItem(fileURL: file("animation.riv")))
        }
        let big = UploadItem(fileURL: file("a.zip"), fileSize: TeakLimits.maxFileSize + 1)
        await #expect(throws: TeakError.card(code: TeakError.fileTooLarge, message: nil)) {
            try await pipeline(transport).upload(big)
        }
        #expect(transport.count == 0)
    }

    @Test func surfacesTheCardLimit() async throws {
        let transport = backend(finalize: ["success": false, "errorCode": "CARD_LIMIT_REACHED"])
        do {
            _ = try await pipeline(transport).upload(UploadItem(fileURL: file("a.png")))
            Issue.record("Expected the card limit")
        } catch let error as TeakError {
            #expect(error.isCardLimit)
            #expect(error.message == "Card limit reached. Please upgrade to Pro for unlimited cards.")
        }
    }
}

@Suite struct ShareImportTests {
    private func importer(failing: Set<String> = []) -> ShareImporter {
        ShareImporter(
            createText: { text in
                if failing.contains(text) { throw TeakError(message: "Nope") }
                return "card-\(text)"
            },
            upload: { item in
                if failing.contains(item.fileName) { throw TeakError(message: "Upload broke") }
                return "card-\(item.fileName)"
            })
    }

    private let a = URL(fileURLWithPath: "/tmp/a.png")

    @Test func savesEverythingAndDropsRepeats() async {
        let result = await importer().importItems(
            [.text("https://example.com"), .text(" https://example.com "), .file(UploadItem(fileURL: a))],
            isAuthenticated: true)
        #expect(result.createdCardIds == ["card-https://example.com", "card-a.png"])
        #expect(result.isComplete)
        #expect(result.summary == "Saved 2 items")
    }

    @Test func reportsAPartialSave() async {
        let result = await importer(failing: ["b"]).importItems([.text("a"), .text("b")], isAuthenticated: true)
        #expect(result.isPartial)
        #expect(result.summary == "Saved 1 of 2")
        #expect(result.failures == [.init(reason: .createFailed, message: "Nope")])
    }

    @Test func savesAtMostFiveItems() async {
        let items = (1...7).map { SharedItem.text("item \($0)") }
        let result = await importer().importItems(items, isAuthenticated: true)
        #expect(result.successfulItems == 5)
        #expect(result.failures.filter { $0.reason == .tooManyItems }.count == 2)
    }

    @Test func asksToSignInWhenSignedOut() async {
        let result = await importer().importItems([.text("a")], isAuthenticated: false)
        #expect(result.needsSignIn)
        #expect(result.createdCardIds.isEmpty)
    }

    @Test func refusesFilesOverTheLimit() async {
        let big = UploadItem(fileURL: a, fileSize: TeakLimits.maxFileSize + 1)
        let result = await importer().importItems([.file(big)], isAuthenticated: true)
        #expect(result.failures.first?.reason == .fileTooLarge)
    }
}

@Suite struct ConvexHTTPTests {
    private func call(_ status: Int, _ json: Any) async throws -> ConvexVoid {
        nonisolated(unsafe) let json = json
        let transport = ScriptedTransport { _, _ in (status, json) }
        return try await ConvexHTTP(baseURL: convexURL, transport: transport) { nil }.mutation("cards:createCard", [:])
    }

    @Test func keepsTheServersCodeAndMessage() async {
        await #expect(throws: TeakError(code: "RATE_LIMITED", message: "Slow down")) {
            try await call(200, ["status": "error", "errorMessage": "x",
                                 "errorData": ["code": "RATE_LIMITED", "message": "Slow down"]])
        }
    }

    @Test func showsOnlyTheThrownMessage() async {
        let raw = "[Request ID: 1] Server Error\nUncaught Error: User must be authenticated\n    at handler (cards.ts:1)"
        await #expect(throws: TeakError(message: "User must be authenticated")) {
            try await call(400, ["status": "error", "errorMessage": raw])
        }
    }

    @Test func reportsAnOfflineDevice() async {
        let transport = ScriptedTransport { _, _ in throw URLError(.notConnectedToInternet) }
        await #expect(throws: TeakError.offline) {
            let _: ConvexVoid = try await ConvexHTTP(baseURL: convexURL, transport: transport) { nil }.query("x:y", [:])
        }
    }

    @Test func sendsNumbersAsDoubles() async throws {
        let transport = ScriptedTransport { _, _ in (200, ["status": "success", "value": NSNull()]) }
        let _: ConvexVoid = try await ConvexHTTP(baseURL: convexURL, transport: transport) { nil }
            .query("cards:searchMobileCardSummariesPaginated", ["paginationOpts": ["numItems": .number(20), "cursor": nil]])
        let body = String(data: transport.requests[0].0.httpBody!, encoding: .utf8)!
        #expect(body.contains("\"numItems\":20"))
        #expect(!body.contains("$integer"))
    }

    @Test func trustsOnlyConvexOrigins() {
        #expect(TeakConfig.trustedConvexOrigin("https://uncommon-ladybug-882.convex.cloud") != nil)
        #expect(TeakConfig.trustedConvexOrigin("https://evil.example.com") == nil)
        #expect(TeakConfig.trustedConvexOrigin("http://x.convex.cloud") == nil)
        #expect(TeakConfig.trustedConvexOrigin("https://x.convex.cloud/path") == nil)
    }
}
