import Foundation
import Testing
@testable import TeakCore

@Suite(.english) struct SharedConstantsTests {
    @Test func theGeneratedFileDecodes() throws {
        let url = repositoryRoot.appending(path: "apps/apple/Packages/TeakKit/Sources/TeakCore/Resources/SharedConstants.json")
        _ = try SharedConstants.decode(Data(contentsOf: url))
    }

    @Test func aFileMissingAFieldFailsToDecode() {
        #expect(throws: SharedConstants.LoadError.self) { try SharedConstants.decode(Data("{}".utf8)) }
    }

    @Test func cardTypesMatchTheBackends() {
        #expect(CardType.allCases.map(\.rawValue) == SharedConstants.shared.cardTypes)
    }

    @Test func aHueShowsItsSwatch() {
        #expect(ColorHue("blue")?.hex == "#3B82F6")
    }

    @Test func everyBulkActionIsOneTheBackendTakes() {
        for action in BulkCardAction.allCases {
            #expect(SharedConstants.shared.bulkCardActions.contains(action.rawValue), "\(action)")
        }
    }

    @Test func everyShowValueHasItsWords() {
        #expect(Set(SearchIsValue.allCases.map(\.rawValue)) == Set(SharedConstants.shared.searchIsWords.keys))
    }

    @Test func typeAliasesNameRealCardTypes() {
        for type in SharedConstants.shared.cardTypeAliases.values {
            #expect(CardType(rawValue: type) != nil, "\(type)")
        }
    }
}
