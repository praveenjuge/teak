import Foundation
import Testing
@testable import TeakCore

// Ported from apps/mobile/__tests__/lib/{library-filters,card-grid}.test.ts,
// apps/android TimeSearchTest and the Mac app's search tokens.

private let newYork = TimeZone(identifier: "America/New_York")!
/// Tuesday, Feb 3, 2026, noon in New York.
private let now: Date = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = newYork
    return calendar.date(from: DateComponents(year: 2026, month: 2, day: 3, hour: 12))!
}()

private func day(_ milliseconds: Double) -> String {
    let formatter = DateFormatter()
    formatter.timeZone = newYork
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: Date(timeIntervalSince1970: milliseconds / 1000))
}

@Suite struct TimeSearchTests {
    @Test(arguments: [
        ("today", "Today", "2026-02-03", "2026-02-04"),
        ("yesterday", "Yesterday", "2026-02-02", "2026-02-03"),
        ("last week", "Last Week", "2026-01-25", "2026-02-01"),
        ("Last  Month", "Last Month", "2026-01-01", "2026-02-01"),
        ("monday", "Monday", "2026-02-02", "2026-02-03"),
        ("last monday", "Last Monday", "2026-01-26", "2026-01-27"),
        ("June 2024", "Jun 2024", "2024-06-01", "2024-07-01"),
        ("June 5, 2024", "Jun 5, 2024", "2024-06-05", "2024-06-06"),
        ("2024-06-05", "Jun 5, 2024", "2024-06-05", "2024-06-06"),
        ("06/05/2024", "Jun 5, 2024", "2024-06-05", "2024-06-06"),
        ("2024", "2024", "2024-01-01", "2025-01-01"),
        ("June 2024 to July 2025", "Jun 2024 – Jul 2025", "2024-06-01", "2025-08-01"),
        ("from 2024-06-05 to 2024-07-01", "Jun 5, 2024 – Jul 1, 2024", "2024-06-05", "2024-07-02"),
        ("march", "Mar 2026", "2026-03-01", "2026-04-01"),
    ])
    func parsesDatePhrases(query: String, label: String, start: String, end: String) throws {
        let result = try #require(TimeSearch.parse(query, now: now, timeZone: newYork))
        #expect(result.label == label)
        #expect(day(result.range.start) == start)
        #expect(day(result.range.end) == end)
    }

    @Test(arguments: ["design inspiration", "2024-02-30", "July 2025 to June 2024", "mar", ""])
    func leavesOtherTextToFullTextSearch(query: String) {
        #expect(TimeSearch.parse(query, now: now, timeZone: newYork) == nil)
    }
}

@Suite struct LibraryFilterTests {
    @Test func sendsOnlyTheFiltersThatAreOn() {
        #expect(LibraryQuery().searchArgs(now: now) == [:])
        let filters = LibraryFilters(favoritesOnly: true, trashOnly: true, types: [.image, .link], hue: ColorHue("blue"))
        #expect(LibraryQuery(filters: filters).searchArgs(now: now) == [
            "favoritesOnly": true, "showTrashOnly": true, "types": ["image", "link"], "hueFilters": ["blue"],
        ])
    }

    @Test func togglingATypeAddsThenRemovesIt() {
        let withImages = LibraryFilters.empty.togglingType(.image)
        #expect(withImages.types == [.image])
        #expect(withImages.isActive)
        #expect(withImages.togglingType(.image).types.isEmpty)
        #expect(!withImages.togglingType(.image).isActive)
    }

    @Test(arguments: [
        (LibraryFilters.empty, "Home"),
        (LibraryFilters(favoritesOnly: true, trashOnly: true), "Trash"),
        (LibraryFilters(favoritesOnly: true), "Favorites"),
        (LibraryFilters(types: [.text]), "Notes"),
        (LibraryFilters(favoritesOnly: true, types: [.link]), "Favorite Links"),
        (LibraryFilters(hue: ColorHue("teal")), "Teal"),
        (LibraryFilters(types: [.link, .image]), "Filtered"),
    ])
    func titlesTheView(filters: LibraryFilters, title: String) {
        #expect(filters.title == title)
    }
}

@Suite struct SearchTokenTests {
    @Test(arguments: [
        ("favs", SearchToken.Kind.favorites, "favorites"),
        ("bin", .trash, "trash"),
        ("image", .type, "image"),
        ("Cinema", .style, "cinematic"),
        ("photo", .style, "photographic"),
        ("violet", .hue, "purple"),
        ("grey", .hue, "neutral"),
        ("#f0a", .hex, "#FF00AA"),
        ("1E90FF", .hex, "#1E90FF"),
        ("#travel", .tag, "travel"),
        ("yesterday", .date, "yesterday"),
        ("typography", .keyword, "typography"),
    ])
    func classifiesTypedWords(input: String, kind: SearchToken.Kind, value: String) {
        let token = SearchTokens.classify(input, now: now, timeZone: newYork)
        #expect(token.kind == kind)
        #expect(token.value == value)
    }

    @Test func keepsMultiWordDatesTogether() {
        let tokens = SearchTokens.parse("blue posters from June 5 2024 to July 6 2025, favs", now: now, timeZone: newYork)
        #expect(tokens.map(\.kind) == [.hue, .keyword, .date, .favorites])
        #expect(tokens[2].label == "Jun 5, 2024 – Jul 6, 2025")
    }

    @Test func tokensBecomeSearchArguments() throws {
        let query = LibraryQuery(
            text: "poster",
            tokens: [SearchTokens.classify("violet"), SearchTokens.classify("retro"), SearchTokens.classify("#fff"),
                     SearchTokens.tag("travel"), SearchTokens.classify("trash"), SearchTokens.classify("video"),
                     SearchTokens.classify("last week", now: now, timeZone: newYork)],
            filters: LibraryFilters(hue: ColorHue("red")))
        let args = query.searchArgs(now: now, timeZone: newYork)
        #expect(args["hueFilters"] == ["red", "purple"])
        #expect(args["styleFilters"] == ["retro"])
        #expect(args["hexFilters"] == ["#FFFFFF"])
        #expect(args["showTrashOnly"] == true)
        #expect(args["types"] == ["video"])
        #expect(args["searchQuery"] == "travel poster")
        guard case let .object(range)? = args["createdAtRange"], case let .number(start)? = range["start"] else {
            Issue.record("Expected a date range")
            return
        }
        #expect(day(start) == "2026-01-25")
    }

    @Test func aTypedDateFiltersByDateInsteadOfText() {
        let args = LibraryQuery(text: "last week").searchArgs(now: now, timeZone: newYork)
        #expect(args["searchQuery"] == nil)
        #expect(args["createdAtRange"] != nil)
    }

    @Test func titlesAndEmptyStatesFollowTheQuery() {
        #expect(LibraryQuery(tokens: [SearchTokens.classify("retro")]).title == "Filtered")
        #expect(LibraryQuery(tokens: [SearchTokens.classify("favs")]).title == "Favorites")
        #expect(LibraryQuery(filters: LibraryFilters(trashOnly: true)).emptyState().title == "Trash Is Empty")
        #expect(LibraryQuery(text: "zebra").emptyState().title == "No Results for \u{201C}zebra\u{201D}")
        #expect(LibraryQuery(text: "yesterday").emptyState(now: now, timeZone: newYork).message == "No cards from Yesterday.")
    }
}

@Suite struct CardGridTests {
    private func summary(_ type: CardType, aspectRatio: Double? = nil, compactUrl: String? = nil,
                         linkPreviewImageUrl: String? = nil, screenshotUrl: String? = nil,
                         thumbnailUrl: String? = nil) -> CardSummary {
        CardSummary(id: "card", creationTime: 1, type: type, title: "Card", aspectRatio: aspectRatio,
                    thumbnailUrl: thumbnailUrl, compactUrl: compactUrl, screenshotUrl: screenshotUrl,
                    linkPreviewImageUrl: linkPreviewImageUrl)
    }

    @Test func usesMoreColumnsAsTheWindowWidens() {
        #expect([402, 820, 1180, 1400].map { CardGrid.columnCount(width: $0) } == [2, 3, 4, 5])
    }

    @Test func placesEachTileInTheShortestColumn() {
        #expect(CardGrid.distribute([300.0, 100, 100, 100], columns: 2, gap: 0) { $0 } == [[300], [100, 100, 100]])
    }

    @Test func prefersTheLinkPreviewImageThenTheScreenshot() {
        #expect(CardGrid.tileImageURL(summary(.link, linkPreviewImageUrl: "og", screenshotUrl: "shot")) == "og")
        #expect(CardGrid.tileImageURL(summary(.link, screenshotUrl: "shot")) == "shot")
        #expect(CardGrid.tileImageURL(summary(.text, thumbnailUrl: "x")) == nil)
    }

    @Test func sizesMediaFromItsAspectRatioAndClampsExtremes() {
        #expect(CardGrid.tileImageRatio(summary(.image, aspectRatio: 2)) == 2)
        #expect(CardGrid.tileImageRatio(summary(.image, aspectRatio: 0.1)) == 0.5)
        #expect(abs(CardGrid.tileImageRatio(summary(.link)) - 1.91) < 0.001)
        #expect(CardGrid.estimatedHeight(summary(.image, aspectRatio: 0.5, compactUrl: "x"), columnWidth: 180) == 360)
    }

    /// Reference values from `getAudioWaveHeight("k17abc123", i)` in packages/ui.
    @Test func drawsTheSameWaveformAsTheWeb() {
        let heights = CardGrid.waveformHeights(seed: "k17abc123")
        #expect(heights.count == 45)
        for (index, expected) in [(0, 36.131), (1, 67.497), (7, 42.315), (44, 55.251)] {
            #expect(abs(heights[index] * 60 + 20 - expected) < 0.01)
        }
    }
}
