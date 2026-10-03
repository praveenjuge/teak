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

    @MainActor static func paginationMutationRace(cardJSON: String) async throws {
        let card = try JSONDecoder().decode(LibraryCard.self, from: Data(cardJSON.utf8))
        let existing = cardJSON.replacingOccurrences(of: "card-1", with: "card-2")
        for failure in [false, true] {
            let store = LibraryStore(api: LibraryAPI(service: fixture(MemoryCredentials(tokens()))), onAuthenticationRequired: {})
            MockHTTP.respond = { _ in (200, "{\"items\":[\(existing)],\"pageInfo\":{\"hasMore\":true,\"nextCursor\":\"next\"}}") }
            await store.loadFirstPage()
            var mutation: MockHTTP?
            var saving: Task<LibraryCard, Error>?
            await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
                MockHTTP.hold = { request in
                    guard request.request.httpMethod == "PATCH" else { return false }
                    mutation = request
                    started.resume()
                    return true
                }
                saving = Task { try await store.setFavorite(card) }
            }
            MockHTTP.respond = { _ in (200, "{\"items\":[\(cardJSON)],\"pageInfo\":{\"hasMore\":false,\"nextCursor\":null}}") }
            await store.loadMore()
            try check(store.cards.last?.isFavorited == !card.isFavorited, "pagination displays pending favorite")
            MockHTTP.hold = nil
            mutation!.complete(status: failure ? 503 : 200, body: failure ? #"{"error":"Please retry"}"# : cardJSON)
            if failure { try await rejectsAsync("pagination mutation fails") { _ = try await saving!.value } }
            else { _ = try await saving!.value }
            try check(store.cards.map(\.id) == ["card-2", "card-1"] && store.cards.last?.isFavorited == card.isFavorited,
                      "pagination keeps order and replaces pending value after confirmation or rollback")
        }
    }

    @MainActor static func failedUnloadedDeleteDuringPagination(cardJSON: String) async throws {
        let card = try JSONDecoder().decode(LibraryCard.self, from: Data(cardJSON.utf8))
        let existing = cardJSON.replacingOccurrences(of: "card-1", with: "card-2")
        let store = LibraryStore(api: LibraryAPI(service: fixture(MemoryCredentials(tokens()))), onAuthenticationRequired: {})
        MockHTTP.respond = { _ in (200, "{\"items\":[\(existing)],\"pageInfo\":{\"hasMore\":true,\"nextCursor\":\"next\"}}") }
        await store.loadFirstPage()
        var deletion: MockHTTP?
        var deleting: Task<Void, Error>?
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            MockHTTP.hold = { request in
                guard request.request.httpMethod == "DELETE" else { return false }
                deletion = request
                started.resume()
                return true
            }
            deleting = Task { try await store.delete(card) }
        }
        MockHTTP.respond = { _ in (200, "{\"items\":[\(cardJSON)],\"pageInfo\":{\"hasMore\":false,\"nextCursor\":null}}") }
        await store.loadMore()
        try check(store.cards.map(\.id) == ["card-2"] && !store.hasMore,
                  "pagination skips the pending deletion and consumes its last page")
        MockHTTP.hold = nil
        MockHTTP.respond = { _ in (200, "{\"items\":[\(existing),\(cardJSON)],\"pageInfo\":{\"hasMore\":false,\"nextCursor\":null}}") }
        deletion!.complete(status: 503, body: #"{"error":"Please retry"}"#)
        try await rejectsAsync("unloaded deletion fails after pagination") { try await deleting!.value }
        try check(store.cards.map(\.id) == ["card-2", "card-1"] && store.mutatingIDs.isEmpty,
                  "failed deletion recovers the card skipped by the consumed page")
    }
}
