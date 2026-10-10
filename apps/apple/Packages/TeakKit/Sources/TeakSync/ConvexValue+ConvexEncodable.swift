import ConvexMobile
import TeakCore

/// Lets TeakCore's arguments go straight to the Convex client. Every number is
/// already a double, so nothing reaches the backend as an int64.
extension ConvexValue: ConvexEncodable {
    public func convexEncode() throws -> String {
        jsonString
    }
}

extension Dictionary where Key == String, Value == ConvexValue {
    var convexArgs: [String: (any ConvexEncodable)?] {
        mapValues { $0 as (any ConvexEncodable)? }
    }
}
