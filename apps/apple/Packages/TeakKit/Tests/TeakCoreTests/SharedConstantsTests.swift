import Foundation
import Testing
@testable import TeakCore

@Suite(.english) struct SharedConstantsTests {
    @Test func theBundledFileDecodes() throws {
        let constants = try SharedConstants.load()
        #expect(constants.cardTypes == SharedConstants.shared.cardTypes)
    }

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

    @Test func everyColorHueHasASwatch() {
        let constants = SharedConstants.shared
        #expect(ColorHue.all.map(\.id) == constants.colorHues)
        #expect(Set(constants.colorHueSwatches.keys) == Set(constants.colorHues))
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
