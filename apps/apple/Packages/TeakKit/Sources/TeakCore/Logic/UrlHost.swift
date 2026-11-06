import Foundation

/// A port of `normalizeUrlHost` and `hostForDisplay` (`packages/convex/shared/utils/urlHost.ts`):
/// the lowercase host without `www.`, a port or a path, with Unicode names in
/// punycode as the backend stores them, and back to Unicode for people to read.
/// `urlHost.json` holds the rows the backend, Apple and Android all run.
public enum UrlHost {
    public static func normalize(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty,
              trimmed.firstMatch(of: /^[a-zA-Z][a-zA-Z\d+.\-]*:(?!\/\/)(?!\d)/) == nil
        else { return nil }
        let afterScheme = trimmed.firstMatch(of: /^[a-zA-Z][a-zA-Z\d+.\-]*:\/\//).map { String(trimmed[$0.range.upperBound...]) }
            ?? trimmed
        let authority = afterScheme.prefix { !"/?#\\".contains($0) }
        let hostAndPort = authority.split(separator: "@", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        var host: String
        let bracketed = hostAndPort.hasPrefix("[")
        if bracketed {
            guard let close = hostAndPort.firstIndex(of: "]") else { return nil }
            host = String(hostAndPort[...close]).lowercased()
        } else {
            host = String(hostAndPort.prefix { $0 != ":" }).lowercased()
        }
        guard !host.contains(where: { $0.isWhitespace || "<>^|%\u{0}".contains($0) }) else { return nil }
        if !bracketed {
            guard let ascii = toASCII(host) else { return nil }
            host = ascii
        }
        while host.hasSuffix(".") { host.removeLast() }
        if host.hasPrefix("www."), host.count > 4 { host.removeFirst(4) }
        return host.isEmpty ? nil : host
    }

    /// Punycode labels written back in Unicode, for chips and rows.
    public static func forDisplay(_ host: String) -> String {
        host.split(separator: ".", omittingEmptySubsequences: false).map { label in
            label.hasPrefix("xn--") ? decodeLabel(String(label.dropFirst(4))) ?? String(label) : String(label)
        }.joined(separator: ".")
    }

    private static func toASCII(_ host: String) -> String? {
        var labels: [String] = []
        for label in host.split(separator: ".", omittingEmptySubsequences: false) {
            if label.unicodeScalars.allSatisfy(\.isASCII) {
                labels.append(String(label))
            } else {
                guard let encoded = encodeLabel(String(label)) else { return nil }
                labels.append("xn--" + encoded)
            }
        }
        return labels.joined(separator: ".")
    }

    // MARK: - Punycode (RFC 3492)

    private static let base = 36
    private static let tMin = 1
    private static let tMax = 26
    private static let skew = 38
    private static let damp = 700
    private static let initialBias = 72
    private static let initialN = 128

    private static func adapt(_ delta: Int, points: Int, first: Bool) -> Int {
        var delta = first ? delta / damp : delta / 2
        delta += delta / points
        var k = 0
        while delta > ((base - tMin) * tMax) / 2 {
            delta /= base - tMin
            k += base
        }
        return k + (base - tMin + 1) * delta / (delta + skew)
    }

    private static func threshold(_ k: Int, bias: Int) -> Int {
        k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
    }

    private static func digit(_ value: Int) -> Character {
        Character(Unicode.Scalar(UInt8(value < 26 ? value + 97 : value + 22)))
    }

    private static func digitValue(_ scalar: Unicode.Scalar) -> Int {
        switch scalar.value {
        case 48...57: Int(scalar.value) - 22
        case 65...90: Int(scalar.value) - 65
        case 97...122: Int(scalar.value) - 97
        default: base
        }
    }

    static func encodeLabel(_ label: String) -> String? {
        let input = label.unicodeScalars.map { Int($0.value) }
        var output = String(String.UnicodeScalarView(label.unicodeScalars.filter(\.isASCII)))
        let basic = input.count(where: { $0 < initialN })
        var handled = basic
        if basic > 0 { output.append("-") }
        var n = initialN
        var delta = 0
        var bias = initialBias
        while handled < input.count {
            guard let next = input.filter({ $0 >= n }).min() else { return nil }
            delta += (next - n) * (handled + 1)
            n = next
            for code in input {
                if code < n { delta += 1 }
                guard code == n else { continue }
                var q = delta
                var k = base
                while true {
                    let t = threshold(k, bias: bias)
                    if q < t { break }
                    output.append(digit(t + (q - t) % (base - t)))
                    q = (q - t) / (base - t)
                    k += base
                }
                output.append(digit(q))
                bias = adapt(delta, points: handled + 1, first: handled == basic)
                delta = 0
                handled += 1
            }
            delta += 1
            n += 1
        }
        return output
    }

    static func decodeLabel(_ label: String) -> String? {
        let input = Array(label.unicodeScalars)
        let basicEnd = input.lastIndex(of: "-") ?? -1
        var output: [Int] = input.prefix(max(basicEnd, 0)).map { Int($0.value) }
        var n = initialN
        var bias = initialBias
        var i = 0
        var position = basicEnd > 0 ? basicEnd + 1 : 0
        while position < input.count {
            let oldI = i
            var weight = 1
            var k = base
            while true {
                guard position < input.count else { return nil }
                let value = digitValue(input[position])
                position += 1
                guard value < base else { return nil }
                let (step, stepOverflow) = value.multipliedReportingOverflow(by: weight)
                let (sum, sumOverflow) = i.addingReportingOverflow(step)
                guard !stepOverflow, !sumOverflow else { return nil }
                i = sum
                let t = threshold(k, bias: bias)
                if value < t { break }
                let (nextWeight, weightOverflow) = weight.multipliedReportingOverflow(by: base - t)
                guard !weightOverflow else { return nil }
                weight = nextWeight
                k += base
            }
            let points = output.count + 1
            bias = adapt(i - oldI, points: points, first: oldI == 0)
            let (nextN, nOverflow) = n.addingReportingOverflow(i / points)
            guard !nOverflow, nextN <= 0x10FFFF else { return nil }
            n = nextN
            i %= points
            output.insert(n, at: i)
            i += 1
        }
        var scalars = String.UnicodeScalarView()
        for code in output {
            guard let scalar = Unicode.Scalar(UInt32(code)) else { return nil }
            scalars.append(scalar)
        }
        return String(scalars)
    }
}
