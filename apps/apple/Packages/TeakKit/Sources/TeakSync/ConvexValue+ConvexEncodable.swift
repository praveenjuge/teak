import ConvexMobile
import TeakCore

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
