import Foundation

/// Calls Convex functions by name. The app uses the live WebSocket client;
/// sign-in bootstrap and the extensions use `ConvexHTTP`.
public protocol ConvexCaller: Sendable {
    func query<T: Decodable & Sendable>(_ name: String, _ args: ConvexArgs) async throws -> T
    func mutation<T: Decodable & Sendable>(_ name: String, _ args: ConvexArgs) async throws -> T
    func action<T: Decodable & Sendable>(_ name: String, _ args: ConvexArgs) async throws -> T
}

/// Decodes a function that returns `null`.
public struct ConvexVoid: Decodable, Sendable {
    public init() {}
    public init(from decoder: any Decoder) throws {}
}

/// Abstracts `URLSession.data(for:)` so tests can answer requests.
public protocol HTTPTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
    let session: URLSession

    public init(session: URLSession = URLSession(configuration: .ephemeral)) {
        self.session = session
    }

    public func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}

/// Convex's HTTP API (`/api/query`, `/api/mutation`, `/api/action`) with a bearer token.
public struct ConvexHTTP: ConvexCaller {
    public typealias TokenProvider = @Sendable () async throws -> String?

    let baseURL: URL
    let transport: any HTTPTransport
    let token: TokenProvider
    let timeout: TimeInterval

    public init(baseURL: URL, transport: any HTTPTransport = URLSessionTransport(), timeout: TimeInterval = 30,
                token: @escaping TokenProvider) {
        self.baseURL = baseURL
        self.transport = transport
        self.timeout = timeout
        self.token = token
    }

    public func query<T: Decodable & Sendable>(_ name: String, _ args: ConvexArgs = [:]) async throws -> T {
        try await call("query", name, args)
    }

    public func mutation<T: Decodable & Sendable>(_ name: String, _ args: ConvexArgs = [:]) async throws -> T {
        try await call("mutation", name, args)
    }

    public func action<T: Decodable & Sendable>(_ name: String, _ args: ConvexArgs = [:]) async throws -> T {
        try await call("action", name, args)
    }

    private func call<T: Decodable>(_ kind: String, _ name: String, _ args: ConvexArgs) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: "api/\(kind)"), timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = try await token() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let body: ConvexValue = ["path": .string(name), "args": .object(args), "format": "json"]
        request.httpBody = try body.jsonData()

        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch let error as URLError where error.isConnectivity {
            throw TeakError.offline
        }
        guard data.count <= 8 * 1024 * 1024,
              let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? [String: Any]
        else {
            if response.statusCode == 401 { throw TeakError.signedOut }
            throw TeakError(message: TeakMessages.genericFailure)
        }
        if object["status"] as? String == "success" {
            let value = object["value"] ?? NSNull()
            let encoded = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
            return try JSONDecoder().decode(T.self, from: encoded)
        }
        if let errorData = object["errorData"] as? [String: Any] {
            throw TeakError.card(code: errorData["code"] as? String, message: errorData["message"] as? String)
        }
        if response.statusCode == 401 { throw TeakError.signedOut }
        throw TeakError(message: Self.userMessage(object["errorMessage"] as? String))
    }

    /// Server errors arrive as "[Request ID: …] Server Error\nUncaught Error: Message\n    at …".
    /// Only the thrown message is worth showing.
    static func userMessage(_ raw: String?) -> String {
        guard let raw else { return TeakMessages.genericFailure }
        if let match = raw.firstMatch(of: /Uncaught (?:Convex)?Error: ([^\n]+)/) {
            return String(match.1).trimmingCharacters(in: .whitespaces)
        }
        return TeakMessages.genericFailure
    }
}
