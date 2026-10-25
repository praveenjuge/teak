import AppIntents
import SwiftUI
import TeakCore
import WidgetKit

/// Teak's Control Center, Lock Screen and Action button controls. They only open the app,
/// so the extension never signs in or touches the network.
@main
struct TeakWidgetsBundle: WidgetBundle {
    init() {
        // The app group keeps Teak's language; read it as this process starts.
        AppLanguage.reload()
    }

    var body: some Widget {
        NewNoteControl()
        VoiceMemoControl()
    }
}

struct NewNoteControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.praveenjuge.teak.widgets.new-note") {
            ControlWidgetButton(action: NewNoteIntent()) {
                Label(tr("apple.controls.newNote"), systemImage: "square.and.pencil")
            }
            .tint(Color("AccentColor"))
        }
        .displayName(catalogResource("apple.controls.newNote"))
        .description(catalogResource("apple.controls.newNoteDescription"))
    }
}

struct VoiceMemoControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.praveenjuge.teak.widgets.voice-memo") {
            ControlWidgetButton(action: RecordVoiceMemoIntent()) {
                Label(tr("apple.controls.voiceMemo"), systemImage: "mic")
            }
            .tint(Color("AccentColor"))
        }
        .displayName(catalogResource("apple.controls.voiceMemo"))
        .description(catalogResource("apple.controls.voiceMemoDescription"))
    }
}

/// Catalog text, in Teak's language, where WidgetKit takes a `LocalizedStringResource`.
/// The extension's bundle has no entry for the translated text, so it shows as it is.
private func catalogResource(_ key: String) -> LocalizedStringResource {
    LocalizedStringResource(String.LocalizationValue(tr(key)))
}
