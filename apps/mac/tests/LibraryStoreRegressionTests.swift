import Foundation

extension SafariOAuthTests {
    @MainActor static func searchTokensAndTrash(cardJSON: String) async throws {
        for (input, kind, value) in [
            ("fav", LibrarySearchToken.Kind.favorites, "favorites"), ("bin", .trash, "trash"),
            ("last week", .date, "last week"), ("minimalist", .style, "minimal"),
            ("violet", .hue, "purple"), ("#abc", .hex, "#AABBCC"), ("ordinary", .keyword, "ordinary")
        ] {
            let token = LibrarySearchTokens.classify(input)
            try check(token.kind == kind && token.value == value, "classifies \(input) into its search filter")
        }
        let punctuated = LibrarySearchTokens.parse("design last week, image")
        try check(punctuated.map(\.kind) == [.keyword, .date, .type], "punctuation preserves multiword date filters")
        for (markdown, expected) in [
            ("# A **clear** note", "A clear note"),
            ("- [x] Save [this](https://example.com)\n> `idea`", "Save this idea"),
            ("<!-- hidden --> ![Photo](https://example.com/photo.png)", "Photo")
        ] {
            try check(LibraryCard.plainPreview(markdown) == expected, "grid previews show readable text without Markdown markers")
        }
        let imageFixture = cardJSON.replacingOccurrences(of: "\"type\":\"palette\"", with: "\"type\":\"link\"")
            .replacingOccurrences(of: "\"linkPreviewMedia\":[]", with: "\"linkPreviewMedia\":[{\"type\":\"image\",\"url\":\"https://example.com/media.jpg\"}]")
            .replacingOccurrences(of: "\"compactUrl\":null", with: "\"compactUrl\":\"https://example.com/compact.jpg\"")
            .replacingOccurrences(of: "\"linkPreviewImageUrl\":null", with: "\"linkPreviewImageUrl\":\"https://example.com/og.jpg\"")
        let imageCard = try JSONDecoder().decode(LibraryCard.self, from: Data(imageFixture.utf8))
        try check(imageCard.displayImageURL?.absoluteString == "https://example.com/media.jpg", "link cards prefer first media image over compact and Open Graph images")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = calendar.date(from: DateComponents(year: 2026, month: 10, day: 3))!
        let week = LibrarySearchTokens.classify("last week", now: now, calendar: calendar)
        try check(week.dateRange?.lowerBound == calendar.date(from: DateComponents(year: 2026, month: 9, day: 20)), "last week starts on the web's Sunday boundary")
        for (input, start, end) in [
            ("monday", DateComponents(year: 2026, month: 9, day: 28), DateComponents(year: 2026, month: 9, day: 29)),
            ("last monday", DateComponents(year: 2026, month: 9, day: 21), DateComponents(year: 2026, month: 9, day: 22)),
            ("2024-06-05", DateComponents(year: 2024, month: 6, day: 5), DateComponents(year: 2024, month: 6, day: 6)),
            ("6/5/2024", DateComponents(year: 2024, month: 6, day: 5), DateComponents(year: 2024, month: 6, day: 6)),
            ("June 5, 2024", DateComponents(year: 2024, month: 6, day: 5), DateComponents(year: 2024, month: 6, day: 6)),
            ("June 2024 to July 2025", DateComponents(year: 2024, month: 6, day: 1), DateComponents(year: 2025, month: 8, day: 1)),
            ("from June 5 2024 to July 6 2025", DateComponents(year: 2024, month: 6, day: 5), DateComponents(year: 2025, month: 7, day: 7)),
            ("2024 - 2025", DateComponents(year: 2024, month: 1, day: 1), DateComponents(year: 2026, month: 1, day: 1))
        ] {
            let tokens = LibrarySearchTokens.parse("design \(input) image", now: now, calendar: calendar)
            try check(tokens.count == 3 && tokens[1].kind == .date, "recognizes complete date phrase \(input) without consuming surrounding filters")
            try check(tokens[1].dateRange == calendar.date(from: start)!..<calendar.date(from: end)!, "matches web date boundaries for \(input)")
        }
        for invalid in ["2024-02-30", "2/30/2024", "June 32 2024", "July 2025 to June 2024"] {
            try check(LibrarySearchTokens.classify(invalid, now: now, calendar: calendar).kind == .keyword, "invalid date remains text: \(invalid)")
        }
        let store = LibraryStore(api: LibraryAPI(service: fixture(MemoryCredentials(tokens()))), onAuthenticationRequired: {})
        store.searchText = "trash fav last week minimal #abc"
        store.commitSearchTokens()
        try check(store.trashOnly && store.favoritesOnly && store.activeChips.count == 5 && store.searchText.isEmpty, "Enter converts all search commands into chips")
        let trashed = cardJSON.replacingOccurrences(of: "\"id\":", with: "\"isDeleted\":true,\"id\":")
        MockHTTP.respond = { request in
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
            for (name, value) in [("trashed", "true"), ("favorited", "true"), ("style", "minimal"), ("hex", "#AABBCC")] {
                try check(query.contains { $0.name == name && $0.value == value }, "search forwards \(name) chip")
            }
            try check(query.contains { $0.name == "createdAfter" }, "date chip supplies date bounds")
            return (200, "{\"items\":[\(trashed)],\"pageInfo\":{\"hasMore\":false,\"nextCursor\":null}}")
        }
        await store.loadFirstPage()
        try check(store.cards.count == 1 && store.cards[0].isDeleted == true, "trash search retains deleted cards")
        store.removeLastChip()
        try check(!store.activeChips.contains { $0.kind == .hex }, "Backspace removes the latest chip")
        MockHTTP.respond = { request in
            try check(request.httpMethod == "POST" && request.url?.path == "/v1/cards/card-1/restore", "restore uses its public endpoint")
            return (204, "")
        }
        try await store.restore(store.cards[0])
        try check(store.cards.isEmpty && store.statusMessage == "Card restored", "restore removes the card from Trash with web feedback")
        let card = try JSONDecoder().decode(LibraryCard.self, from: Data(trashed.utf8))
        MockHTTP.respond = { request in
            try check(request.httpMethod == "DELETE" && request.url?.query == "permanent=true", "permanent deletion explicitly requests destructive deletion")
            return (204, "")
        }
        try await store.permanentDelete(card)
        store.clearFilters()
        try check(store.activeChips.isEmpty && !store.hasFilters && !store.trashOnly, "Clear All resets every filter")
    }

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
