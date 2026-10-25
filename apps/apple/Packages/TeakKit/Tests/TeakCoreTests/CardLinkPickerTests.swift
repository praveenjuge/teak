import Foundation
import Testing
@testable import TeakCore

// The `[[` picker's rules. Android's CardLinkPickerTest has the same rows:
// keep them in step. `^` marks the cursor.

private let linkId = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b"

private func split(_ marked: String) -> (text: String, cursor: Int) {
    let parts = marked.components(separatedBy: "^")
    return (parts.joined(), parts[0].utf16.count)
}

@Suite(.english) struct CardLinkPickerTests {
    @Test(arguments: [
        ("just typed", "See [[^", "", 4),
        ("a query", "See [[road map^", "road map", 4),
        ("spaces around the query", "[[  plan ^", "plan", 0),
        ("the cursor mid-query", "[[pla^n", "pla", 0),
        ("the last [[ on the line", "[[a]] then [[b^", "b", 11),
        ("a third bracket", "[[[x^", "x", 1),
        ("after a finished link", "[[Plan|teak:\(linkId)]] and [[ne^", "ne", 51),
        ("a later line", "First\n- [[ta^", "ta", 8),
        ("a single bracket inside", "[[a[b^", "a[b", 0),
        ("emoji before it", "👩‍👩‍👧‍👦 [[x^", "x", 12),
    ] as [(String, String, String, Int)])
    func opensForATyped(_ name: String, marked: String, query: String, start: Int) {
        let (text, cursor) = split(marked)
        #expect(CardLinks.openQuery(in: text, cursor: cursor) == .init(start: start, end: cursor, query: query), "\(name)")
    }

    @Test(arguments: [
        ("no brackets", "plain text^"),
        ("one bracket", "[^"),
        ("closed", "[[Plan]]^"),
        ("a closing bracket typed", "[[Plan]^"),
        ("a pipe typed", "[[Plan|^"),
        ("on an earlier line", "[[Plan\nnext^"),
        ("inside inline code", "`[[co^de`"),
        ("inside a fenced block", "```\n[[co^\n```"),
        ("in a table row", "| a | [[b^ |"),
        ("inside a finished link", "[[Pl^an|teak:\(linkId)]]"),
        ("the cursor before the brackets", "^[[Plan"),
        ("past the title limit", "[[" + String(repeating: "a", count: 201) + "^"),
    ])
    func staysClosedFor(_ name: String, marked: String) {
        let (text, cursor) = split(marked)
        #expect(CardLinks.openQuery(in: text, cursor: cursor) == nil, "\(name)")
    }

    @Test func staysClosedForACursorOutsideTheText() {
        #expect(CardLinks.openQuery(in: "[[a", cursor: 9) == nil)
        #expect(CardLinks.openQuery(in: "[[a", cursor: -1) == nil)
    }

    @Test(arguments: [
        ("at the end", "See [[road^", "Road map", "See [[Road map|teak:\(linkId)]] ^"),
        ("before text", "See [[ro^ today", "Road map", "See [[Road map|teak:\(linkId)]]^ today"),
        ("before a new line", "[[ro^\nNext", "Road map", "[[Road map|teak:\(linkId)]]^\nNext"),
        ("before a word", "[[ro^ad", "Road map", "[[Road map|teak:\(linkId)]] ^ad"),
        ("a title the grammar can't hold", "[[x^", "a | b ]] c\nd", "[[a b c d|teak:\(linkId)]] ^"),
        ("an empty title", "[[^", "  ", "[[Card|teak:\(linkId)]] ^"),
    ])
    func insertsTheLinkInPlaceOfTheQuery(_ name: String, marked: String, title: String, expected: String) throws {
        let (text, cursor) = split(marked)
        let open = try #require(CardLinks.openQuery(in: text, cursor: cursor))
        let result = CardLinks.insertingLink(in: text, replacing: open, title: title, id: linkId)
        let want = split(expected)
        #expect(result.text == want.text, "\(name)")
        #expect(result.cursor == want.cursor, "\(name)")
        #expect(CardLinks.parseIds(result.text) == [linkId], "\(name)")
    }

    @Test func cutsLongTitlesToTheLimit() throws {
        let open = try #require(CardLinks.openQuery(in: "[[", cursor: 2))
        let result = CardLinks.insertingLink(in: "[[", replacing: open, title: String(repeating: "a", count: 300), id: linkId)
        let match = try #require(CardLinks.matches(result.text).first)
        #expect(match.title.utf16.count == CardLinks.titleMaxLength)
        #expect(match.title.hasSuffix("…"))
    }
}
