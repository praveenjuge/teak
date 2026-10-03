import Foundation

extension SafariOAuthTests {
    @MainActor static func creationSearchRace(cardJSON: String) async throws {
        let store = LibraryStore(api: LibraryAPI(service: fixture(MemoryCredentials(tokens()))), onAuthenticationRequired: {})
        let page = "{\"items\":[\(cardJSON)],\"pageInfo\":{\"hasMore\":false,\"nextCursor\":null}}"
        MockHTTP.respond = { _ in (200, page) }
        await store.loadFirstPage()
        var detail: MockHTTP?
        var insertion: Task<Void, Never>?
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            MockHTTP.hold = { request in
                guard request.request.url?.path == "/v1/cards/card-1" else { return false }
                detail = request
                started.resume()
                return true
            }
            insertion = Task { await store.insertCreated(id: "card-1") }
        }
        store.searchText = "Unrelated"
        MockHTTP.respond = { request in
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
            try check(query.contains { $0.name == "q" && $0.value == "Unrelated" }, "new search uses its current query")
            return (200, #"{"items":[],"pageInfo":{"hasMore":false,"nextCursor":null}}"#)
        }
        await store.loadFirstPage()
        MockHTTP.hold = nil
        detail!.complete(status: 200, body: cardJSON)
        await insertion!.value
        try check(store.cards.isEmpty && store.searchText == "Unrelated" && !store.isLoading,
                  "late creation details cannot insert an unrelated card into a newer search")
    }
}
