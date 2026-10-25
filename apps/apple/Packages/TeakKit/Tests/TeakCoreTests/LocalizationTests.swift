import Foundation
import Testing
@testable import TeakCore

// Android's core:i18n tests check the same cases.

@Suite struct LocalizationTests {
    @Test(arguments: [
        ("en", 1, "1 card"), ("en", 2, "2 cards"),
        ("de", 1, "1 Karte"), ("de", 3, "3 Karten"),
        ("ja", 1, "1 枚のカード"), ("ja", 3, "3 枚のカード"),
    ])
    func pluralsFollowTheLanguage(_ code: String, count: Int, expected: String) {
        #expect(tr("native.common.cardCount", count: count, [], in: code) == expected)
    }

    @Test func placeholdersTakeStrings() {
        #expect(tr("errors.tags.TAG_EXISTS", ["Design"], in: "en") == "A tag named \"Design\" already exists. Merge into it instead.")
        #expect(tr("errors.folders.NAME_TOO_LONG", ["80"], in: "de").contains("80"))
    }

    @Test func everyLanguageHasItsOwnText() {
        let texts = Set(AppLanguage.codes.map { tr("settings.language.changed", [], in: $0) })
        #expect(texts.count == AppLanguage.codes.count)
    }

    @Test func unknownKeysShowTheKey() {
        #expect(tr("native.missing.key", [], in: "fr") == "native.missing.key")
    }

    @Test func theSettingListsTeaksLanguages() {
        #expect(AppLanguage.codes == ["en", "es", "pt-BR", "de", "fr", "ja", "ko", "zh-Hans"])
        #expect(AppLanguage.supported("pt-BR") == "pt-BR")
        #expect(AppLanguage.supported("pt") == nil)
    }
}
