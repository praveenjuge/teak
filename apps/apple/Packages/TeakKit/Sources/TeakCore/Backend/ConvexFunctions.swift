import Foundation

public struct ConvexFunction<Value: Decodable & Sendable>: Sendable {
    public let name: String

    init(_ name: String) {
        self.name = name
    }
}

public enum ConvexFunctions {
    public static let searchCardSummaries = ConvexFunction<CardSummaryPageResult>("cards:searchMobileCardSummariesPaginated")
    public static let getCard = ConvexFunction<Card?>("cards:getCard")
    public static let findDuplicateCard = ConvexFunction<Card?>("cards:findDuplicateCard")
    public static let createCard = ConvexFunction<String>("cards:createCard")
    public static let updateCardField = ConvexFunction<ConvexVoid>("cards:updateCardField")
    public static let permanentDeleteCard = ConvexFunction<ConvexVoid>("cards:permanentDeleteCard")
    public static let emptyTrash = ConvexFunction<TrashCount>("cards:emptyTrash")
    public static let trashCount = ConvexFunction<TrashCount>("cards:trashCount")
    public static let bulkUpdateCards = ConvexFunction<BulkUpdateResult>("cards:bulkUpdateCards")
    public static let reprocessCard = ConvexFunction<ReprocessResult>("cards:reprocessCard")
    public static let getCardLinkTargets = ConvexFunction<[CardLinkTarget]>("cards:getCardLinkTargets")
    public static let getCardBacklinks = ConvexFunction<CardBacklinks>("cards:getCardBacklinks")
    public static let searchCardLinkSuggestions = ConvexFunction<[LinkedCard]>("cards:searchCardLinkSuggestions")
    public static let viewHasHiddenCards = ConvexFunction<Bool>("cards:viewHasHiddenCards")
    public static let requestSemanticResults = ConvexFunction<SemanticResult>("search/semanticActions:requestSemanticResults")
    public static let listFolders = ConvexFunction<[Folder]>("folders:listFolders")
    public static let createFolder = ConvexFunction<Folder>("folders:createFolder")
    public static let updateFolder = ConvexFunction<Folder>("folders:updateFolder")
    public static let deleteFolder = ConvexFunction<String>("folders:deleteFolder")
    public static let restoreFolder = ConvexFunction<Folder>("folders:restoreFolder")
    public static let addCardsToFolder = ConvexFunction<FolderMembershipResult>("folders:addCardsToFolder")
    public static let removeCardsFromFolder = ConvexFunction<FolderMembershipResult>("folders:removeCardsFromFolder")
    public static let setCardFolders = ConvexFunction<[String]>("folders:setCardFolders")
    public static let listTagSummary = ConvexFunction<TagSummary?>("tags:listTagSummary")
    public static let requestTagSummary = ConvexFunction<ConvexVoid>("tags:requestTagSummary")
    public static let startTagOperation = ConvexFunction<TagOperation>("tags:startTagOperation")
    public static let getTagOperation = ConvexFunction<TagOperation?>("tags:getTagOperation")
    static let uploadAndCreateCard = ConvexFunction<UploadPipeline.Prepared>("cards:uploadAndCreateCard")
    static let finalizeUploadedCard = ConvexFunction<UploadPipeline.Finalized>("cards:finalizeUploadedCard")
    public static let getCurrentUser = ConvexFunction<CurrentUser?>("auth:getCurrentUser")
    public static let getAuthMode = ConvexFunction<AuthMode>("auth:getAuthMode")
    static let ensureUser = ConvexFunction<UserBootstrap.Result>("workosBootstrap:ensureUser")
    public static let revokeAuthkitSession = ConvexFunction<ConvexVoid>("securitySessions:revokeAuthkitSession")
    public static let deleteMyAccount = ConvexFunction<ConvexVoid>("accountDeletion:deleteMyAccount")
    public static let getPreferences = ConvexFunction<AccountPreferences?>("settings/preferences:getPreferences")
    public static let setLocale = ConvexFunction<AccountPreferences>("settings/preferences:setLocale")
}

/// The account's display preferences: its language, as a BCP 47 code.
public struct AccountPreferences: Decodable, Sendable, Hashable {
    public let locale: String
}

public extension ConvexCaller {
    func query<Value: Decodable & Sendable>(_ function: ConvexFunction<Value>, _ args: ConvexArgs = [:]) async throws -> Value {
        try await query(function.name, args)
    }

    func mutation<Value: Decodable & Sendable>(_ function: ConvexFunction<Value>, _ args: ConvexArgs = [:]) async throws -> Value {
        try await mutation(function.name, args)
    }

    func action<Value: Decodable & Sendable>(_ function: ConvexFunction<Value>, _ args: ConvexArgs = [:]) async throws -> Value {
        try await action(function.name, args)
    }
}
