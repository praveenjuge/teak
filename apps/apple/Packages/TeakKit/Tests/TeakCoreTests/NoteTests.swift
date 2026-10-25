import Foundation
import Testing
@testable import TeakCore

// Tables and task lists in notes. The rows mirror Android's NoteBlocksTest and TaskListsTest, and the ticking rows
// mirror apps/web/src/components/text-editor/__tests__/taskListSort.test.ts. Keep them in step.

private let linkId = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b"

@Suite struct NoteTableTests {
    @Test func readsAGFMTableWithAHeaderRow() {
        let note = "| Plan | Price |\n| --- | --- |\n| Free | $0 |\n| Pro | **$8** |"
        #expect(MarkdownBlocks.parse(note) == [
            .table(MarkdownTable(header: ["Plan", "Price"], rows: [["Free", "$0"], ["Pro", "**$8**"]])),
        ])
    }

    @Test func readsATableWithoutOuterPipesOrBodyRows() {
        #expect(MarkdownBlocks.parse("Plan | Price\n--|--") == [.table(MarkdownTable(header: ["Plan", "Price"], rows: []))])
    }

    @Test func keepsEveryColumnOfAWideTable() {
        let header = (1 ... 12).map { "Column \($0)" }
        let row = (1 ... 12).map { "Value \($0)" }
        let note = ["| \(header.joined(separator: " | ")) |", "|\(Array(repeating: " --- |", count: 12).joined())",
                    "| \(row.joined(separator: " | ")) |"].joined(separator: "\n")
        #expect(MarkdownBlocks.parse(note) == [.table(MarkdownTable(header: header, rows: [row]))])
    }

    @Test(arguments: [
        ("a ragged row", "| a | b |\n| - | - |\n| 1 |"),
        ("an aligned column", "| a | b |\n| :- | - |\n| 1 | 2 |"),
        ("a header wider than its rows", "| a | b | c |\n| - | - | - |\n| 1 | 2 |"),
    ])
    func keepsATableTheWebKeepsLiteral(_ name: String, note: String) {
        #expect(MarkdownBlocks.parse(note) == [.code(note)])
    }

    @Test func keepsATableNestedInAListLiteral() {
        #expect(MarkdownBlocks.parse("- Item\n  | a | b |\n  | - | - |") == [
            .list([MarkdownListItem(depth: 0, marker: "•", text: "Item", line: 0)]),
            .code("  | a | b |\n  | - | - |"),
        ])
        #expect(MarkdownBlocks.parse("- Item\n\n  | a | b |\n  | - | - |").last == .code("  | a | b |\n  | - | - |"))
    }

    @Test func leavesATableInAQuoteAsQuoteText() {
        #expect(MarkdownBlocks.parse("> | a | b |\n> | - | - |") == [.quote("| a | b |\n| - | - |")])
    }

    @Test func keepsCardLinksAndEscapedPipesInsideCells() {
        let note = "| Card | Note |\n| --- | --- |\n| [[Plan\\|teak:\(linkId)]] | a \\| b |"
        guard case let .table(table) = MarkdownBlocks.parse(note).first else {
            Issue.record("Expected a table")
            return
        }
        #expect(table.rows == [["[[Plan|teak:\(linkId)]]", "a | b"]])
        #expect(CardLinks.matches(table.rows[0][0]).map(\.id) == [linkId])
    }

    @Test func startsATableAfterAParagraphAndBackToBack() {
        let note = "Intro\n| a |\n| - |\n| 1 |\n\n| b |\n| - |\n| 2 |"
        #expect(MarkdownBlocks.parse(note) == [
            .paragraph("Intro"),
            .table(MarkdownTable(header: ["a"], rows: [["1"]])),
            .table(MarkdownTable(header: ["b"], rows: [["2"]])),
        ])
    }

    @Test func leavesALineOfDashesAsARule() {
        #expect(MarkdownBlocks.parse("Title\n---") == [.paragraph("Title"), .rule])
    }

    @Test func readsATableOnATileAsTheWebDoes() {
        #expect(MarkdownBlocks.plainText("| Plan | Price |\n| --- | --- |\n| **Free** |  |") == "Plan · Price / Free")
    }
}

@Suite struct NoteTaskTests {
    @Test func readsTaskItemsInAMixedList() {
        let note = "- [ ] Buy milk\n- [x] Call mom\n  * [X] Nested\n- plain\n- [ ]\n1. [ ] numbered"
        #expect(MarkdownBlocks.parse(note) == [.list([
            MarkdownListItem(depth: 0, marker: "•", text: "Buy milk", checked: false, line: 0),
            MarkdownListItem(depth: 0, marker: "•", text: "Call mom", checked: true, line: 1),
            MarkdownListItem(depth: 1, marker: "•", text: "Nested", checked: true, line: 2),
            MarkdownListItem(depth: 0, marker: "•", text: "plain", line: 3),
            MarkdownListItem(depth: 0, marker: "•", text: "[ ]", line: 4),
            MarkdownListItem(depth: 0, marker: "1.", text: "[ ] numbered", line: 5),
        ])])
    }

    @Test func countsLinesFromTheTopOfTheNote() {
        guard case let .list(items) = MarkdownBlocks.parse("# Today\r\n\r\n- [ ] Plan").last else {
            Issue.record("Expected a list")
            return
        }
        #expect(items.map(\.line) == [2])
    }
}

/// The task on `line` ticked or unticked through the item the renderer shows.
private func toggled(_ markdown: String, line: Int) -> String? {
    let items = MarkdownBlocks.parse(markdown).flatMap { block -> [MarkdownListItem] in
        if case let .list(items) = block { return items }
        return []
    }
    guard let item = items.first(where: { $0.line == line }) else { return nil }
    return TaskLists.toggle(markdown, item: item)
}

@Suite struct TaskListTests {
    @Test(arguments: [
        ("ticking the first of three moves it to the end", "- [ ] A\n- [ ] B\n- [ ] C", 0, "- [ ] B\n- [ ] C\n- [x] A"),
        ("ticking the last open item below a done one moves it first", "- [x] A\n- [ ] B", 1, "- [x] B\n- [x] A"),
        ("ticking leads the done items, which keep their order", "- [ ] A\n- [ ] B\n- [x] C\n- [x] D", 0,
         "- [ ] B\n- [x] A\n- [x] C\n- [x] D"),
        ("unticking moves it to the end of the open items", "- [ ] A\n- [x] B\n- [x] C", 2, "- [ ] A\n- [ ] C\n- [x] B"),
        ("unticking when every item is done moves it first", "- [x] A\n- [x] B", 1, "- [ ] B\n- [x] A"),
        ("a nested child moves only within its own sublist", "- [ ] P\n  - [ ] c1\n  - [ ] c2\n- [ ] Q", 1,
         "- [ ] P\n  - [ ] c2\n  - [x] c1\n- [ ] Q"),
        ("a parent moves with its children", "- [ ] P\n  - [ ] c1\n  - [x] c2\n- [ ] Q", 0,
         "- [ ] Q\n- [x] P\n  - [ ] c1\n  - [x] c2"),
        ("a task list next to a bullet list leaves the bullets alone", "- one\n- two\n\nThen\n\n- [ ] A\n- [ ] B", 5,
         "- one\n- two\n\nThen\n\n- [ ] B\n- [x] A"),
        ("a loose list keeps its blank lines where they were", "- [ ] A\n\n- [ ] B\n- [ ] C", 0,
         "- [ ] B\n\n- [ ] C\n- [x] A"),
        ("odd spacing, as the checklists seed writes it", "-  [ ] Two spaces\n\n- [ ] Blank line above\n* [ ] Star bullet", 0,
         "- [ ] Blank line above\n\n-  [x] Two spaces\n* [ ] Star bullet"),
    ])
    func reordersTheList(_ name: String, before: String, line: Int, after: String) {
        #expect(toggled(before, line: line) == after)
    }

    @Test(arguments: [
        ("ticking the last open item already above the done ones", "- [ ] A\n- [x] B", 0, "- [x] A\n- [x] B"),
        ("unticking an item already at the end of the open ones", "- [ ] A\n- [x] B\n- [x] C", 1, "- [ ] A\n- [ ] B\n- [x] C"),
        ("a list with one item", "- [ ] A", 0, "- [x] A"),
        ("a list mixing tasks and plain items", "- [ ] A\n- plain\n- [ ] B", 0, "- [x] A\n- plain\n- [ ] B"),
        ("another bullet starts another list", "- [ ] A\n* [ ] B", 0, "- [x] A\n* [ ] B"),
    ])
    func movesNothing(_ name: String, before: String, line: Int, after: String) {
        #expect(toggled(before, line: line) == after)
    }

    @Test func flipsExactlyTheTappedOneOfTwoSameLines() {
        let note = "- [ ] A\n- [ ] B\n- [ ] A"
        #expect(toggled(note, line: 2) == "- [ ] A\n- [ ] B\n- [x] A")
        #expect(toggled(note, line: 0) == "- [ ] B\n- [ ] A\n- [x] A")
    }

    @Test func leavesEveryOtherLineAsWritten() {
        #expect(toggled("# List\n* [ ] A **bold**\n* [X] B\n\nEnd  ", line: 1) == "# List\n* [x] A **bold**\n* [X] B\n\nEnd  ")
        #expect(toggled("- [ ] A\r\n- [ ] B", line: 0) == "- [ ] B\r\n- [x] A")
    }

    @Test func refusesALineThatChangedUnderneath() {
        let item = MarkdownListItem(depth: 0, marker: "•", text: "A", checked: false, line: 0)
        #expect(TaskLists.toggle("- [x] A", item: item) == nil)
        #expect(TaskLists.toggle("- A", item: item) == nil)
        #expect(TaskLists.toggle("", item: item) == nil)
        #expect(TaskLists.toggle("- [ ] A", item: MarkdownListItem(depth: 0, marker: "•", text: "A", line: 0)) == nil)
    }

    @Test(arguments: [
        ([false, false, false], 0, [1, 2, 0]),
        ([true, false], 1, [1, 0]),
        ([false, true], 0, [0, 1]),
        ([true, true], 1, [1, 0]),
        ([false, true, true], 2, [0, 2, 1]),
    ])
    func sortsAsTheWebDoes(_ checked: [Bool], index: Int, order: [Int]) {
        #expect(TaskLists.sortedOrder(checked, index: index) == order)
    }
}
