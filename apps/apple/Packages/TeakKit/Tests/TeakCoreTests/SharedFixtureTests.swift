import Foundation
import Testing
@testable import TeakCore

// Rows from packages/convex/__tests__/shared/fixtures, which the TypeScript
// tests and Android's core:model tests run too.

struct LinkDetectionRows: Decodable, Sendable {
    struct Row: Decodable, Sendable, CustomTestStringConvertible {
        let content: String
        let url: String?
        let cleanedContent: String
        var testDescription: String { content }
    }

    let extract: [Row]

    static let shared = Fixtures.load("linkDetection", as: LinkDetectionRows.self)
}

struct UrlHostRows: Decodable, Sendable {
    struct Normalize: Decodable, Sendable, CustomTestStringConvertible {
        let input: String
        let host: String?
        var testDescription: String { input }
    }

    struct Display: Decodable, Sendable, CustomTestStringConvertible {
        let host: String
        let display: String
        var testDescription: String { host }
    }

    let normalize: [Normalize]
    let display: [Display]

    static let shared = Fixtures.load("urlHost", as: UrlHostRows.self)
}

struct SearchTokenRows: Decodable, Sendable {
    struct Row: Decodable, Sendable, CustomTestStringConvertible {
        let token: String
        let kind: String
        let value: String
        var testDescription: String { token }
    }

    let classify: [Row]

    static let shared = Fixtures.load("searchTokens", as: SearchTokenRows.self)
}

struct BulkTagRows: Decodable, Sendable {
    struct Row: Decodable, Sendable, CustomTestStringConvertible {
        let text: String
        let tags: [String]
        let error: String?
        var testDescription: String { String(text.prefix(40)) }
    }

    let rows: [Row]

    static let shared = Fixtures.load("bulkTags", as: BulkTagRows.self)
}

struct FileNameRows: Decodable, Sendable {
    let valid: [String]
    let invalid: [String]

    static let shared = Fixtures.load("fileNames", as: FileNameRows.self)
}

@Suite(.english) struct SharedFixtureTests {
    @Test(arguments: LinkDetectionRows.shared.extract)
    func extractsTheURLTheWebWould(_ row: LinkDetectionRows.Row) {
        let (url, content) = LinkDetection.extractURL(row.content)
        #expect(url == row.url, "\(row.content)")
        #expect(content == row.cleanedContent, "\(row.content)")
    }

    @Test(arguments: UrlHostRows.shared.normalize)
    func readsASiteTheWayTheBackendDoes(_ row: UrlHostRows.Normalize) {
        #expect(UrlHost.normalize(row.input) == row.host, "\(row.input)")
    }

    @Test(arguments: UrlHostRows.shared.display)
    func showsPunycodeHostsInUnicode(_ row: UrlHostRows.Display) {
        #expect(UrlHost.forDisplay(row.host) == row.display, "\(row.host)")
    }

    @Test(arguments: SearchTokenRows.shared.classify)
    func readsStyleColorAndHexWordsAsTheWebDoes(_ row: SearchTokenRows.Row) {
        let token = SearchTokens.classify(row.token)
        let kinds: [String: SearchToken.Kind] = ["style": .style, "hue": .hue, "hex": .hex]
        if let kind = kinds[row.kind] {
            #expect(token.kind == kind, "\(row.token)")
            #expect(token.value == row.value, "\(row.token)")
        } else {
            #expect(!kinds.values.contains(token.kind), "\(row.token) is a word")
        }
    }

    @Test(arguments: BulkTagRows.shared.rows)
    func takesTheTagsTheBackendTakes(_ row: BulkTagRows.Row) {
        let parsed = BulkTags.parse(row.text)
        #expect(parsed.tags == row.tags)
        #expect(parsed.canAdd == (row.error == nil))
        switch row.error {
        case "NAME_TOO_LONG": #expect(parsed.error == "Tags can be at most 64 characters")
        case "TOO_MANY_TAGS": #expect(parsed.error == "Choose at most 20 tags at a time.")
        default: #expect(parsed.error == nil)
        }
    }

    @Test func takesTheFileNamesTheBackendTakes() {
        for name in FileNameRows.shared.valid {
            #expect(FileFormats.validFileName(name) == name.trimmingCharacters(in: .whitespacesAndNewlines), "\(name)")
        }
        for name in FileNameRows.shared.invalid {
            #expect(FileFormats.validFileName(name) == nil, "\(name)")
        }
    }
}
