import Foundation
import Testing
@testable import TeakCore

private let cardId = "k57a3b9cd0e1f2g3h4j5m6n7p8q9r0s1"

private func summary(_ id: String = cardId, type: CardType = .link, title: String = "Card", previewText: String? = nil,
                     url: String? = nil, archived: Bool? = nil, created: Double = 1,
                     linkPreviewImageUrl: String? = nil) -> CardSummary {
    CardSummary(id: id, creationTime: created, type: type, title: title, previewText: previewText, url: url,
                linkPreviewImageUrl: linkPreviewImageUrl, isArchived: archived)
}

@Suite(.english) struct TeakLinkTests {
    @Test func readsTheAppsLinks() throws {
        #expect(TeakLink(try #require(URL(string: "teak://card/\(cardId)"))) == .card(cardId))
        #expect(TeakLink(try #require(URL(string: "teak://card/\(cardId)/"))) == .card(cardId))
        #expect(TeakLink(try #require(URL(string: "TEAK://new-note"))) == .newNote)
        #expect(TeakLink(try #require(URL(string: "teak://voice-memo"))) == .voiceMemo)
        #expect(TeakLink(try #require(URL(string: "teak://connect"))) == .connect)
        #expect(TeakLink(try #require(URL(string: "teak://save?text=hello+world"))) == .save("hello world"))
    }

    @Test(arguments: [
        "teak://card", "teak://card/", "teak://card/short", "teak://card/\(cardId.uppercased())",
        "teak://card/\(cardId)/extra", "teak://card/\(cardId)%20x", "teak://card/../\(cardId)",
        "teak://card/\(String(repeating: "a", count: 65))", "teak://new-note/x", "teak://voice-memo/x",
        "teak://unknown", "https://teakvault.com/card/\(cardId)",
    ])
    func ignoresBadLinks(_ link: String) throws {
        #expect(TeakLink(try #require(URL(string: link))) == nil)
    }

    @Test func writesLinksItReadsBack() {
        for link in [TeakLink.card(cardId), .newNote, .voiceMemo, .connect, .save("Café + 50% & more?")] {
            #expect(TeakLink(link.url) == link)
        }
        #expect(TeakLink.card(cardId).url.absoluteString == "teak://card/\(cardId)")
        #expect(TeakLink.newNote.url.absoluteString == "teak://new-note")
        #expect(TeakLink.voiceMemo.url.absoluteString == "teak://voice-memo")
    }
}

@Suite(.english) struct IndexedCardTests {
    @Test func titlesFallBackToThePreviewThenTheSiteThenTheType() {
        #expect(IndexedCard(summary(title: "Design notes"))?.title == "Design notes")
        #expect(IndexedCard(summary(title: "  ", previewText: "First line\nSecond line"))?.title == "First line")
        #expect(IndexedCard(summary(title: "", url: "https://www.example.com/a"))?.title == "example.com")
        #expect(IndexedCard(summary(type: .palette, title: ""))?.title == "Palette")
    }

    @Test func showsTheSiteThePreviewAndTheThumbnail() throws {
        let card = try #require(IndexedCard(summary(title: "Article", previewText: "  An intro  ",
                                                    url: "https://www.example.com/post",
                                                    linkPreviewImageUrl: "https://cdn.example.com/a.jpg?sig=1")))
        #expect(card.host == "example.com")
        #expect(card.previewText == "An intro")
        #expect(card.summary == "example.com — An intro")
        #expect(card.subtitle == "example.com")
        #expect(card.keywords == ["example.com", "Link"])
        #expect(card.thumbnailURL?.absoluteString == "https://cdn.example.com/a.jpg?sig=1")
    }

    @Test func dropsUnsafeAddresses() throws {
        let card = try #require(IndexedCard(summary(url: "javascript:alert(1)", linkPreviewImageUrl: "file:///etc/passwd")))
        #expect(card.url == nil)
        #expect(card.thumbnailURL == nil)
    }

    @Test func keepsOnlyThePreviewsStart() throws {
        let long = String(repeating: "word ", count: 200)
        let card = try #require(IndexedCard(Card(id: cardId, type: .text, content: long)))
        #expect(card.previewText?.count == 280)
    }

    @Test func leavesOutArchivedCardsUnlessAsked() {
        #expect(IndexedCard(summary(archived: true)) == nil)
        #expect(IndexedCard(summary(archived: true), includeArchived: true) != nil)
    }

    @Test func leavesOutTrashedArchivedAndHiddenCards() {
        #expect(IndexedCard(Card(id: cardId, type: .text, content: "Hi", isDeleted: true)) == nil)
        #expect(IndexedCard(Card(id: cardId, type: .text, content: "Hi", isArchived: true)) == nil)
        #expect(IndexedCard(Card(id: cardId, type: .text, content: "Hi", tags: ["work", "Secret"])) == nil)
        #expect(IndexedCard(Card(id: cardId, type: .text, content: "Hi", tags: [" Hidden "])) == nil)
        #expect(IndexedCard(Card(id: cardId, type: .text, content: "Hi", tags: ["work"], aiTags: ["secret"])) != nil)
    }

    @Test func titlesWholeCardsAsTheBackendDoes() {
        let preview = LinkPreview(status: "success", title: "Preview title")
        #expect(IndexedCard(Card(id: cardId, type: .link, url: "https://example.com", metadataTitle: "Typed",
                                 metadata: CardMetadata(linkPreview: preview), metadataTitleEdited: true))?.title == "Typed")
        #expect(IndexedCard(Card(id: cardId, type: .link, url: "https://example.com", metadataTitle: "Fetched",
                                 metadata: CardMetadata(linkPreview: preview)))?.title == "Preview title")
        #expect(IndexedCard(Card(id: cardId, type: .link, url: "https://www.example.com/x"))?.title == "example.com")
        #expect(IndexedCard(Card(id: cardId, type: .text,
                                 content: "See [[Plan|teak:\(cardId)]] today\nmore"))?.title == "See Plan today")
        #expect(IndexedCard(Card(id: cardId, type: .audio, content: "ignored", aiTranscript: "Spoken words"))?
            .previewText == "Spoken words")
        #expect(IndexedCard(Card(id: cardId, type: .image))?.title == "Image")
    }

    @Test func fingerprintsIgnoreSignedThumbnailQueries() throws {
        let first = try #require(IndexedCard(summary(linkPreviewImageUrl: "https://cdn.example.com/a.jpg?sig=1")))
        let second = try #require(IndexedCard(summary(linkPreviewImageUrl: "https://cdn.example.com/a.jpg?sig=2")))
        let renamed = try #require(IndexedCard(summary(title: "Renamed", linkPreviewImageUrl: "https://cdn.example.com/a.jpg")))
        #expect(first.fingerprint == second.fingerprint)
        #expect(first.fingerprint != renamed.fingerprint)
    }
}

@Suite(.english) struct CardIndexTests {
    @Test(arguments: [
        ("#secret", true), ("#Hidden", true), ("tag:secret", true), ("TAG:hidden,", true),
        ("(#secret OR design)", true), ("-#secret", true), ("design #\"secret\"", true),
        ("secret", false), ("#secrets", false), ("design is:archived", false), ("", false),
    ])
    func findsSearchesThatRevealHiddenCards(search: String, reveals: Bool) {
        #expect(CardIndex.revealsHidden(search) == reveals)
    }

    @Test func sendsTheSearchAsTyped() {
        let args = CardIndex.searchArgs("type:link  #design")
        #expect(args["searchQuery"] == .string("type:link  #design"))
        #expect(args["showArchivedOnly"] == nil)
        #expect(args["paginationOpts"] == ["numItems": .number(20), "cursor": .null])
        #expect(CardIndex.searchArgs("  ")["searchQuery"] == nil)
        #expect(CardIndex.searchArgs("x", archivedOnly: true)["showArchivedOnly"] == true)
    }

    @Test func searchResultsAddArchivedCardsOnlyWhenAsked() {
        let active = (0..<15).map { summary("active\($0)padding000", title: "A\($0)") }
        let archived = (0..<10).map { summary("archived\($0)padding00", title: "B\($0)", archived: true) }
        #expect(CardIndex.results(active, archived: archived).map(\.title) == active.map(\.title))
        let both = CardIndex.results(active, archived: archived, includeArchived: true)
        #expect(both.count == 20)
        #expect(both.last?.title == "B4")
        // An `is:archived` search lists archived cards in the main read too.
        #expect(CardIndex.results(archived).isEmpty)
    }

    @Test func libraryViewsIndexWhatTheyShow() {
        let cards = [summary("one0000000000000"), summary("two0000000000000", archived: true)]
        let home = CardIndex.changes(cards, left: ["gone000000000000"], in: LibraryQuery())
        #expect(home.index.map(\.id) == ["one0000000000000"])
        #expect(home.remove == ["two0000000000000", "gone000000000000"])

        let trash = CardIndex.changes(cards, left: ["gone000000000000"], in: LibraryQuery(filters: LibraryFilters(trashOnly: true)))
        #expect(trash == CardIndex.Changes(remove: ["one0000000000000", "two0000000000000"]))

        let hidden = CardIndex.changes(cards, in: LibraryQuery(text: "#secret"))
        #expect(hidden == CardIndex.Changes(remove: ["two0000000000000"]))
        let smart = FolderScope(id: "f", name: "Private", isSmart: true, query: "tag:hidden")
        #expect(CardIndex.changes(cards, in: LibraryQuery(filters: LibraryFilters(folder: smart))).index.isEmpty)
    }

    @Test func onlyThePlainLibraryRemovesCardsThatLeft() {
        let cards = [summary("one0000000000000")]
        let left = ["gone000000000000"]
        #expect(CardIndex.changes(cards, left: left, in: LibraryQuery(text: "design")).remove.isEmpty)
        #expect(CardIndex.changes(cards, left: left, in: LibraryQuery(sort: .oldest)).remove.isEmpty)
        #expect(CardIndex.changes(cards, left: left, in: LibraryQuery(filters: LibraryFilters(favoritesOnly: true))).remove.isEmpty)
        // A view that empties at once is more likely a signed-out read.
        #expect(CardIndex.changes([], left: left, in: LibraryQuery()).remove.isEmpty)
    }

    @Test func refreshesPruneOnlyWhatTheyCover() throws {
        let newest = try [summary("new1000000000000", created: 300), summary("new2000000000000", created: 200)]
            .map { try #require(IndexedCard($0)) }
        let indexed = ["new1000000000000": 300.0, "trashed000000000": 250, "older00000000000": 100]
        // A partial read can't tell which older cards it covered, so it drops none.
        #expect(CardIndex.stale(indexed: indexed, newest: newest, complete: false).isEmpty)
        #expect(CardIndex.stale(indexed: indexed, newest: newest, complete: true) == ["older00000000000", "trashed000000000"])
        // A finished read of an empty library drops everything; an unfinished one drops nothing.
        #expect(CardIndex.stale(indexed: indexed, newest: [], complete: true) == indexed.keys.sorted())
        #expect(CardIndex.stale(indexed: indexed, newest: [], complete: false).isEmpty)
    }
}
