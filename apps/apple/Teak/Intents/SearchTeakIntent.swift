import AppIntents
import TeakCore

struct SearchTeakIntent: AppIntent {
    static let title = LocalizedStringResource("intents.searchTitle", table: "AppIntents")
    static let description = IntentDescription(LocalizedStringResource("intents.searchDescription", table: "AppIntents"))

    @Parameter(title: LocalizedStringResource("intents.queryParameter", table: "AppIntents"))
    var query: String

    @Parameter(title: LocalizedStringResource("intents.includeArchivedParameter", table: "AppIntents"), default: false)
    var includeArchived: Bool

    static var parameterSummary: some ParameterSummary {
        Summary("Search Teak for \(\.$query)") {
            \.$includeArchived
        }
    }

    func perform() async throws -> some IntentResult & ReturnsValue<[CardEntity]> {
        .result(value: try await CardSearch.run(query, includeArchived: includeArchived))
    }
}
