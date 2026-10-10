import AppIntents
import UIKit

/// "Save to Teak" in the Shortcuts app and Siri. It opens Teak with the text,
/// and Teak saves it the way the share sheet does (see app/save.tsx).
@available(iOS 16.0, *)
struct SaveToTeakIntent: AppIntent {
  static var title: LocalizedStringResource = "Save to Teak"
  static var description = IntentDescription("Saves text or a link to your Teak library.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Text or Link", inputOptions: String.IntentInputOptions(multiline: true))
  var content: String

  static var parameterSummary: some ParameterSummary {
    Summary("Save \(\.$content) to Teak")
  }

  @MainActor
  func perform() async throws -> some IntentResult {
    // URLQueryItem leaves "&", "=" and "+" as they are, which would cut the
    // text short, so encode everything outside the unreserved ASCII set.
    let unreserved = CharacterSet(
      charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    )
    if let text = content.addingPercentEncoding(withAllowedCharacters: unreserved),
      let url = URL(string: "teak://save?text=\(text)")
    {
      await UIApplication.shared.open(url)
    }
    return .result()
  }
}

@available(iOS 16.0, *)
struct TeakShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: SaveToTeakIntent(),
      phrases: ["Save to \(.applicationName)"],
      shortTitle: "Save to Teak",
      systemImageName: "square.and.arrow.down"
    )
  }
}
