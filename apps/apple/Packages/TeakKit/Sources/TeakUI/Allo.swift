import CoreText
import SwiftUI
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// Allo by Josh Puckett (SIL OFL 1.1, `Resources/Allo-OFL.txt`), the font of every Teak app.
///
/// `Allo.ttf` is Allo 1.1's variable upright from allo.joshpuckett.me/configure, the same file as Android's:
/// weight 100 to 900, optical size 9 to 32 (Core Text sets it from the point size, as browsers do), roundness
/// fixed at 50, and the single-story "a" drawn in. Allo has no variable oblique, so italics use its drawn
/// obliques at 400 to 700, which take the single-story "a" from `ss01`, as on the web.
public enum Allo {
    static let upright = "AlloVariable-Regular"

    /// Registers the fonts for this process once. Every font made here reads it first.
    private static let registered: Void = {
        for file in ["Allo.ttf", "Allo-Oblique.otf", "Allo-MediumOblique.otf", "Allo-SemiBoldOblique.otf", "Allo-BoldOblique.otf"] {
            guard let url = Bundle.module.url(forResource: file, withExtension: nil) else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()

    /// The system font's size for `style` at `dynamicTypeSize`. Allo sets at the same sizes.
    public static func pointSize(_ style: Font.TextStyle, at dynamicTypeSize: DynamicTypeSize = .large) -> CGFloat {
        #if os(macOS)
        NSFont.preferredFont(forTextStyle: style.platform).pointSize
        #else
        UIFont.preferredFont(forTextStyle: style.platform,
                             compatibleWith: UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(dynamicTypeSize)))
            .pointSize
        #endif
    }

    /// Allo upright at `size`, for UIKit and AppKit text, which doesn't follow Dynamic Type on its own.
    public static func platformFont(size: CGFloat, weight: Double) -> CTFont {
        _ = registered
        let wght = 0x7767_6874 // 'wght'
        let descriptor = CTFontDescriptorCreateWithAttributes([
            kCTFontNameAttribute: upright,
            kCTFontVariationAttribute: [wght: weight],
        ] as CFDictionary)
        return CTFontCreateWithFontDescriptor(descriptor, size, nil)
    }

    #if os(iOS)
    /// Sets navigation bar titles, tab bar labels and search fields in Allo. UIKit draws them, so SwiftUI's
    /// environment font doesn't reach them; `UIFontMetrics` keeps them following Dynamic Type. Call it once the
    /// app has launched: set from the `App`'s initializer, it kept the app's accent color off the tab bar.
    @MainActor public static func styleSystemBars() {
        _ = styledSystemBars
    }

    @MainActor private static let styledSystemBars: Void = {
        func font(_ style: UIFont.TextStyle, size: CGFloat? = nil, weight: Double) -> UIFont {
            let base = size ?? UIFont.preferredFont(forTextStyle: style,
                                                    compatibleWith: UITraitCollection(preferredContentSizeCategory: .large)).pointSize
            return UIFontMetrics(forTextStyle: style).scaledFont(for: platformFont(size: base, weight: weight) as UIFont)
        }
        let bar = UINavigationBar.appearance()
        bar.largeTitleTextAttributes = [.font: font(.largeTitle, weight: 700)]
        bar.titleTextAttributes = [.font: font(.headline, weight: 600)]
        UITabBarItem.appearance().setTitleTextAttributes([.font: font(.caption2, size: 10, weight: 500)], for: .normal)
        UISearchTextField.appearance().font = font(.body, weight: 400)
    }()
    #endif

    static func oblique(size: CGFloat, weight: Font.Weight) -> CTFont {
        _ = registered
        let name = switch weight {
        case .medium: "Allo-MediumOblique"
        case .semibold: "Allo-SemiBoldOblique"
        case .bold, .heavy, .black: "Allo-BoldOblique"
        default: "Allo-Oblique"
        }
        let ss01: [CFString: Any] = [kCTFontOpenTypeFeatureTag: "ss01", kCTFontOpenTypeFeatureValue: 1]
        let descriptor = CTFontDescriptorCreateWithAttributes([
            kCTFontNameAttribute: name,
            kCTFontFeatureSettingsAttribute: [ss01],
        ] as CFDictionary)
        return CTFontCreateWithFontDescriptor(descriptor, size, nil)
    }

    /// The weight the system font gives `style`: headlines are heavier.
    static func weight(_ style: Font.TextStyle) -> Font.Weight? {
        guard style == .headline else { return nil }
        #if os(macOS)
        return .bold
        #else
        return .semibold
        #endif
    }

    fileprivate static func custom(_ size: CGFloat, relativeTo style: Font.TextStyle?) -> Font {
        _ = registered
        return if let style { .custom(upright, size: size, relativeTo: style) } else { .custom(upright, fixedSize: size) }
    }
}

public extension Font {
    /// Allo at a text style's size and weight, growing and shrinking with Dynamic Type as the system font does.
    static func allo(_ style: TextStyle) -> Font {
        let font = Allo.custom(Allo.pointSize(style), relativeTo: style)
        return Allo.weight(style).map { font.weight($0) } ?? font
    }

    /// Allo at a fixed size, like `.system(size:weight:)`: it doesn't follow Dynamic Type.
    static func allo(fixedSize size: CGFloat, weight: Weight = .regular) -> Font {
        Allo.custom(size, relativeTo: nil).weight(weight)
    }

    /// Allo's oblique nearest `weight` at `size`, for italics. `size` is fixed, so pass one that already follows
    /// Dynamic Type, such as `Allo.pointSize(_:at:)` for the view's `dynamicTypeSize`.
    static func alloOblique(size: CGFloat, weight: Weight = .regular) -> Font {
        Font(Allo.oblique(size: size, weight: weight))
    }
}

#if os(macOS)
private typealias PlatformTextStyle = NSFont.TextStyle
#else
private typealias PlatformTextStyle = UIFont.TextStyle
#endif

private extension Font.TextStyle {
    var platform: PlatformTextStyle {
        switch self {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .subheadline: .subheadline
        case .callout: .callout
        case .footnote: .footnote
        case .caption: .caption1
        case .caption2: .caption2
        default: .body
        }
    }
}
