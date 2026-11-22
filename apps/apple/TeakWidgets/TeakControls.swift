import AppIntents
import SwiftUI
import TeakCore
import WidgetKit

/// Teak's widgets, and its Control Center, Lock Screen and Action button controls. They only
/// open the app or read what it saved to the app group, so the extension never signs in or
/// touches the network.
@main
struct TeakWidgetsBundle: WidgetBundle {
    init() {
        // The app group keeps Teak's language; read it as this process starts.
        AppLanguage.reload()
    }

    var body: some Widget {
        QuickCaptureWidget()
        FavoritesWidget()
        NewNoteControl()
        VoiceMemoControl()
        ChoosePhotosControl()
        #if os(iOS)
        TakePhotoControl()
        #endif
        UploadFilesControl()
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

struct ChoosePhotosControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.praveenjuge.teak.widgets.photos") {
            ControlWidgetButton(action: ChoosePhotosIntent()) {
                Label(tr("apple.controls.photos"), systemImage: "photo.on.rectangle")
            }
            .tint(Color("AccentColor"))
        }
        .displayName(catalogResource("apple.controls.photos"))
        .description(catalogResource("apple.controls.photosDescription"))
    }
}

#if os(iOS)
struct TakePhotoControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.praveenjuge.teak.widgets.camera") {
            ControlWidgetButton(action: TakePhotoIntent()) {
                Label(tr("apple.controls.camera"), systemImage: "camera")
            }
            .tint(Color("AccentColor"))
        }
        .displayName(catalogResource("apple.controls.camera"))
        .description(catalogResource("apple.controls.cameraDescription"))
    }
}
#endif

struct UploadFilesControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.praveenjuge.teak.widgets.files") {
            ControlWidgetButton(action: UploadFilesIntent()) {
                Label(tr("apple.controls.files"), systemImage: "folder")
            }
            .tint(Color("AccentColor"))
        }
        .displayName(catalogResource("apple.controls.files"))
        .description(catalogResource("apple.controls.filesDescription"))
    }
}

/// Catalog text, in Teak's language, where WidgetKit takes a `LocalizedStringResource`.
/// The extension's bundle has no entry for the translated text, so it shows as it is.
private func catalogResource(_ key: String) -> LocalizedStringResource {
    LocalizedStringResource(String.LocalizationValue(tr(key)))
}
