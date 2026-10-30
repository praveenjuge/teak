import Foundation
import Testing
@testable import TeakCore

private let newYork = TimeZone(identifier: "America/New_York")!
private let tuesdayNoon: Date = {
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

@Suite(.english) struct TimeSearchTests {
    @Test(arguments: [
        ("today", "Today", "2026-02-03", "2026-02-04"),
        ("yesterday", "Yesterday", "2026-02-02", "2026-02-03"),
        ("last week", "Last week", "2026-01-25", "2026-02-01"),
        ("Last  Month", "Last month", "2026-01-01", "2026-02-01"),
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
        let result = try #require(TimeSearch.parse(query, now: tuesdayNoon, timeZone: newYork))
        #expect(result.label == label)
        #expect(day(result.range.lowerBound) == start)
        #expect(day(result.range.upperBound) == end)
    }

    /// The words people type stay English; dates and weekdays read in the app's language.
    @Test func labelsDatesInTheAppsLanguage() {
        let german = Locale(identifier: "de")
        #expect(TimeSearch.parse("2024-06-05", now: tuesdayNoon, timeZone: newYork, locale: german)?.label == "5. Juni 2024")
        #expect(TimeSearch.parse("monday", now: tuesdayNoon, timeZone: newYork, locale: german)?.label == "Montag")
    }

    @Test(arguments: [
        "design inspiration", "2024-02-30", "July 2025 to June 2024", "mar", "", "1234", "4096", "2037",
        // Swift's `\d` matches these digits but `Int` can't read them; they stay text, as on the web.
        "２０２４", "٢٠٢٤", "june ２０２４", "２０２４-０６-０５",
    ])
    func leavesOtherTextToFullTextSearch(query: String) {
        #expect(TimeSearch.parse(query, now: tuesdayNoon, timeZone: newYork) == nil)
    }
}

@Suite(.english) struct LibraryFilterTests {
    @Test func aSmartFolderThatSavesIsArchivedIsAnArchiveView() {
        let archived = Folder(id: "f1", name: "Old reads", kind: .smart, query: "is:archived type:link")
        #expect(LibraryQuery(filters: LibraryFilters(folder: FolderScope(archived))).isArchive)
        let plain = Folder(id: "f2", name: "Links", kind: .smart, query: "type:link")
        #expect(!LibraryQuery(filters: LibraryFilters(folder: FolderScope(plain))).isArchive)
        let manual = Folder(id: "f3", name: "is:archived", kind: .manual, query: "is:archived")
        #expect(!LibraryQuery(filters: LibraryFilters(folder: FolderScope(manual))).isArchive)
    }

    @Test func trashAndArchiveAreSeparateViews() {
        var filters = LibraryFilters(archivedOnly: true)
        filters.trashOnly = true
        #expect(filters.trashOnly && !filters.archivedOnly)
        filters.archivedOnly = true
        #expect(filters.archivedOnly && !filters.trashOnly)
    }

    @Test func sendsOnlyTheFiltersThatAreOn() {
        #expect(LibraryQuery().searchArgs(now: tuesdayNoon) == [:])
        let filters = LibraryFilters(favoritesOnly: true, trashOnly: true, types: [.image, .link], hue: ColorHue("blue"))
        #expect(LibraryQuery(filters: filters).searchArgs(now: tuesdayNoon) == [
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
        (LibraryFilters(favoritesOnly: true, types: [.link]), "Favorite links"),
        (LibraryFilters(hue: ColorHue("teal")), "Teal"),
        (LibraryFilters(types: [.link, .image]), "Filtered"),
    ])
    func titlesTheView(filters: LibraryFilters, title: String) {
        #expect(filters.title == title)
    }
}

@Suite(.english) struct SearchTokenTests {
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
        ("bad", .keyword, "bad"),
        ("100", .keyword, "100"),
        ("#travel", .tag, "travel"),
        ("yesterday", .date, "yesterday"),
        ("typography", .style, "typographic"),
        ("poster", .keyword, "poster"),
    ])
    func classifiesTypedWords(input: String, kind: SearchToken.Kind, value: String) {
        let token = SearchTokens.classify(input, now: tuesdayNoon, timeZone: newYork)
        #expect(token.kind == kind)
        #expect(token.value == value)
    }

    @Test func keepsMultiWordDatesTogether() {
        let tokens = SearchTokens.parse("blue posters from June 5 2024 to July 6 2025, favs", now: tuesdayNoon, timeZone: newYork)
        #expect(tokens.map(\.kind) == [.hue, .keyword, .date, .favorites])
        #expect(tokens[2].label == "Jun 5, 2024 – Jul 6, 2025")
    }

    @Test func tokensBecomeSearchArguments() throws {
        let query = LibraryQuery(
            text: "poster",
            tokens: [SearchTokens.classify("violet"), SearchTokens.classify("retro"), SearchTokens.classify("#fff"),
                     SearchTokens.tag("travel"), SearchTokens.classify("trash"), SearchTokens.classify("video"),
                     SearchTokens.classify("last week", now: tuesdayNoon, timeZone: newYork)],
            filters: LibraryFilters(hue: ColorHue("red")))
        let args = query.searchArgs(now: tuesdayNoon, timeZone: newYork)
        #expect(args["hueFilters"] == ["red", "purple"])
        #expect(args["styleFilters"] == ["retro"])
        #expect(args["hexFilters"] == ["#FFFFFF"])
        #expect(args["showTrashOnly"] == true)
        #expect(args["types"] == ["video"])
        #expect(args["searchQuery"] == "tag:travel poster")
        guard case let .object(range)? = args["createdAtRange"], case let .number(start)? = range["start"] else {
            Issue.record("Expected a date range")
            return
        }
        #expect(day(start) == "2026-01-25")
    }

    @Test func aTypedDateFiltersByDateInsteadOfText() {
        let args = LibraryQuery(text: "last week").searchArgs(now: tuesdayNoon, timeZone: newYork)
        #expect(args["searchQuery"] == nil)
        #expect(args["createdAtRange"] != nil)
    }

    @Test func aDateBesideWordsKeepsTheWords() throws {
        let args = LibraryQuery(text: "figma last week").searchArgs(now: tuesdayNoon, timeZone: newYork)
        #expect(args["searchQuery"] == "figma")
        guard case let .object(range)? = args["createdAtRange"], case let .number(start)? = range["start"] else {
            Issue.record("Expected a date range")
            return
        }
        #expect(day(start) == "2026-01-25")
        // A lone number beside words stays a word, and operators keep the text whole.
        #expect(LibraryQuery(text: "iphone 2024").searchArgs(now: tuesdayNoon, timeZone: newYork)["createdAtRange"] == nil)
        // So does a month name: only the whole search "march" is a date.
        let may = LibraryQuery(text: "things i may need").searchArgs(now: tuesdayNoon, timeZone: newYork)
        #expect(may["createdAtRange"] == nil)
        #expect(may["searchQuery"] == "things i may need")
        #expect(SearchTokens.parse("things i may need", now: tuesdayNoon, timeZone: newYork).map(\.kind) == [.keyword])
        #expect(SearchTokens.parse("top 100 bad sites", now: tuesdayNoon, timeZone: newYork).map(\.kind) == [.keyword])
        #expect(LibraryQuery(text: "-figma last week").searchArgs(now: tuesdayNoon, timeZone: newYork)["searchQuery"]
            == "-figma last week")
        // A smart folder saves only the words, so saving warns that the date is left behind.
        #expect(LibraryQuery(text: "figma last week").smartFolderDropsFilters)
        #expect(!LibraryQuery(text: "figma").smartFolderDropsFilters)
    }

    @Test(arguments: [
        "design -figma", "tag:fonts OR tag:type", "(site:github.com OR site:gitlab.com) -is:archived", "site:github.com",
        "-\"exact phrase\" notes", "(a OR b) c",
    ])
    func searchTextIsSentAsTyped(text: String) {
        #expect(LibraryQuery(text: text).searchArgs(now: tuesdayNoon, timeZone: newYork)["searchQuery"] == .string(text))
        // Pressing Return keeps it whole, so the operators reach the backend.
        let tokens = SearchTokens.parse(text, now: tuesdayNoon, timeZone: newYork)
        #expect(tokens.map(\.kind) == [.keyword])
        #expect(LibraryQuery(tokens: tokens).searchArgs(now: tuesdayNoon, timeZone: newYork)["searchQuery"] == .string(text))
    }

    @Test func returnLiftsOnlyFiltersWithTheirOwnArgument() {
        let tokens = SearchTokens.parse("type:image tag:fonts \"design system\" is:fav last week site:github.com",
                                        now: tuesdayNoon, timeZone: newYork)
        #expect(tokens.map(\.kind) == [.type, .keyword, .favorites, .date])
        #expect(tokens[1].value == "tag:fonts \"design system\" site:github.com")
        let operators = SearchTokens.parse("type:image OR is:fav", now: tuesdayNoon, timeZone: newYork)
        #expect(operators.map(\.value) == ["type:image OR is:fav"])
    }

    @Test func anOrBesideOtherWordsIsGrouped() {
        let query = LibraryQuery(text: "tag:fonts OR tag:type", tokens: [SearchTokens.parse("design")[0]])
        #expect(query.searchArgs()["searchQuery"] == "design (tag:fonts OR tag:type)")
        let folder = LibraryQuery(text: "a OR b", filters: LibraryFilters(types: [.link]))
        #expect(folder.smartFolderQuery == "type:link (a OR b)")
    }

    @Test func suggestsExcludeAndOrAsHints() throws {
        let exclude = SearchTokens.suggestions(for: "design -")
        #expect(exclude.map(\.kind) == Array(repeating: .hint, count: 5))
        #expect(exclude.map(\.value) == ["-tag:", "-type:", "-site:", "-folder:", "-is:"])
        #expect(exclude[0].label == "-tag: · Leave out cards with a tag")

        let or = try #require(SearchTokens.suggestions(for: "design o").first)
        #expect(or.kind == .hint)
        #expect(or.label == "OR · Either side matches")
        #expect(SearchTokens.applying(or, to: "design o") == "design OR ")
        #expect(SearchTokens.suggestions(for: "or").allSatisfy { $0.value != "OR " })

        let excludedType = try #require(SearchTokens.suggestions(for: "notes -type:ima").first)
        #expect(excludedType.value == "-type:image ")
        #expect(excludedType.label == "Leave out Image")
        #expect(SearchTokens.applying(excludedType, to: "notes -type:ima") == "notes -type:image ")
    }

    @Test func pickedValuesBecomeChipsOnlyWhenTheyAreTheWholeSearch() throws {
        let show = try #require(SearchTokens.suggestions(for: "is:arch").first)
        #expect(show.kind == .qualifier)
        #expect(show.value == "is:archived")
        // After other words a pick writes into the text, so the words stay.
        let typed = try #require(SearchTokens.suggestions(for: "design -type:quote type:ima").first)
        #expect(typed.kind == .hint)
        #expect(SearchTokens.applying(typed, to: "design -type:quote type:ima") == "design -type:quote type:image ")
        let todo = try #require(SearchTokens.suggestions(for: "design to").first { $0.label == "To do" })
        #expect(SearchTokens.applying(todo, to: "design to") == "design is:todo ")
        let joined = try #require(SearchTokens.suggestions(for: "tag:fonts OR type:ima").first)
        #expect(joined.kind == .hint)
        #expect(SearchTokens.applying(joined, to: "tag:fonts OR type:ima") == "tag:fonts OR type:image ")
        #expect(SearchTokens.suggestions(for: "ty").map(\.value) == ["type:"])
    }

    @Test func titlesAndEmptyStatesFollowTheQuery() {
        #expect(LibraryQuery(tokens: [SearchTokens.classify("retro")]).title == "Filtered")
        #expect(LibraryQuery(tokens: [SearchTokens.classify("favs")]).title == "Favorites")
        #expect(LibraryQuery(filters: LibraryFilters(trashOnly: true)).emptyState().title == "Trash is empty")
        #expect(LibraryQuery(text: "zebra").emptyState().title == "No results for \u{201C}zebra\u{201D}")
        #expect(LibraryQuery(text: "yesterday").emptyState(now: tuesdayNoon, timeZone: newYork).message == "No cards from that time.")
    }
}

@Suite(.english) struct CardGridTests {
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
        #expect(CardGrid.distribute([100.0, 100], columns: 2, gap: 0, reservedTopHeights: [150]) { $0 } == [[], [100, 100]],
                "a composer at the top of the first column pushes the first card right")
        #expect(CardGrid.distribute([100.0, 100, 100], columns: 2, gap: 0, reservedTopHeights: [150]) { $0 }.map(\.count) == [1, 2])
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

    /// Reference values from `getAudioWaveHeight("k17abc123", i)` in packages/convex/shared/audioWave.ts.
    @Test func drawsTheSameWaveformAsTheWeb() {
        let heights = CardGrid.waveformHeights(seed: "k17abc123")
        #expect(heights.count == 45)
        for (index, expected) in [(0, 36.131), (1, 67.497), (7, 42.315), (44, 55.251)] {
            #expect(abs(heights[index] * 60 + 20 - expected) < 0.01)
        }
    }
}

@Suite(.english) struct FolderChoiceTests {
    private let reading = Folder(id: "f1", name: "Reading list")
    private let recipes = Folder(id: "f2", name: "Recipes")
    private let links = Folder(id: "f3", name: "Links", kind: .smart, query: "type:link")

    @Test func offersOnlyManualFoldersInTheServersOrder() {
        #expect(FolderChoice.choosable([recipes, links, reading]).map(\.id) == ["f2", "f1"])
    }

    @Test func showsSearchOnlyWhenThereAreMoreThanEightManualFolders() {
        let eight = (1...8).map { Folder(id: "m\($0)", name: "Folder \($0)") }
        #expect(!FolderChoice.showsSearch(eight))
        #expect(!FolderChoice.showsSearch(eight + [links]))
        #expect(FolderChoice.showsSearch(eight + [reading]))
    }

    @Test func matchesNamesIgnoringCaseAndSpaces() {
        let folders = [reading, recipes, links]
        #expect(FolderChoice.matching(folders, query: "  ").map(\.id) == ["f1", "f2"])
        #expect(FolderChoice.matching(folders, query: " READ ").map(\.id) == ["f1"])
        #expect(FolderChoice.matching(folders, query: "link").isEmpty)
    }

    @Test func togglingAddsThenRemovesAFolder() {
        let picked = FolderChoice.toggling("f2", in: ["f1"])
        #expect(picked == ["f1", "f2"])
        #expect(FolderChoice.toggling("f1", in: picked) == ["f2"])
    }

    @Test func oneCardOnlyAddsWhatWasPicked() {
        // A link shared again keeps the folders it was already in.
        #expect(FolderChoice.change(selected: ["f1", "f2"], saved: [], cardCount: 1) == .update(add: ["f1", "f2"], remove: []))
        #expect(FolderChoice.change(selected: [], saved: ["f1"], cardCount: 1) == .update(add: [], remove: ["f1"]))
        #expect(FolderChoice.change(selected: ["f2", "f1"], saved: ["f1", "f2"], cardCount: 1) == .none)
    }

    @Test func severalCardsAddAndRemoveOnlyWhatChanged() {
        #expect(FolderChoice.change(selected: ["f1", "f2"], saved: [], cardCount: 3) == .update(add: ["f1", "f2"], remove: []))
        #expect(FolderChoice.change(selected: ["f2", "f3"], saved: ["f1", "f2"], cardCount: 3)
            == .update(add: ["f3"], remove: ["f1"]))
        #expect(FolderChoice.change(selected: ["f1"], saved: ["f1"], cardCount: 3) == .none)
        #expect(FolderChoice.change(selected: ["f1"], saved: [], cardCount: 0) == .none)
    }
}
