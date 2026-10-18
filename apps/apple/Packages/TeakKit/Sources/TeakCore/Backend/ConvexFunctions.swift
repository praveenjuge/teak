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
    static let uploadAndCreateCard = ConvexFunction<UploadPipeline.Prepared>("cards:uploadAndCreateCard")
    static let finalizeUploadedCard = ConvexFunction<UploadPipeline.Finalized>("cards:finalizeUploadedCard")
    public static let getCurrentUser = ConvexFunction<CurrentUser?>("auth:getCurrentUser")
    public static let getAuthMode = ConvexFunction<AuthMode>("auth:getAuthMode")
    static let ensureUser = ConvexFunction<UserBootstrap.Result>("workosBootstrap:ensureUser")
    public static let revokeAuthkitSession = ConvexFunction<ConvexVoid>("securitySessions:revokeAuthkitSession")
    public static let deleteMyAccount = ConvexFunction<ConvexVoid>("accountDeletion:deleteMyAccount")
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
