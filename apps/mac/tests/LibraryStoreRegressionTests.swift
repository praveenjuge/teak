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

    @MainActor static func unloadedCardMutation(cardJSON: String) async throws {
        let store = LibraryStore(api: LibraryAPI(service: fixture(MemoryCredentials(tokens()))), onAuthenticationRequired: {})
        let card = try JSONDecoder().decode(LibraryCard.self, from: Data(cardJSON.utf8))
        MockHTTP.respond = { _ in (200, "{\"items\":[],\"pageInfo\":{\"hasMore\":false,\"nextCursor\":null}}") }
        await store.loadFirstPage()
        MockHTTP.respond = { _ in (200, cardJSON) }
        _ = try await store.setFavorite(card)
        try check(store.cards.isEmpty, "favoriting an unloaded detail does not insert it out of sort order")
        MockHTTP.respond = { _ in (503, #"{"error":"Please retry"}"#) }
        try await rejectsAsync("unloaded deletion fails") { try await store.delete(card) }
        try check(store.cards.isEmpty, "failed deletion of an unloaded detail does not insert it")
    }

    @MainActor static func creationRefreshRace(cardJSON: String) async throws {
        let store = LibraryStore(api: LibraryAPI(service: fixture(MemoryCredentials(tokens()))), onAuthenticationRequired: {})
        store.searchText = "Old filter"
        var refresh: MockHTTP?
        var insertion: Task<Void, Never>?
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            MockHTTP.hold = { request in
                guard request.request.url?.path == "/v1/cards" else { return false }
                refresh = request
                started.resume()
                return true
            }
            insertion = Task { await store.insertCreated(id: "card-1") }
        }
        store.searchText = "Unrelated"
        MockHTTP.hold = nil
        MockHTTP.respond = { request in
            try check(request.url?.path == "/v1/cards", "superseded creation does not fetch details")
            return (200, #"{"items":[],"pageInfo":{"hasMore":false,"nextCursor":null}}"#)
        }
        await store.loadFirstPage()
        refresh!.complete(status: 200, body: #"{"items":[],"pageInfo":{"hasMore":false,"nextCursor":null}}"#)
        await insertion!.value
        try check(store.cards.isEmpty && store.searchText == "Unrelated", "filter change during creation refresh prevents insertion")
    }

    @MainActor static func creationInitialLoadRace(cardJSON: String) async throws {
        let store = LibraryStore(api: LibraryAPI(service: fixture(MemoryCredentials(tokens()))), onAuthenticationRequired: {})
        var initial: MockHTTP?
        var loading: Task<Void, Never>?
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            MockHTTP.hold = { request in
                initial = request
                started.resume()
                return true
            }
            loading = Task { await store.loadFirstPage() }
        }
        MockHTTP.hold = nil
        let existing = cardJSON.replacingOccurrences(of: "card-1", with: "card-2")
        MockHTTP.respond = { request in
            if request.url?.path == "/v1/cards/card-1" { return (200, cardJSON) }
            return (200, "{\"items\":[\(existing)],\"pageInfo\":{\"hasMore\":true,\"nextCursor\":\"next\"}}")
        }
        await store.insertCreated(id: "card-1")
        initial!.complete(status: 200, body: #"{"items":[],"pageInfo":{"hasMore":false,"nextCursor":null}}"#)
        await loading!.value
        try check(store.cards.map(\.id) == ["card-1", "card-2"] && store.hasMore,
                  "creation during initial load preserves existing cards and pagination")
    }
}
