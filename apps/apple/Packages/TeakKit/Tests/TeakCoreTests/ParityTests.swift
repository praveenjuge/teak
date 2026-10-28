import Foundation
import Testing
@testable import TeakCore

// Tables mirror the TypeScript tests in packages/convex/__tests__/shared/
// (and apps/web/src/lib/__tests__/ for EXIF and publish dates), so the
// Apple, Android and web surfaces agree. Keep the rows in step with them.

private let idA = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b"
private let idB = "k27a8m9x2p3q4r5s6t7u8v9w0y1z2a3b"

@Suite(.english) struct CardLinksTests {
    @Test(arguments: [
        ("one link", "See [[Plan|teak:\(idA)]].", [idA]),
        ("order kept, duplicates dropped", "[[B|teak:\(idB)]] then [[A|teak:\(idA)]] and [[B again|teak:\(idB)]]", [idB, idA]),
        ("an empty title", "[[|teak:\(idA)]]", [idA]),
        ("inline code", "`[[Plan|teak:\(idA)]]`", []),
        ("double-backtick code", "`` a [[Plan|teak:\(idA)]] ``", []),
        ("a fenced block", "```\n[[Plan|teak:\(idA)]]\n```\n[[B|teak:\(idB)]]", [idB]),
        ("a tilde fence", "~~~md\n[[Plan|teak:\(idA)]]\n~~~", []),
        ("a fence line with an info string inside a block", "```\n```js\n[[Plan|teak:\(idA)]]\n```", []),
        ("an indented block", "Intro\n\n    [[Plan|teak:\(idA)]]", []),
        ("a list item's indented paragraph", "- Item\n\n    [[Plan|teak:\(idA)]]", [idA]),
        ("an ordered item's indented continuation", "1. Item\n    [[Plan|teak:\(idA)]]", [idA]),
        ("a nested item's indented paragraph", "- Outer\n    - Inner\n\n      [[Plan|teak:\(idA)]]", [idA]),
        ("an indented block inside a list item", "- Item\n\n      [[Plan|teak:\(idA)]]", []),
        ("an indented block after a list ends", "- Item\n\nParagraph\n\n    [[Plan|teak:\(idA)]]", []),
        ("an unclosed backtick", "`oops [[Plan|teak:\(idA)]]", [idA]),
        ("no id", "[[x|teak:]]", []),
        ("no prefix", "[[x]]", []),
        ("an uppercase id", "[[x|teak:K17A8M9X2P3Q4R5S]]", []),
        ("a too-short id", "[[x|teak:abc]]", []),
        ("a pipe in the title", "[[a|b|teak:\(idA)]]", []),
        ("a newline in the title", "[[a\nb|teak:\(idA)]]", []),
    ])
    func parsesLinkedIds(_ name: String, markdown: String, ids: [String]) {
        #expect(CardLinks.parseIds(markdown) == ids, "\(name)")
    }

    @Test func indexesAtMost500DistinctTargets() {
        let pad = { (index: Int) in String(repeating: "a", count: 16 - String(index).count) + String(index) }
        let tokens = (0..<501).map { "[[n|teak:\(pad($0))]]" }.joined(separator: " ")
        let ids = CardLinks.parseIds(tokens)
        #expect(ids.count == CardLinks.maxLinks)
        #expect(ids.last == pad(499))
        #expect(CardLinks.parseIds(nil).isEmpty)
    }

    @Test func readsALongLineOfCodeSpansInLinearTime() {
        // 400 KB of backticks on one line: masking its code spans used to take
        // tens of seconds, past any function's time limit.
        let spans = String(repeating: "`a` ", count: 50_000)
        let unclosed = String(repeating: "``a ", count: 50_000)
        let markdown = "\(spans)[[Plan|teak:\(idA)]] \(unclosed)`[[B|teak:\(idB)]]`"
        var ids: [String] = []
        let elapsed = ContinuousClock().measure { ids = CardLinks.parseIds(markdown) }
        #expect(ids == [idA])
        #expect(elapsed < .seconds(1))
    }

    @Test func formattingReplacesCharactersTheGrammarCantHold() {
        #expect(CardLinks.formatToken(title: "a | b ]] c\nd", id: idA) == "[[a b c d|teak:\(idA)]]")
        #expect(CardLinks.formatToken(title: "   ", id: idA) == "[[Card|teak:\(idA)]]")
        #expect(CardLinks.formatToken(title: "Reading list", id: idA) == "[[Reading list|teak:\(idA)]]")
    }

    @Test(arguments: [
        String(repeating: "a", count: 300), String(repeating: "b", count: 512),
        String(repeating: "c", count: 198) + "👩‍👩‍👧‍👦👩‍👩‍👧‍👦", String(repeating: "漢字", count: 150),
        String(repeating: "שלום ", count: 80),
    ])
    func longTitlesReadBackWithTheSameId(title: String) throws {
        let token = CardLinks.formatToken(title: title, id: idA)
        let match = try #require(CardLinks.matches("x \(token) y").first)
        #expect(match.id == idA)
        #expect(match.title.utf16.count <= CardLinks.titleMaxLength)
        #expect(!match.title.hasSuffix("\u{200D}\u{2026}"))
    }

    private static let family = "👩‍👩‍👧‍👦"
    private static func c(_ count: Int) -> String { String(repeating: "c", count: count) }
    private static let cuts: [(String, String, String)] = [
        ("kept whole", c(185) + family + String(repeating: "d", count: 30), c(185) + family + "ddd…"),
        ("dropped whole", c(190) + family + String(repeating: "d", count: 30), c(190) + "…"),
        ("not split at a surrogate", c(198) + "😀😀", c(198) + "…"),
    ]

    @Test(arguments: cuts)
    func anEmojiAtTheCut(_ name: String, title: String, expected: String) {
        let stored = CardLinks.matches(CardLinks.formatToken(title: title, id: idA)).first?.title
        #expect(stored == expected, "\(name)")
    }

    @Test func showsEachLinkAsItsStoredTitleLeavingCodeAlone() {
        #expect(CardLinks.tokensToText("Read [[Plan|teak:\(idA)]] and `[[Raw|teak:\(idB)]]`")
            == "Read Plan and `[[Raw|teak:\(idB)]]`")
        #expect(CardLinks.tokensToText("See [[Use `foo`|teak:\(idA)]].") == "See Use `foo`.")
        #expect(CardLinks.tokensToText("plain [[x]] text") == "plain [[x]] text")
    }

    @Test func passesTheTitleAndIdToTheReplacer() {
        var seen: [String] = []
        let result = CardLinks.replaceTokens("[[A|teak:\(idA)]]-[[B|teak:\(idB)]]") { title, id in
            seen.append("\(title):\(id)")
            return title.lowercased()
        }
        #expect(result == "a-b")
        #expect(seen == ["A:\(idA)", "B:\(idB)"])
    }
}

@Suite(.english) struct SearchQualifierTests {
    private static let rows: [(String, String, [String])] = [
        ("#Design", "tags", ["design"]), ("TAG:Design", "tags", ["design"]),
        ("tag:\"Design Systems\"", "tags", ["design systems"]), ("#fff", "tags", []), ("#fff", "terms", ["#fff"]),
        ("#3B82F6,", "terms", ["#3B82F6,"]), ("#bad", "terms", ["#bad"]), ("tag:bad", "tags", ["bad"]),
        ("#design-ops", "tags", ["design-ops"]), ("#", "terms", []), ("type:links", "types", ["link"]),
        ("Type:IMAGE", "types", ["image"]), ("type:banana", "terms", ["type:banana"]), ("type:", "terms", []),
        ("folder:\"Reading list\"", "folders", ["reading list"]), ("folder:Inbox,", "folders", ["inbox"]),
        ("foo:bar", "terms", ["foo:bar"]), ("https://github.com", "terms", ["https://github.com"]),
        ("\"unbalanced phrase", "phrases", ["unbalanced phrase"]), ("“smart quotes”", "phrases", ["smart quotes"]),
        ("\"\"", "phrases", []), ("tag:a tag:A #a", "tags", ["a"]), ("🎨 #🎨", "tags", ["🎨"]),
        ("text:4411", "ocrTexts", ["4411"]), ("TEXT:\"Total  Due\"", "ocrTexts", ["Total Due"]),
        ("text:Total text:total", "ocrTexts", ["Total"]), ("text:a text:b", "ocrTexts", ["a", "b"]),
        ("text:", "terms", []), ("text:\"  \"", "ocrTexts", []), ("text:東京駅", "ocrTexts", ["東京駅"]),
        ("is:nope", "terms", ["is:nope"]), ("site:www.GitHub.com/path", "sites", ["github.com"]),
        ("site:https://gitlab.com:8443", "sites", ["gitlab.com"]), ("site:mailto:x", "terms", ["site:mailto:x"]),
    ]

    private static func field(_ parsed: ParsedSearchQuery, _ name: String) -> [String] {
        switch name {
        case "tags": parsed.tags
        case "types": parsed.types.map(\.rawValue)
        case "folders": parsed.folders
        case "phrases": parsed.phrases
        case "ocrTexts": parsed.ocrTexts
        case "sites": parsed.sites
        default: parsed.terms
        }
    }

    @Test(arguments: rows)
    func readsQualifiers(input: String, field: String, expected: [String]) {
        #expect(Self.field(SearchQualifiers.parse(input), field) == expected, "\(input) → \(field)")
    }

    @Test(arguments: [
        ("is:fav", SearchIsValue.fav), ("is:favourites", .fav), ("is:starred", .fav), ("is:archived", .archived),
        ("is:done", .done), ("is:Completed", .done), ("is:finished", .done), ("is:todo", .todo), ("is:to-do", .todo),
    ])
    func readsShowQualifiers(input: String, value: SearchIsValue) {
        #expect(SearchQualifiers.parse(input).has(value))
    }

    @Test func readsEveryQualifierPhraseAndWord() {
        let parsed = SearchQualifiers.parse("tag:design type:link \"design system\" notes")
        #expect(parsed.tags == ["design"])
        #expect(parsed.types == [.link])
        #expect(parsed.phrases == ["design system"])
        #expect(parsed.terms == ["notes"])
        #expect(parsed.text == "notes design system")
        #expect(parsed.canonical == "tag:design type:link \"design system\" notes")
    }

    @Test func quotedValuesKeepEscapedQuotesAndRoundTrip() {
        let parsed = SearchQualifiers.parse(#"folder:"Say \"hi\" now" tag:x"#)
        #expect(parsed.qualifiers == [SearchQualifier(.folder, #"Say "hi" now"#), SearchQualifier(.tag, "x")])
        #expect(parsed.canonical == #"folder:"Say \"hi\" now" tag:x"#)
        #expect(SearchQualifiers.parse(parsed.canonical).qualifiers == parsed.qualifiers)
    }

    @Test(arguments: [#"A\B"#, #"Say "hi""#, "<b>Not bold</b> & “quoted”", #"trailing\"#, "Ideas!", "[Inbox]", "(notes)"])
    func folderNamesRoundTripThroughTheirChip(name: String) {
        let chip = SearchQualifiers.format(SearchQualifier(.folder, name))
        #expect(SearchQualifiers.parse(chip).qualifiers == [SearchQualifier(.folder, name)])
    }

    @Test(arguments: [".net", "c++,", "ok?"])
    func tagsRoundTripThroughTheirChip(tag: String) {
        #expect(SearchQualifiers.parse(SearchQualifiers.format(SearchQualifier(.tag, tag))).tags == [tag])
    }

    @Test func plainValuesStayUnquoted() {
        #expect(SearchQualifiers.format(SearchQualifier(.tag, "design")) == "tag:design")
        #expect(SearchQualifiers.format(SearchQualifier(.folder, "c++")) == "folder:c++")
        #expect(SearchQualifiers.format(SearchQualifier(.text, #"say "hi""#)) == #"text:"say \"hi\"""#)
    }

    @Test func aPhraseWithQuotesRoundTrips() {
        let parsed = SearchQualifiers.parse(#""say \"hi\" there""#)
        #expect(parsed.phrases == [#"say "hi" there"#])
        #expect(SearchQualifiers.parse(parsed.canonical).phrases == parsed.phrases)
    }

    @Test(arguments: [
        ("price:<100", [PriceBound(.lessThan, 100)], "price:<100"),
        ("PRICE:>20", [PriceBound(.greaterThan, 20)], "price:>20"),
        ("price:<=9.99", [PriceBound(.atMost, 9.99)], "price:<=9.99"),
        ("price:>=010.50", [PriceBound(.atLeast, 10.5)], "price:>=10.5"),
        ("price:=0", [PriceBound(.equal, 0)], "price:=0"),
        ("price:\"<50\"", [PriceBound(.lessThan, 50)], "price:<50"),
        ("price:<50,", [PriceBound(.lessThan, 50)], "price:<50"),
        ("price:>20 price:<100 price:>20", [PriceBound(.greaterThan, 20), PriceBound(.lessThan, 100)], "price:>20 price:<100"),
    ])
    func readsPriceBounds(input: String, prices: [PriceBound], canonical: String) {
        let parsed = SearchQualifiers.parse(input)
        #expect(parsed.prices == prices)
        #expect(parsed.terms.isEmpty)
        #expect(parsed.canonical == canonical)
        #expect(SearchQualifiers.parse(parsed.canonical).prices == prices)
    }

    @Test(arguments: ["price:abc", "price:<", "price:<1e9", "price:<-5", "price:100", "price:<$50", "price:<1,000", "price:=<5"])
    func badPriceBoundsStayPlainWords(input: String) {
        let parsed = SearchQualifiers.parse(input)
        #expect(parsed.qualifiers.isEmpty)
        #expect(parsed.terms == [input])
    }

    @Test(arguments: [
        ("price:<100", "Under 100"), ("price:>1500", "Over 1,500"), ("price:<=9.99", "9.99 or less"),
        ("price:>=10", "10 or more"), ("price:=0", "Exactly 0"),
    ])
    func describesPriceBounds(query: String, label: String) throws {
        let bound = try #require(SearchQualifiers.parse(query).prices.first)
        #expect(SearchQualifiers.describePriceBound(bound) == label)
    }

    @Test func textKeepsItsCaseAndQuotesInTheCanonicalForm() {
        #expect(SearchQualifiers.parse(#"receipt text:"Total due" text:4411"#).canonical == #"text:"Total due" text:4411 receipt"#)
    }

    @Test func likeAndMoodKeepOneAnchor() {
        let id = "j979t50bv7gjxz2mazwwf5tes18gbvnt"
        let other = "j97a1vaafgzkxkzag6rb6wt0gs8gbq0x"
        let like = SearchQualifiers.parse("like:\(id) type:link")
        #expect(like.likeCardId == id)
        #expect(like.terms.isEmpty)
        #expect(like.canonical == "like:\(id) type:link")
        let mood = SearchQualifiers.parse(#"MOOD:"moody   brutalist" #design"#)
        #expect(mood.mood == "moody brutalist")
        #expect(mood.canonical == #"mood:"moody brutalist" tag:design"#)
        #expect(SearchQualifiers.parse("like:not-a-card").terms == ["like:not-a-card"])
        #expect(SearchQualifiers.parse("like:\(id) like:\(other)").terms == ["like:\(other)"])
        #expect(SearchQualifiers.parse("like:\(id) mood:calm").terms == ["mood:calm"])
        #expect(SearchQualifiers.parse("like:\(id) like:\(id)").terms.isEmpty)
        #expect(SearchQualifiers.parse("mood:Calm mood:calm").terms.isEmpty)
    }

    @Test func doneAndTodoWriteTheOneCanonicalWay() {
        #expect(SearchQualifiers.parse("IS:Finished is:TO-DO lamp").canonical == "is:done is:todo lamp")
    }

    @Test(arguments: [
        ("design -figma", true), ("tag:fonts OR tag:type", true), ("(a b)", true), ("-\"a b\"", true), ("x OR", true),
        ("to-do 2024-06-05", false), ("a - b", false), ("tag:fonts or tag:type", false), ("\"a OR (b)\"", false),
        ("site:github.com", false), ("ORANGE", false),
    ])
    func findsOperators(text: String, expected: Bool) {
        #expect(SearchQualifiers.hasOperators(text) == expected)
    }

    @Test func anEmptySearchParsesToNothing() {
        let parsed = SearchQualifiers.parse("   ")
        #expect(parsed.qualifiers.isEmpty && parsed.terms.isEmpty && parsed.phrases.isEmpty)
        #expect(parsed.canonical.isEmpty)
    }

    @Test(arguments: [
        (SearchQualifier(.is, "archived"), "Show", "Archived"), (SearchQualifier(.is, "todo"), "Show", "To do"),
        (SearchQualifier(.mood, "moody brutalist"), "Mood", "“moody brutalist”"),
        (SearchQualifier(.price, "<100"), "Price", "Under 100"), (SearchQualifier(.text, "4411"), "Text in image", "4411"),
        (SearchQualifier(.like, "j979t50bv7gjxz2mazwwf5tes18gbvnt"), "Similar to", "a card"),
        (SearchQualifier(.type, "link"), "Type", "Link"),
    ])
    func chipsReadLikeTheWeb(qualifier: SearchQualifier, title: String, label: String) {
        let chip = SearchQualifiers.chip(qualifier)
        #expect(chip.title == title)
        #expect(chip.label == label)
    }
}

@Suite(.english) struct LinkFactsTests {
    @Test(arguments: [
        ("movie", "watched"), ("game", "played"), ("product", "bought"), ("article", "read"),
        ("a-category-from-the-future", "done"), (nil, "done"), ("", "done"),
    ] as [(String?, String)])
    func picksTheDoneVerb(category: String?, verb: String) {
        #expect(LinkDone.verb(category) == verb)
    }

    @Test func keepsEveryDoneLabelWithin16Characters() {
        for category in SharedConstants.shared.linkCategoryDoneVerbs.keys {
            #expect(LinkDone.markLabel(category).count <= 16)
        }
    }

    /// Android's LinkStateTest checks the same: a new verb needs its own catalog keys.
    @Test func everyDoneVerbHasItsOwnSentences() throws {
        for verb in Set(SharedConstants.shared.linkCategoryDoneVerbs.values) {
            let words = try #require(LinkDone.words(verb: verb), "no sentences for \(verb)")
            for text in [words.markAs, words.markAsNot, words.state, words.markedAs, words.markedAsNot] {
                #expect(!text.hasPrefix("native."), "\(verb) is missing \(text)")
            }
        }
        #expect(LinkDone.unmarkLabel("movie") == "Mark as not watched")
    }

    @Test func labelsTheToggleAndItsToast() {
        #expect(LinkDone.markLabel("book") == "Mark as read")
        #expect(LinkDone.doneLabel("movie") == "Watched")
        #expect(LinkDone.markLabel("repo") == "Mark as done")
        #expect(LinkDone.toast("podcast", done: true) == "Marked as listened")
        #expect(LinkDone.toast("podcast", done: false) == "Marked as not listened")
        #expect(LinkDone.isActionable("movie"))
        #expect(!LinkDone.isActionable("repo"))
        #expect(!LinkDone.isActionable(nil))
    }

    @Test(arguments: [
        (LinkPrice(amount: 24.99, currency: "USD"), "$24.99"), (LinkPrice(amount: 1299, currency: "EUR"), "€1,299.00"),
        (LinkPrice(amount: 1_299_999, currency: "JPY"), "¥1,299,999"), (LinkPrice(amount: 0, currency: "USD"), "Free"),
        (LinkPrice(amount: 12.5), "12.5"), (LinkPrice(amount: 12, currency: "ZZZZ"), "12"),
    ])
    func writesPrices(price: LinkPrice, label: String) {
        #expect(price.formatted(locale: Locale(identifier: "en_US")) == label)
    }

    @Test func listsAFullPhotosFactsInReadingOrder() throws {
        let rows = ExifFacts.rows(ImageExif(exposureTime: 1 / 250, fNumber: 1.8, focalLength: 50, iso: 400, make: "Canon",
                                            model: "Canon EOS R5", takenAtClock: 1_779_008_405_000))
        #expect(rows.map(\.label) == ["Camera", "Taken", "Exposure", "Aperture", "Focal length", "ISO"])
        #expect(rows.map(\.value) == ["Canon EOS R5", "May 17, 2026, 09:00 AM", "1/250 s", "f/1.8", "50 mm", "400"])
    }

    /// `takenAtClock` is the camera's clock time encoded as UTC, so the viewer's zone never moves it.
    @Test func showsTheCamerasClockTimeAndItsOffset() {
        let losAngeles = TimeZone(identifier: "America/Los_Angeles")!
        func taken(_ clock: Double, _ offset: Double? = nil) -> String? {
            ExifFacts.rows(ImageExif(takenAtClock: clock, takenAtOffset: offset), timeZone: losAngeles).first?.value
        }
        let nine = 1_779_008_400_000.0 // 2026-05-17T09:00:00Z
        #expect(taken(1_778_977_800_000) == "May 17, 2026, 12:30 AM")
        #expect(taken(1_779_061_500_000) == "May 17, 2026, 11:45 PM")
        #expect(taken(nine, 330) == "May 17, 2026, 09:00 AM UTC+5:30")
        #expect(taken(nine, -480) == "May 17, 2026, 09:00 AM UTC-8")
        #expect(taken(nine, -570) == "May 17, 2026, 09:00 AM UTC-9:30")
        #expect(taken(nine, 0) == "May 17, 2026, 09:00 AM UTC")
        for bad in [Double.nan, 5.5, 900, -900] {
            #expect(taken(nine, bad) == "May 17, 2026, 09:00 AM")
        }
        // The clock time wins over the instant released apps read; photos without it read as before.
        #expect(ExifFacts.rows(ImageExif(takenAt: 1_778_988_600_000, takenAtClock: nine, takenAtOffset: 330),
                               timeZone: losAngeles).first?.value == "May 17, 2026, 09:00 AM UTC+5:30")
        #expect(ExifFacts.rows(ImageExif(takenAt: nine), timeZone: losAngeles).first?.value == "May 17, 2026, 02:00 AM")
    }

    @Test func neverShowsGPSAndDropsBadNumbers() {
        #expect(ExifFacts.rows(ImageExif(latitude: 48.8584, longitude: 2.2945)).isEmpty)
        #expect(ExifFacts.rows(nil).isEmpty)
        #expect(ExifFacts.rows(ImageExif(exposureTime: 0, fNumber: -2, focalLength: .nan, iso: .infinity)).isEmpty)
        #expect(ExifFacts.rows(ImageExif(make: "   ", model: "")).isEmpty)
        #expect(ExifFacts.rows(ImageExif(fNumber: 8, focalLength: 23.99)) == [DetailRow("Aperture", "f/8"), DetailRow("Focal length", "24 mm")])
    }

    @Test(arguments: [
        ("Apple", "iPhone 17 Pro", "Apple iPhone 17 Pro"), ("Canon", "Canon EOS R5", "Canon EOS R5"),
        ("NIKON CORPORATION", "NIKON Z 8", "NIKON Z 8"), ("  FUJIFILM ", "  X-T5  ", "FUJIFILM X-T5"),
        ("Sony", nil, "Sony"), (nil, "Pixel 9", "Pixel 9"),
    ] as [(String?, String?, String)])
    func namesTheCamera(make: String?, model: String?, expected: String) {
        #expect(ExifFacts.camera(make: make, model: model) == expected)
        #expect(ExifFacts.camera(make: nil, model: " ") == nil)
    }

    @Test(arguments: [
        (1.0 / 4000, "1/4000 s"), (1.0 / 60, "1/60 s"), (1.0 / 4, "1/4 s"), (0.3, "0.3 s"), (1.0 / 3, "0.3 s"),
        (0.4, "0.4 s"), (0.6, "0.6 s"), (0.8, "0.8 s"), (1, "1 s"), (2.5, "2.5 s"), (30, "30 s"),
    ] as [(Double, String)])
    func writesExposureTimes(seconds: Double, expected: String) {
        #expect(ExifFacts.exposure(seconds) == expected)
    }

    @Test(arguments: [
        ("2024-03-05", "Mar 5, 2024"), ("2024-03-05T23:30:00-05:00", "Mar 6, 2024"),
        ("Tue, 05 Mar 2024 10:00:00 GMT", "Mar 5, 2024"),
    ])
    func formatsPublishDates(value: String, expected: String) {
        let now = Date(timeIntervalSince1970: 1_791_806_400) // Oct 12, 2026, 12:00 UTC
        #expect(PublishedDate.format(value, now: now) == expected)
    }

    @Test(arguments: ["not a date", "", "1970-01-01T00:00:00Z", "2026-10-20"])
    func dropsUnusablePublishDates(value: String) {
        let now = Date(timeIntervalSince1970: 1_791_806_400)
        #expect(PublishedDate.format(value, now: now) == nil)
    }
}

@Suite(.english) struct TagRulesTests {
    @Test(arguments: [
        (["secret"], true), (["Secret"], true), ([" HIDDEN "], true), (["work", "  hidden"], true),
        (["secrets", "hidden-ish", "hide"], false), ([], false),
    ])
    func hiddenTagsHideACard(tags: [String], hidden: Bool) {
        #expect(HiddenTags.isHiddenTagList(tags) == hidden)
    }

    @Test func hintsOnlyWhenAnEditHidesTheCard() {
        #expect(HiddenTags.addedHint(before: ["work"], after: ["work", "Secret"]) == "Hidden. Search #secret to see it.")
        #expect(HiddenTags.addedHint(before: ["hidden"], after: ["hidden", "secret"]) == nil)
        #expect(HiddenTags.addedHint(before: nil, after: ["work"]) == nil)
        #expect(HiddenTags.emptyViewHint == "Some cards are hidden. Search #secret or #hidden to see them.")
    }

    @Test func tagNamesMustBeNonEmptyAndAtMost64Characters() {
        #expect(TagOperations.invalidName(" ") == "Name the tag")
        #expect(TagOperations.invalidName(String(repeating: "x", count: 64)) == nil)
        #expect(TagOperations.invalidName(String(repeating: "x", count: 65)) == "Tags can be at most 64 characters")
    }

    @Test func describesTagOperations() {
        #expect(TagOperations.running(.merge, from: "ux", to: "research") == "Merging “ux” into “research”…")
        #expect(TagOperations.progress(changed: 12, total: 10) == "10 of 10 cards changed")
        #expect(TagOperations.failed(.delete, changed: 1, total: 1) == "Couldn't finish deleting. 1 of 1 card changed.")
    }

    @Test func aFinishedChangeRewritesTheTagListUntilTheSummaryCatchesUp() {
        let items = [TagSummary.Item(name: "design", count: 5), TagSummary.Item(name: "UX", count: 3),
                     TagSummary.Item(name: "web", count: 1)]
        #expect(TagOperations.applying(.rename, from: "Design", to: "systems", to: items).map(\.name) == ["systems", "UX", "web"])
        #expect(TagOperations.applying(.merge, from: "web", to: "ux", to: items)
            == [TagSummary.Item(name: "design", count: 5), TagSummary.Item(name: "UX", count: 4)])
        #expect(TagOperations.applying(.delete, from: "ux", to: nil, to: items).map(\.name) == ["design", "web"])
        #expect(TagOperations.applying(.delete, from: "missing", to: nil, to: items) == items)
    }

    @Test func bulkMessagesCountWhatChanged() {
        #expect(BulkCardAction.archive.message(updated: 1, failed: 0) == "Archived 1 card")
        #expect(BulkCardAction.unarchive.message(updated: 3, failed: 0) == "Returned 3 cards to the library")
        #expect(BulkCardAction.addToFolder.message(updated: 2, failed: 1, folder: "Inbox") == "Added 2 cards to Inbox. 1 couldn't be changed.")
        #expect(BulkCardAction.delete.message(updated: 0, failed: 2) == "Couldn't move these cards to Trash")
        #expect(BulkCardAction.chunks((0..<250).map(String.init)).map(\.count) == [100, 100, 50])
    }

    @Test func aNewShuffleSeedNeverRepeatsTheLastOne() {
        #expect(ShuffleSeed.next(after: 7, random: { 7 }) == 8)
        #expect(ShuffleSeed.next(after: ShuffleSeed.limit - 1, random: { ShuffleSeed.limit - 1 }) == 0)
        #expect(ShuffleSeed.next(after: 7, random: { 3 }) == 3)
    }
}
