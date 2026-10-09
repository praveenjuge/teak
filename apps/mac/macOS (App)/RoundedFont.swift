import AppKit
import SwiftUI

extension NSFont {
    /// SF Rounded at the given system size and weight, used by the app's AppKit screens.
    static func rounded(ofSize size: CGFloat, weight: NSFont.Weight = .regular) -> NSFont {
        let system = NSFont.systemFont(ofSize: size, weight: weight)
        guard let descriptor = system.fontDescriptor.withDesign(.rounded) else { return system }
        return NSFont(descriptor: descriptor, size: size) ?? system
    }
}
