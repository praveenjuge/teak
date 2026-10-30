import Foundation

/// Adding and removing a palette card's colors, as the server's `addColor` and `removeColor` edits accept them.
public enum PaletteEdit {
    /// The server refuses a write that grows a palette past this.
    public static let maxColors = 12

    /// `input` as `#RRGGBB` in capitals: 3 or 6 hex digits, with or without `#`, spaces around it ignored.
    /// Nil for anything else, as the server's `parsePaletteHex`.
    public static func normalizedHex(_ input: String) -> String? {
        var digits = Substring(input.trimmingCharacters(in: .whitespacesAndNewlines))
        if digits.first == "#" { digits = digits.dropFirst() }
        guard digits.count == 3 || digits.count == 6, digits.allSatisfy({ $0.isASCII && $0.isHexDigit }) else { return nil }
        let full = digits.count == 3 ? digits.map { "\($0)\($0)" }.joined() : String(digits)
        return "#" + full.uppercased()
    }

    /// A stored color's `#RRGGBB`, ignoring any alpha (`#FF000080` saved from text is `#FF0000`), as the server
    /// compares them. Nil when it isn't a hex code.
    public static func storedHex(_ hex: String) -> String? {
        var digits = Substring(hex.trimmingCharacters(in: .whitespacesAndNewlines))
        if digits.first == "#" { digits = digits.dropFirst() }
        return normalizedHex(String(digits.count == 8 ? digits.prefix(6) : digits))
    }

    /// Whether the card can take another color: a palette, not in Trash, with room left.
    public static func canAdd(_ card: Card) -> Bool {
        isEditable(card) && (card.colors ?? []).count < maxColors
    }

    /// Whether a color can go: a palette, not in Trash, that keeps at least one color afterwards.
    public static func canRemove(_ card: Card) -> Bool {
        isEditable(card) && Set((card.colors ?? []).map { key($0.hex) }).count > 1
    }

    /// Whether the palette already has `hex`, however either is written.
    public static func contains(_ card: Card, _ hex: String) -> Bool {
        let wanted = key(hex)
        return (card.colors ?? []).contains { key($0.hex) == wanted }
    }

    private static func isEditable(_ card: Card) -> Bool { card.type == .palette && !card.deleted }

    private static func key(_ hex: String) -> String {
        storedHex(hex) ?? hex.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }
}
