import Foundation
final class MemoryCredentials: SafariCredentialStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: SafariOAuthTokens?
    init(_ tokens: SafariOAuthTokens? = nil) { self.tokens = tokens }
    func load() throws -> SafariOAuthTokens? { lock.withLock { tokens } }
    func save(_ tokens: SafariOAuthTokens) throws { lock.withLock { self.tokens = tokens } }
    func clear() throws { lock.withLock { tokens = nil } }
}
final class MockHTTP: URLProtocol, @unchecked Sendable {
    static var hold: ((MockHTTP) -> Bool)?
    static var responseHeaders = ["Content-Type": "application/json"]
    static var respond: (URLRequest) throws -> (Int, String) = { _ in (500, "{}") }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if Self.hold?(self) == true { return }
        do {
            let (status, body) = try SafariDiscoveryFixtures.metadata(request) ?? Self.respond(request)
            complete(status: status, body: body)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    func complete(status: Int, body: String) {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
            httpVersion: nil, headerFields: Self.responseHeaders)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
@main struct SafariOAuthTests {
    static func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        if try !condition() { throw SafariServiceError.message("TEST FAILED: \(message)") }
    }
    static func rejects(_ message: String, _ action: () throws -> Void) throws {
        do { try action() } catch { return }
        throw SafariServiceError.message("TEST FAILED: \(message)")
    }
    static func rejectsAsync(_ message: String, _ action: () async throws -> Void) async throws {
        do { try await action() } catch { return }
        throw SafariServiceError.message("TEST FAILED: \(message)")
    }
    static func requestJSON(_ request: URLRequest) throws -> [String: Any] {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                data.append(buffer, count: count)
            }
        }
        guard let body = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw SafariServiceError.message("TEST FAILED: missing request body")
        }
        return body
    }
    static let validSession = #"{"data":{"id":"user","email":"hello@example.com"}}"#
    static let tokenResponse = #"{"access_token":"new-access","refresh_token":"new-refresh","expires_in":3600,"token_type":"Bearer"}"#
    static func fixture(_ store: MemoryCredentials, lock: URL? = nil) -> TeakSafariService {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockHTTP.self]
        return TeakSafariService(session: URLSession(configuration: configuration), credentials: store,
            apiURL: URL(string: "https://test.teak.invalid")!, trustedOrigins: ["https://test.teak.invalid", "https://auth.teak.invalid"],
            lockURL: lock ?? FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
    }
    /// A credential saved by a WorkOS sign-in against the test deployment.
    static func tokens(expired: Bool = false, access: String = "access", refresh: String = "refresh") -> SafariOAuthTokens {
        var tokens = SafariOAuthTokens(accessToken: access, refreshToken: refresh, expiresAt: Date().addingTimeInterval(expired ? -1 : 3600))
        tokens.binding = SafariOAuthBinding(apiOrigin: SafariDiscoveryFixtures.api.absoluteString, primary: "workos",
            issuer: URL(string: SafariDiscoveryFixtures.issuer)!, clientID: SafariDiscoveryFixtures.clientID, ownerID: "user")
        return tokens
    }
    static func libraryWrites(cardJSON: String) async throws {
        let store = MemoryCredentials(tokens())
        let service = fixture(store)
        let library = LibraryAPI(service: service)
        let invalidIDs = ["", "../card", "card/name", "card?query", "card#fragment", "card%2Fname", "café", String(repeating: "a", count: 129)]
        var unexpectedRequests = 0
        MockHTTP.respond = { _ in unexpectedRequests += 1; return (500, "{}") }
        for id in invalidIDs {
            try await rejectsAsync("invalid ID must reject detail") { _ = try await library.card(id: id) }
            try await rejectsAsync("invalid ID must reject editing") { _ = try await library.update(id: id, metadataTitle: "Title", content: nil, notes: "", tags: []) }
            try await rejectsAsync("invalid ID must reject deletion") { try await library.delete(id: id) }
            try await rejectsAsync("invalid ID must reject favorite") { _ = try await library.setFavorite(id: id, isFavorited: true) }
        }
        for (method, path) in [("GET", "https://evil.invalid/v1/cards"), ("GET", "v1/cards/../uploads"),
                               ("GET", "/v1/cards"), ("POST", "v1/cards/card-1"), ("GET", "v1/uploads"),
                               ("DELETE", "v1/cards"), ("PATCH", "v1/cards/card-1/favorite/extra"),
                               ("GET", "v1/cards/card%2Fname")] {
            try await rejectsAsync("unsafe route must reject before sending OAuth") {
                _ = try await service.libraryRequest(method: method, path: path)
            }
        }
        try check(unexpectedRequests == 0, "invalid paths never reach the network")
        for type in ["text", "quote"] {
            MockHTTP.respond = { request in
                try check(request.httpMethod == "POST" && request.url?.path == "/v1/cards", "capture creates a card")
                try check(request.value(forHTTPHeaderField: "Authorization") == "Bearer access", "capture authenticates")
                try check(request.value(forHTTPHeaderField: "Idempotency-Key") != nil, "capture is idempotent")
                let body = try requestJSON(request)
                try check((type == "text" ? body["cardType"] == nil : body["cardType"] as? String == type) && body["content"] as? String == "A thought", "capture preserves the selected type and text")
                return (200, #"{"cardId":"created-card"}"#)
            }
            let id = try await (type == "text" ? library.createText("A thought") : library.createQuote("A thought"))
            try check(id == "created-card", "capture returns the created card ID")
        }
        for type in ["text", "quote"] {
            var attempts: [[String: Any]] = []
            MockHTTP.respond = { request in
                try check(request.value(forHTTPHeaderField: "Idempotency-Key") == "\(type)-attempt", "capture retries preserve their identity")
                attempts.append(try requestJSON(request))
                return attempts.count == 1 ? (503, "{}") : (200, #"{"cardId":"retry-text"}"#)
            }
            try await rejectsAsync("failed text capture offers retry") {
                _ = try await (type == "text" ? library.createText("A thought", idempotencyKey: "text-attempt") : library.createQuote("A thought", idempotencyKey: "quote-attempt"))
            }
            let id = try await (type == "text" ? library.createText("A thought", idempotencyKey: "text-attempt") : library.createQuote("A thought", idempotencyKey: "quote-attempt"))
            try check(id == "retry-text" && attempts.count == 2 && NSDictionary(dictionary: attempts[0]).isEqual(to: attempts[1]), "text capture retries preserve payload and saved result")
        }
        MockHTTP.respond = { _ in (200, #"{"cardId":"../unsafe"}"#) }
        try await rejectsAsync("unsafe server card ID must reject") { _ = try await library.createText("Text") }
        for content in [Optional("Edited note"), nil] {
            MockHTTP.respond = { request in
                try check(request.httpMethod == "PATCH" && request.url?.path == "/v1/cards/card-1", "editing updates the selected card")
                let body = try requestJSON(request)
                try check(body["notes"] as? String == "" && body["tags"] as? [String] == [], "editing supports clearing notes and tags")
                try check(body["metadataTitle"] as? String == "", "editing supports clearing titles")
                try check(body["content"] as? String == content, "nontext cards omit content while notes retain edited text")
                return (200, cardJSON)
            }
            let updated = try await library.update(id: "card-1", metadataTitle: "", content: content, notes: "", tags: [])
            try check(updated.id == "card-1" && updated.metadataTitle == "Autumn", "editing returns server metadata")
        }
        for favorited in [true, false] {
            MockHTTP.respond = { request in
                try check(request.httpMethod == "PATCH" && request.url?.path == "/v1/cards/card-1/favorite", "favorite updates the selected card")
                try check(try requestJSON(request)["isFavorited"] as? Bool == favorited, "favorite sends desired state")
                return (200, cardJSON.replacingOccurrences(of: "\"isFavorited\":true", with: "\"isFavorited\":\(favorited)"))
            }
            let updated = try await library.setFavorite(id: "card-1", isFavorited: favorited)
            try check(updated.isFavorited == favorited, "favorite returns the saved state")
        }
        MockHTTP.respond = { request in
            try check(request.httpMethod == "DELETE" && request.url?.path == "/v1/cards/card-1", "deletion targets the selected card")
            return (204, "")
        }
        try await library.delete(id: "card-1")
        MockHTTP.respond = { _ in (503, #"{"error":"Try again later"}"#) }
        try await rejectsAsync("server failure must reject mutation") { try await library.delete(id: "card-1") }
        try check(try store.load() != nil, "server failures preserve credentials")
        MockHTTP.respond = { _ in (401, "") }
        do {
            try await library.delete(id: "card-1")
            throw SafariServiceError.message("TEST FAILED: revoked write accepted")
        } catch SafariServiceError.unauthenticated {
            try check(try store.load() == nil, "revoked write clears credentials")
        }
        print("PASS: library capture, editing, favorites, 204 deletion, unsafe routes, failed writes")
    }
    @MainActor static func libraryStoreWrites(cardJSON: String) async throws {
        let original = try JSONDecoder().decode(LibraryCard.self, from: Data(cardJSON.utf8))
        let page = "{\"items\":[\(cardJSON)],\"pageInfo\":{\"hasMore\":false,\"nextCursor\":null}}"
        let store = LibraryStore(api: LibraryAPI(service: fixture(MemoryCredentials(tokens()))), onAuthenticationRequired: {})
        MockHTTP.respond = { _ in (200, page) }
        await store.loadFirstPage()
        for operation in ["favorite", "edit", "delete"] {
            var held: MockHTTP?
            var mutation: Task<Void, Error>?
            await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
                MockHTTP.hold = { request in
                    held = request
                    started.resume()
                    return true
                }
                mutation = Task { @MainActor in
                    switch operation {
                    case "favorite": _ = try await store.setFavorite(original)
                    case "edit": _ = try await store.update(original, title: "Edited", content: "Changed", notes: "New", tags: ["new"])
                    default: try await store.delete(original)
                    }
                }
            }
            try check(store.mutatingIDs.contains(original.id), "pending mutations expose saving state")
            switch operation {
            case "favorite": try check(store.cards.first?.isFavorited == false, "favorite changes immediately")
            case "edit": try check(store.cards.first?.metadataTitle == "Edited" && store.cards.first?.tags == ["new"], "edits appear immediately")
            default: try check(store.cards.isEmpty, "deleted cards disappear immediately")
            }
            try await rejectsAsync("a second write cannot race the pending mutation") { try await store.delete(original) }
            MockHTTP.hold = nil
            held!.complete(status: 503, body: #"{"error":"Please retry"}"#)
            try await rejectsAsync("failed mutation rejects") { try await mutation!.value }
            try check(store.cards.count == 1 && store.cards[0].metadataTitle == "Autumn"
                && store.cards[0].isFavorited && store.cards[0].tags == ["design"], "failed mutations restore the original card")
            try check(store.mutatingIDs.isEmpty && store.error != nil, "failed mutation clears saving state and shows an error")
        }
        var staleRead: MockHTTP?
        var readTask: Task<Void, Never>?
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            MockHTTP.hold = { request in
                guard request.request.httpMethod == "GET" else { return false }
                staleRead = request
                started.resume()
                return true
            }
            readTask = Task { await store.loadFirstPage() }
        }
        let confirmedJSON = cardJSON.replacingOccurrences(of: "Autumn", with: "Confirmed")
        MockHTTP.respond = { _ in (200, confirmedJSON) }
        _ = try await store.update(original, title: "Confirmed", content: nil, notes: "Reference", tags: ["design"])
        MockHTTP.hold = nil
        var refreshedLists = 0
        MockHTTP.respond = { request in
            refreshedLists += 1
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
            try check(!query.contains { $0.name == "cursor" }, "stale reads rerun from the first page")
            return (200, "{\"items\":[\(confirmedJSON)],\"pageInfo\":{\"hasMore\":false,\"nextCursor\":null}}")
        }
        staleRead!.complete(status: 200, body: page)
        await readTask!.value
        try check(refreshedLists == 1 && !store.hasMore, "stale query pagination is replaced by the refreshed result")
        try check(store.cards.first?.metadataTitle == "Confirmed", "a stale list cannot overwrite confirmed edits")
        var detailRequests = 0
        MockHTTP.respond = { request in
            try check(request.url?.path == "/v1/cards/card-1", "creation fetches only its confirmed card")
            detailRequests += 1
            return (200, confirmedJSON)
        }
        await store.insertCreated(id: original.id)
        try check(detailRequests == 1 && store.cards.count == 1 && store.cards[0].metadataTitle == "Confirmed", "creation inserts once without a full list reload")
        try check(!store.hasFilters, "creation reveals the new card by clearing filters")
        store.toggleFavorites()
        MockHTTP.respond = { _ in (200, page) }
        await store.loadFirstPage()
        MockHTTP.respond = { _ in (200, cardJSON.replacingOccurrences(of: "\"isFavorited\":true", with: "\"isFavorited\":false")) }
        _ = try await store.setFavorite(original)
        try check(store.cards.isEmpty, "unfavoriting removes a card from favorites")
        MockHTTP.respond = { request in
            request.url?.path == "/v1/cards" ? (200, page) : (200, confirmedJSON)
        }
        await store.insertCreated(id: original.id) // Cancels the pending filter search.
        MockHTTP.respond = { _ in (204, "") }
        try await store.delete(store.cards[0])
        try check(store.cards.isEmpty && store.mutatingIDs.isEmpty, "confirmed deletion remains removed")
        MockHTTP.respond = { request in
            let body = try requestJSON(request)
            try check(body["metadataTitle"] == nil && body["content"] == nil, "notes-only edits do not freeze the generated title or content")
            return (200, cardJSON)
        }
        _ = try await store.update(original, title: "Autumn", content: nil, notes: "Notes only", tags: ["design"])
        store.searchText = "Filtered"
        MockHTTP.respond = { _ in (200, "{\"items\":[\(cardJSON)],\"pageInfo\":{\"hasMore\":true,\"nextCursor\":\"filtered-cursor\"}}") }
        await store.loadFirstPage()
        var insertionRequests: [String] = []
        MockHTTP.respond = { request in
            insertionRequests.append(request.url!.path)
            if request.url!.path != "/v1/cards" { return (200, confirmedJSON) }
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
            try check(!query.contains { ["q", "cursor", "type", "favorited"].contains($0.name) }, "filtered creation resets query and cursor together")
            return (200, page)
        }
        await store.insertCreated(id: original.id)
        await store.loadMore()
        try check(insertionRequests == ["/v1/cards", "/v1/cards/card-1"] && !store.hasMore && !store.hasFilters, "filtered creation replaces pagination then inserts only once")
        var failedDelete: MockHTTP?
        var deleteTask: Task<Void, Error>?
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            MockHTTP.hold = { request in
                guard request.request.httpMethod == "DELETE" else { return false }
                failedDelete = request
                started.resume()
                return true
            }
            deleteTask = Task { try await store.delete(original) }
        }
        store.searchText = "Unrelated"
        var rollbackSearches = 0
        MockHTTP.respond = { request in
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
            try check(query.contains { $0.name == "q" && $0.value == "Unrelated" }, "rollback refresh keeps the current search")
            rollbackSearches += 1
            return (200, #"{"items":[],"pageInfo":{"hasMore":false,"nextCursor":null}}"#)
        }
        await store.loadFirstPage()
        rollbackSearches = 0
        MockHTTP.hold = nil
        failedDelete!.complete(status: 503, body: #"{"error":"Please retry"}"#)
        try await rejectsAsync("failed delete rejects after search changes") { try await deleteTask!.value }
        try check(rollbackSearches == 1 && store.cards.isEmpty && store.mutatingIDs.isEmpty,
                  "rollback refetches the changed search without inserting an unrelated card")
        try await searchTokensAndTrash(cardJSON: cardJSON)
        try await tagFiltersAndBulkActions(cardJSON: cardJSON)
        try await creationSearchRace(cardJSON: cardJSON)
        try await creationRefreshRace(cardJSON: cardJSON)
        try await unloadedCardMutation(cardJSON: cardJSON)
        try await creationInitialLoadRace(cardJSON: cardJSON)
        try await paginationMutationRace(cardJSON: cardJSON)
        try await failedUnloadedDeleteDuringPagination(cardJSON: cardJSON)
        print("PASS: optimistic mutation rollback, filtered favorites, creation insertion, stale-read safety")
    }

    static func libraryUploads() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("note.txt")
        try Data("Upload content".utf8).write(to: file)
        let library = LibraryAPI(service: fixture(MemoryCredentials(tokens())))
        var stages: [String] = []
        MockHTTP.responseHeaders["ETag"] = "\"uploaded-etag\""
        MockHTTP.respond = { request in
            let path = request.url!.path
            stages.append(path)
            if path == "/v1/uploads" {
                let body = try requestJSON(request)
                try check(body["fileName"] as? String == "note.txt" && body["fileSize"] as? Int == 14, "presign carries file metadata")
                return (200, #"{"uploadUrl":"https://uploads.invalid/signed-file?signature=secret","fileKey":"files/key"}"#)
            }
            if path == "/signed-file" {
                try check(request.httpMethod == "PUT", "signed file uses PUT")
                try check(request.value(forHTTPHeaderField: "Authorization") == nil, "upload never exposes OAuth bearer")
                try check(request.value(forHTTPHeaderField: "Content-Type") == "text/plain", "upload sends selected MIME type")
                return (200, "")
            }
            try check(path == "/v1/cards", "successful upload finalizes a card")
            try check(request.value(forHTTPHeaderField: "Authorization") == "Bearer access", "finalization authenticates")
            try check(request.value(forHTTPHeaderField: "Idempotency-Key") == "capture-attempt", "finalization preserves retry identity")
            let body = try requestJSON(request)
            try check(body["fileKey"] as? String == "files/key" && body["fileEtag"] as? String == "\"uploaded-etag\"", "finalization carries storage proof")
            return (200, #"{"cardId":"file-card"}"#)
        }
        let id = try await library.createFile(file, mimeType: "text/plain", idempotencyKey: "capture-attempt")
        try check(id == "file-card" && stages == ["/v1/uploads", "/signed-file", "/v1/cards"], "upload completes in order")
        stages = []
        var finalizePayloads: [[String: Any]] = []
        MockHTTP.respond = { request in
            stages.append(request.url!.path)
            if request.url!.path == "/v1/uploads" {
                return (200, #"{"uploadUrl":"https://uploads.invalid/signed-file","fileKey":"retry/key"}"#)
            }
            if request.url!.path == "/signed-file" { return (200, "") }
            try check(request.value(forHTTPHeaderField: "Idempotency-Key") == "retry-attempt", "finalize retries reuse idempotency identity")
            finalizePayloads.append(try requestJSON(request))
            return finalizePayloads.count == 1 ? (503, "{}") : (200, #"{"cardId":"retry-card"}"#)
        }
        try await rejectsAsync("failed finalization offers retry") { _ = try await library.createFile(file, mimeType: "text/plain", idempotencyKey: "retry-attempt") }
        let retried = try await library.createFile(file, mimeType: "text/plain", idempotencyKey: "retry-attempt")
        try check(retried == "retry-card" && stages == ["/v1/uploads", "/signed-file", "/v1/cards", "/v1/cards"], "finalization retries never repeat the upload")
        try check(NSDictionary(dictionary: finalizePayloads[0]).isEqual(to: finalizePayloads[1]), "finalization retries preserve the complete storage payload")
        MockHTTP.responseHeaders.removeValue(forKey: "ETag")
        stages = []
        MockHTTP.respond = { request in
            stages.append(request.url!.path)
            if request.url!.path == "/v1/uploads" {
                return (200, #"{"uploadUrl":"https://uploads.invalid/signed-file","fileKey":"files/key"}"#)
            }
            return (403, #"{"error":"Signature expired"}"#)
        }
        try await rejectsAsync("failed PUT must reject capture") { _ = try await library.createFile(file, mimeType: "text/plain", idempotencyKey: "failed-attempt") }
        try check(stages == ["/v1/uploads", "/signed-file"], "failed PUT never creates a card")
        for url in ["http://uploads.invalid/file", "https://user:password@uploads.invalid/file", "file:///tmp/upload"] {
            stages = []
            MockHTTP.respond = { request in
                stages.append(request.url!.path)
                return (200, "{\"uploadUrl\":\"\(url)\",\"fileKey\":\"files/key\"}")
            }
            try await rejectsAsync("unsafe presign must reject capture") { _ = try await library.createFile(file, mimeType: "text/plain", idempotencyKey: "unsafe-attempt") }
            try check(stages == ["/v1/uploads"], "unsafe upload URLs never receive file data or finalize")
        }
        stages = []
        MockHTTP.respond = { request in
            stages.append(request.url!.path)
            return (503, #"{"error":"Storage unavailable"}"#)
        }
        try await rejectsAsync("failed presign must reject capture") { _ = try await library.createFile(file, mimeType: "text/plain", idempotencyKey: "no-upload") }
        try check(stages == ["/v1/uploads"], "presign failure never uploads or creates a card")
        stages = []
        try await rejectsAsync("directory cannot upload") { _ = try await library.createFile(directory, mimeType: "text/plain", idempotencyKey: "directory") }
        let emptyFile = directory.appendingPathComponent("empty.txt")
        try Data().write(to: emptyFile)
        try await rejectsAsync("empty file cannot upload") { _ = try await library.createFile(emptyFile, mimeType: "text/plain", idempotencyKey: "empty") }
        try check(stages.isEmpty, "invalid files reject before presign")
        print("PASS: file upload sequencing, storage proof, bearer isolation, failed upload safety")
    }
    static func main() async throws {
        try await discoveryJourneys()
        try check(
            CompanionRoute.resolve(from: ["authenticated": true]) == .library,
            "authenticated accounts route to Library"
        )
        try check(
            CompanionRoute.resolve(from: ["authenticated": false]) == .onboarding,
            "signed-out accounts route to onboarding"
        )
        try check(
            CompanionRoute.resolve(from: [
                "status": "error",
                "authenticated": true,
                "message": "Unable to verify your Teak connection.",
            ]) == .library,
            "offline accounts with stored credentials remain in Library"
        )
        try check(
            CompanionRoute.resolve(from: ["status": "error", "authenticated": false]) == .onboarding,
            "errors without stored credentials route to onboarding"
        )
        try check(
            CompanionRoute.shouldStartSignIn(
                from: ["authenticated": false], connectRequested: true
            ),
            "a signed-out Safari deep link opens onboarding and starts sign in"
        )
        try check(
            !CompanionRoute.shouldStartSignIn(
                from: ["authenticated": true], connectRequested: true
            ),
            "an authenticated Safari deep link opens Library without signing in again"
        )
        try check(
            !CompanionRoute.shouldStartSignIn(
                from: ["authenticated": false], connectRequested: false
            ),
            "ordinary signed-out launch waits for the onboarding button"
        )
        try check(
            CompanionRoute.shouldShowOnboardingAfterSignOut([
                "status": "signed-out", "authenticated": false,
            ]),
            "successful sign-out routes to onboarding"
        )
        try check(
            !CompanionRoute.shouldShowOnboardingAfterSignOut([
                "status": "error", "authenticated": true,
            ]),
            "failed sign-out stays in Settings"
        )
        try check(
            !CompanionRoute.shouldRouteAuthenticationFailure(
                ["status": "error", "authenticated": false],
                duringExplicitSignOut: true
            ),
            "credential-clear errors from explicit sign-out stay in Settings"
        )

        var coldLaunchRouting = CompanionRoutingState()
        coldLaunchRouting.requestConnect()
        let coldLaunchGeneration = coldLaunchRouting.beginResolution()
        try check(
            coldLaunchRouting.completeResolution(
                generation: coldLaunchGeneration,
                state: ["authenticated": false],
                isAuthenticating: false
            ) == .present(.onboarding, startSignIn: true),
            "a pre-launch connect intent survives until initial routing completes"
        )

        var racingRouting = CompanionRoutingState()
        let staleGeneration = racingRouting.beginResolution()
        racingRouting.requestConnect()
        let currentGeneration = racingRouting.beginResolution()
        try check(
            racingRouting.completeResolution(
                generation: staleGeneration,
                state: ["authenticated": true],
                isAuthenticating: false
            ) == nil,
            "a stale auth read cannot replace an authoritative route"
        )
        try check(
            racingRouting.completeResolution(
                generation: currentGeneration,
                state: ["authenticated": false],
                isAuthenticating: false
            ) == .present(.onboarding, startSignIn: true),
            "the newest auth read consumes the pending connect intent"
        )

        var activeAuthenticationRouting = CompanionRoutingState()
        activeAuthenticationRouting.requestConnect()
        let activeGeneration = activeAuthenticationRouting.beginResolution()
        try check(
            activeAuthenticationRouting.completeResolution(
                generation: activeGeneration,
                state: ["authenticated": false],
                isAuthenticating: true
            ) == .preserveCurrentPresentation,
            "duplicate routes preserve an active OAuth presentation"
        )
        let laterGeneration = activeAuthenticationRouting.beginResolution()
        try check(
            activeAuthenticationRouting.completeResolution(
                generation: laterGeneration,
                state: ["authenticated": false],
                isAuthenticating: false
            ) == .present(.onboarding, startSignIn: false),
            "a duplicate connect request cannot restart OAuth after completion"
        )

        var authoritativeRouting = CompanionRoutingState()
        let pendingGeneration = authoritativeRouting.beginResolution()
        authoritativeRouting.invalidatePendingResolution()
        try check(
            authoritativeRouting.completeResolution(
                generation: pendingGeneration,
                state: ["authenticated": true],
                isAuthenticating: false
            ) == nil,
            "logout and credential-revocation transitions invalidate older auth reads"
        )
        print("PASS: companion window routing")

        var pending = try SafariOAuthRequest(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", state: "expected")
        pending.discovery = try await fixture(MemoryCredentials()).prepareSignIn().discovery
        let authorization = URLComponents(url: try pending.authorizationURL(), resolvingAgainstBaseURL: false)!
        try check(authorization.queryItems?.first { $0.name == "code_challenge" }?.value == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "PKCE uses RFC 7636 S256 vector")
        try check(try pending.authorizationCode(from: URL(string: "teak-safari://oauth/callback?code=valid&state=expected")!) == "valid", "matching callback succeeds")
        for invalid in [
            "teak-safari://oauth/callback?code=valid&state=wrong",
            "teak-safari://oauth/callback?code=valid&state=expected&state=expected",
            "teak-safari://oauth/callback?code=a&code=b&state=expected",
            "teak-safari://wrong/callback?code=valid&state=expected",
            "teak-safari://user@oauth/callback?code=valid&state=expected",
            "teak-safari://oauth/callback?error=access_denied&state=expected",
        ] { try rejects("invalid callback is rejected") { _ = try pending.authorizationCode(from: URL(string: invalid)!) } }
        try rejects("expired login is rejected") {
            _ = try pending.authorizationCode(from: URL(string: "teak-safari://oauth/callback?code=valid&state=expected")!, now: Date().addingTimeInterval(601))
        }
        try check(String(data: SafariOAuthRequest.formBody(["code": "a+b&c=d"]), encoding: .utf8) == "code=a%2Bb%26c%3Dd", "form encoding preserves special characters")
        try rejects("invalid token response rejected") { _ = try SafariOAuthTokens.decode(Data(#"{"access_token":"","refresh_token":"r","expires_in":3600,"token_type":"Bearer"}"#.utf8)) }
        print("PASS: PKCE, callback validation, expiry, consent denial, and form encoding")

        let freshStore = MemoryCredentials()
        let fresh = fixture(freshStore)
        MockHTTP.respond = { _ in throw SafariServiceError.message("Unexpected network request") }
        let signedOut = await fresh.authState()
        try check(signedOut["authenticated"] as? Bool == false, "old sessions do not authenticate OAuth")
        MockHTTP.respond = { request in
            if request.url?.path == "/v1/me" { return (200, validSession) }
            try check(request.url?.path == "/oauth2/token", "exchanges code at OAuth endpoint")
            return (200, tokenResponse)
        }
        let ready = try await fresh.prepareSignIn()
        let connected = await fresh.completeSignIn(ready, callback: URL(string: "teak-safari://oauth/callback?code=valid&state=\(ready.state)")!)
        try check(connected["authenticated"] as? Bool == true, "login stores OAuth credentials")
        try check(try freshStore.load()?.refreshToken == "new-refresh", "refresh token persisted")
        MockHTTP.respond = { _ in (200, validSession) }
        let restarted = fixture(freshStore)
        let restartedState = await restarted.authState()
        try check(restartedState["authenticated"] as? Bool == true, "restart uses persisted credentials")
        print("PASS: reconnect, code exchange, credential persistence, restart")

        MockHTTP.respond = { request in
            try check(request.url?.path == "/api/safari/account-summary", "account details use Safari endpoint")
            try check(request.value(forHTTPHeaderField: "Authorization") == "Bearer new-access", "account details use OAuth bearer")
            return (200, #"{"email":"hello@example.com","cardCount":830}"#)
        }
        let summary = try await restarted.accountSummary()
        try check(summary.email == "hello@example.com" && summary.cardCount == 830, "account details decode")
        MockHTTP.respond = { _ in (200, #"{"email":"hello@example.com","cardCount":-1}"#) }
        do {
            _ = try await restarted.accountSummary()
            throw SafariServiceError.message("TEST FAILED: negative usage accepted")
        } catch SafariServiceError.message(let message) {
            try check(message == "Unable to load account details. Please try again.", "negative usage rejected")
        }
        MockHTTP.respond = { _ in (401, #"{"error":"invalid_token"}"#) }
        do {
            _ = try await restarted.accountSummary()
            throw SafariServiceError.message("TEST FAILED: revoked account token accepted")
        } catch SafariServiceError.unauthenticated {
            try check(try freshStore.load() == nil, "revoked account token clears matching credentials")
        }
        print("PASS: Safari account summary and revoked-token handling")

        let store = MemoryCredentials(tokens())
        let service = fixture(store)
        var creates = 0
        MockHTTP.respond = { request in
            try check(request.value(forHTTPHeaderField: "Authorization") == "Bearer access", "saves use OAuth bearer")
            if request.url?.path == "/v1/cards/duplicate" { return (200, #"{"cardId":null}"#) }
            creates += 1
            try check(request.httpMethod == "POST", "save creates a card")
            try check(request.value(forHTTPHeaderField: "Idempotency-Key") != nil, "save carries idempotency key")
            return (200, #"{"cardId":"saved-card"}"#)
        }
        let saved = await service.saveCurrentPage(url: "https://example.com/page")
        try check(saved["status"] as? String == "saved" && creates == 1, "page saved once")
        MockHTTP.respond = { request in
            try check(request.url?.path == "/v1/cards/duplicate", "duplicate never creates a card")
            return (200, #"{"cardId":"existing-card"}"#)
        }
        let duplicate = await service.saveCurrentPage(url: "https://example.com/page")
        try check(duplicate["status"] as? String == "duplicate", "existing page reports duplicate")
        let invalid = await service.saveCurrentPage(url: "file:///private/test")
        try check(invalid["status"] as? String == "invalid-url", "invalid page refused")
        print("PASS: authenticated save, duplicate feedback, invalid URLs")

        let rotating = MemoryCredentials(tokens(expired: true))
        let sharedLock = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let first = fixture(rotating, lock: sharedLock), second = fixture(rotating, lock: sharedLock)
        var refreshes = 0
        MockHTTP.respond = { request in
            if request.url?.path == "/oauth2/token" { refreshes += 1; return (200, tokenResponse) }
            return (200, validSession)
        }
        async let firstState = first.authState()
        async let secondState = second.authState()
        let states = await [firstState, secondState]
        try check(states.allSatisfy { $0["authenticated"] as? Bool == true }, "both processes receive valid auth")
        try check(refreshes == 1, "concurrent clients refresh once")
        try check(try rotating.load()?.refreshToken == "new-refresh", "rotated refresh token persisted")
        print("PASS: silent refresh and cross-client refresh serialization")

        let libraryService = fixture(MemoryCredentials(tokens()))
        let library = LibraryAPI(service: libraryService)
        let cardJSON = ##"{"id":"card-1","type":"palette","content":"Warm colors","url":null,"metadataTitle":"Autumn","metadataDescription":null,"linkSiteName":null,"linkAuthor":null,"linkPublisher":null,"linkPublishedAt":null,"notes":"Reference","aiSummary":"Warm palette","aiTranscript":null,"tags":["design"],"aiTags":[],"colors":[{"hex":"#FFAA00","name":"Amber"}],"isFavorited":true,"createdAt":1000,"updatedAt":2000,"fileName":null,"fileKind":null,"fileLanguage":null,"filePreview":null,"fileSize":null,"mimeType":null,"fileUrl":null,"thumbnailUrl":null,"compactUrl":null,"detailUrl":null,"screenshotUrl":null,"linkPreviewImageUrl":null,"linkPreviewMedia":[]}"##
        var listCalls = 0
        MockHTTP.respond = { request in
            try check(request.url?.path == "/v1/cards", "library requests card list")
            try check(request.cachePolicy == .reloadIgnoringLocalCacheData, "refresh GET bypasses cached library responses")
            try check(request.value(forHTTPHeaderField: "Authorization") == "Bearer access", "library uses Safari OAuth bearer")
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
            try check(query.filter { $0.name == "type" }.map(\.value) == ["link", "palette"], "multiple type filters are repeated in stable order")
            try check(query.first { $0.name == "q" }?.value == "Autumn", "search query is trimmed")
            try check(query.first { $0.name == "favorited" }?.value == "true", "favorite filter is included")
            try check(query.first { $0.name == "include" }?.value == "content,metadata,processing", "presentation fields are requested")
            listCalls += 1
            if listCalls == 1 {
                try check(!query.contains { $0.name == "cursor" }, "first page has no cursor")
                return (200, "{\"items\":[\(cardJSON)],\"pageInfo\":{\"hasMore\":true,\"nextCursor\":\"next-1\"}}")
            }
            try check(query.first { $0.name == "cursor" }?.value == "next-1", "next page carries server cursor")
            return (200, #"{"items":[],"pageInfo":{"hasMore":false,"nextCursor":null}}"#)
        }
        let filters: Set<LibraryCardType> = [.palette, .link]
        let firstPage = try await library.list(query: " Autumn ", types: filters, favoritesOnly: true, cursor: nil)
        try check(firstPage.items.count == 1 && firstPage.items[0].colors?.first?.hex == "#FFAA00", "palette presentation decodes")
        try check(firstPage.items[0].notes == "Reference" && firstPage.items[0].aiSummary == "Warm palette", "detail metadata decodes")
        try check(firstPage.pageInfo.hasMore && firstPage.pageInfo.nextCursor == "next-1", "next cursor decodes")
        let secondPage = try await library.list(query: "Autumn", types: filters, favoritesOnly: true, cursor: firstPage.pageInfo.nextCursor)
        try check(secondPage.items.isEmpty && !secondPage.pageInfo.hasMore, "pagination ends cleanly")
        let mediaJSON = ##"{"id":"card-2","type":"link","content":null,"url":"https://example.com","metadataTitle":"Example","metadataDescription":null,"linkSiteName":"Example","linkAuthor":null,"linkPublisher":null,"linkPublishedAt":null,"notes":null,"aiSummary":null,"aiTranscript":null,"tags":[],"aiTags":[],"colors":[],"isFavorited":false,"createdAt":1000,"updatedAt":1000,"fileName":null,"fileKind":null,"fileLanguage":null,"filePreview":null,"fileSize":null,"mimeType":null,"fileUrl":null,"thumbnailUrl":null,"compactUrl":null,"detailUrl":null,"screenshotUrl":null,"linkPreviewImageUrl":null,"linkPreviewMedia":[{"type":"video","url":"https://cdn.example.com/video.mp4","contentType":"video/mp4","width":640,"height":360,"posterUrl":"https://cdn.example.com/poster.jpg"}]}"##
        MockHTTP.respond = { request in
            try check(request.url?.path == "/v1/cards/card-2", "card detail uses validated ID")
            return (200, mediaJSON)
        }
        let detail = try await library.card(id: "card-2")
        try check(detail.linkPreviewMedia?.first?.posterUrl == "https://cdn.example.com/poster.jpg", "resolved link media decodes")
        MockHTTP.respond = { request in
            if request.url?.path == "/v1/cards/duplicate" { return (200, #"{"cardId":null}"#) }
            return (200, #"{"cardId":"saved-card"}"#)
        }
        if case let .saved(id) = try await library.saveLink(" https://example.com/page ") {
            try check(id == "saved-card", "library save returns created card")
        } else { throw SafariServiceError.message("TEST FAILED: library save result") }
        let refreshingStore = MemoryCredentials(tokens(expired: true))
        let refreshingLibrary = LibraryAPI(service: fixture(refreshingStore))
        MockHTTP.respond = { request in
            if request.url?.path == "/oauth2/token" { return (200, tokenResponse) }
            try check(request.value(forHTTPHeaderField: "Authorization") == "Bearer new-access", "library uses refreshed access token")
            return (200, #"{"items":[],"pageInfo":{"hasMore":false,"nextCursor":null}}"#)
        }
        _ = try await refreshingLibrary.list(query: "", types: [], favoritesOnly: false, cursor: nil)
        try check(try refreshingStore.load()?.accessToken == "new-access", "library refresh persists credentials")
        print("PASS: native library decoding, combined filters, pagination, refresh, save")

        try await libraryStoreWrites(cardJSON: cardJSON)
        try await libraryWrites(cardJSON: cardJSON)
        try await libraryUploads()

        var sparseCalls = 0
        MockHTTP.respond = { request in
            sparseCalls += 1
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
            let cursor = query.first { $0.name == "cursor" }?.value
            let expectedCursor = sparseCalls == 1 ? nil : "scan-\(sparseCalls - 1)"
            try check(cursor == expectedCursor, "sparse results advance with the server cursor")
            if sparseCalls <= 8 {
                return (200, "{\"items\":[],\"pageInfo\":{\"hasMore\":true,\"nextCursor\":\"scan-\(sparseCalls)\"}}")
            }
            return (200, "{\"items\":[\(cardJSON)],\"pageInfo\":{\"hasMore\":false,\"nextCursor\":null}}")
        }
        let sparseStore = await MainActor.run {
            LibraryStore(api: LibraryAPI(service: fixture(MemoryCredentials(tokens()))), onAuthenticationRequired: {})
        }
        await sparseStore.loadFirstPage()
        let initialSparseCards = sparseStore.cards
        let canContinue = sparseStore.hasMore
        try check(initialSparseCards.isEmpty && canContinue && sparseCalls == 8, "sparse pages stay resumable after a bounded scan")
        await sparseStore.loadMore()
        let resumedCards = sparseStore.cards
        try check(resumedCards.count == 1 && sparseCalls == 9, "continuing a sparse scan reaches its matching card")
        print("PASS: sparse native library pagination")

        MockHTTP.respond = { _ in throw URLError(.notConnectedToInternet) }
        let offline = await service.authState()
        try check(offline["status"] as? String == "error", "offline is not misreported as sign-out")
        try check(try store.load() != nil, "offline preserves credentials")
        let offlineLogout = await service.signOut()
        try check(offlineLogout["status"] as? String == "error", "offline logout offers retry")
        try check(offlineLogout["authenticated"] as? Bool == true, "failed sign-out keeps retry available")
        try check(try store.load() != nil, "failed disconnect remains retryable")
        MockHTTP.respond = { _ in (401, #"{"error":"Unauthorized"}"#) }
        let revoked = await service.authState()
        try check(revoked["authenticated"] as? Bool == false, "remote disconnection detected")
        try check(try store.load() == nil, "revoked credentials cleared")
        print("PASS: offline recovery and remote revocation")

        let expired = MemoryCredentials(tokens(expired: true))
        MockHTTP.respond = { _ in (401, #"{"error":"invalid_grant"}"#) }
        let expiredState = await fixture(expired).authState()
        try check(expiredState["authenticated"] as? Bool == false, "invalid refresh requires reconnect")
        try check(try expired.load() == nil, "invalid refresh cleared")
        try store.save(tokens())
        MockHTTP.respond = { _ in (401, #"{"error":"Unauthorized"}"#) }
        let refused = await service.saveCurrentPage(url: "https://example.com/page")
        try check(refused["status"] as? String == "unauthenticated", "revoked access cannot save")
        let racy = MemoryCredentials(tokens())
        let racyService = fixture(racy)
        MockHTTP.respond = { request in
            // The other process rotates credentials while our request is in flight.
            try racy.save(tokens(access: "rotated-access", refresh: "rotated-refresh"))
            _ = request
            return (401, #"{"error":"Unauthorized"}"#)
        }
        let stale = await racyService.saveCurrentPage(url: "https://example.com/page")
        try check(stale["status"] as? String == "unauthenticated", "stale 401 reports unauthenticated")
        try check(try racy.load()?.accessToken == "rotated-access", "stale 401 preserves rotated credentials")
        MockHTTP.respond = { _ in (401, #"{"error":"Unauthorized"}"#) }
        let genuine = await racyService.saveCurrentPage(url: "https://example.com/page")
        try check(genuine["status"] as? String == "unauthenticated", "genuine 401 requires reconnect")
        try check(try racy.load() == nil, "genuine 401 clears matching credentials")
        try store.save(tokens())
        MockHTTP.respond = { _ in (401, "") }
        let emptyDenied = await service.authState()
        try check(emptyDenied["authenticated"] as? Bool == false, "empty 401 requires reconnect")
        try check(try store.load() == nil, "empty 401 clears credentials")
        try store.save(tokens())
        MockHTTP.respond = { _ in (200, "") }
        let emptySave = await service.saveCurrentPage(url: "https://example.com/page")
        try check(emptySave["status"] as? String == "error", "empty save response surfaces error")
        try store.save(tokens())
        MockHTTP.respond = { request in
            try check(request.url?.path == "/v1/oauth/disconnect", "logout disconnects through Teak")
            try check(request.value(forHTTPHeaderField: "Authorization") == "Bearer access", "logout proves the saved grant")
            return (204, "")
        }
        let logout = await service.signOut()
        try check(logout["status"] as? String == "signed-out", "logout succeeds after disconnect")
        try check(try store.load() == nil, "logout clears credentials")
        print("PASS: expired refresh, revoked save, local sign-out")
    }
}
