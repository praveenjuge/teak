import Foundation

/// A Convex argument or result value. Numbers are always doubles, because the
/// backend's `v.number()` rejects the int64 encoding Convex clients use for
/// integers.
public enum ConvexValue: Sendable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([ConvexValue])
    case object([String: ConvexValue])

    public static func number(_ value: Int) -> ConvexValue { .number(Double(value)) }

    /// The JSON the Convex HTTP API and the Swift client expect.
    public func jsonData() throws -> Data {
        try JSONSerialization.data(withJSONObject: foundationValue, options: [.fragmentsAllowed, .sortedKeys])
    }

    public var jsonString: String {
        (try? jsonData()).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }

    var foundationValue: Any {
        switch self {
        case .null: NSNull()
        case let .bool(value): value
        case let .number(value): value
        case let .string(value): value
        case let .array(values): values.map(\.foundationValue)
        case let .object(values): values.mapValues(\.foundationValue)
        }
    }
}

extension ConvexValue: ExpressibleByStringLiteral, ExpressibleByBooleanLiteral, ExpressibleByFloatLiteral,
    ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral, ExpressibleByNilLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(arrayLiteral elements: ConvexValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, ConvexValue)...) {
        self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
    }
    public init(nilLiteral: ()) { self = .null }
}

public typealias ConvexArgs = [String: ConvexValue]
