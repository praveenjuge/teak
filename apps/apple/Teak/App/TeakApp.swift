import SwiftUI
import TeakCore

@MainActor
final class AppServices {
    static let shared = AppServices()

    let app: AppModel
    let router = AppRouter()
    let capture: CaptureModel
    let home: LibraryModel
    let folderLibrary: LibraryModel
    let folders: FoldersModel
    let tags: TagsModel
    let language = LanguageModel()
    var openMainWindow: (() -> Void)?
    var openSettingsWindow: (() -> Void)?
    var openVoiceMemoWindow: (() -> Void)?

    private init() {
        PostHogReporting.start()
        // Nothing uploads or shares yet, so files a past run left behind can go.
        for folder in [ItemProviders.uploadsFolder, CardFiles.sharedFolder] {
            try? FileManager.default.removeItem(at: folder)
        }
        app = AppModel()
        capture = CaptureModel(backend: app.backend)
        home = LibraryModel(backend: app.backend, spotlight: app.spotlight)
        folderLibrary = LibraryModel(backend: app.backend, spotlight: app.spotlight)
        folders = FoldersModel(backend: app.backend)
        tags = TagsModel(backend: app.backend)
        app.onSignedOut = { [unowned self] in self.resetForNextUser() }
    }

    private func resetForNextUser() {
        router.reset()
        capture.reset()
        tags.reset()
        for library in [home, folderLibrary] {
            library.endSelection()
            library.clearFilters()
        }
        #if os(macOS)
        UserDefaults.standard.removeObject(forKey: MacPreferences.quickCaptureDraftKey)
        #endif
    }

    func showMainWindow() {
        #if os(macOS)
        NSApp.activate()
        #endif
        openMainWindow?()
    }

    func showSettings() {
        #if os(macOS)
        NSApp.activate()
        openSettingsWindow?()
        #else
        router.tab = .settings
        #endif
    }

    #if os(macOS)
    func showVoiceMemo() {
        NSApp.activate()
        openVoiceMemoWindow?()
    }
    #endif
}

@main
struct TeakApp: App {
    #if os(macOS)
    @NSApplicationDelegateAdaptor(MacAppDelegate.self) private var delegate
    #endif
    private let services = AppServices.shared
    @AppStorage("teak.appearance") private var appearance = Appearance.auto

    var body: some Scene {
        #if os(macOS)
        // One library window: its sheets follow the app-wide router, so a
        // second window would show (and save) each sheet twice.
        Window("Teak", id: "main") { mainWindow }
            .commands { TeakCommands(services: services) }
            .windowResizability(.contentSize)
        #else
        WindowGroup("Teak", id: "main") { mainWindow }
            .commands { TeakCommands(services: services) }
        #endif

        #if os(macOS)
        WindowGroup(id: ImageWindow.id, for: ImageViewerItem.self) { $item in
            if let item {
                ImageWindow(item: item)
                    .environments(services)
                    .preferredColorScheme(appearance.colorScheme)
            }
        }
        .defaultSize(width: 900, height: 700)
        .commandsRemoved()
        // File addresses expire, so an image window isn't reopened at the next launch.
        .restorationBehavior(.disabled)

        Window(tr("native.capture.voiceMemo"), id: VoiceMemoView.windowID) {
            VoiceMemoView()
                .environments(services)
                .preferredColorScheme(appearance.colorScheme)
        }
        .windowLevel(.floating)
        .windowResizability(.contentSize)
        .defaultPosition(.center)
        .commandsRemoved()
        .restorationBehavior(.disabled)

        Settings {
            MacSettingsView()
                .environments(services)
                .preferredColorScheme(appearance.colorScheme)
        }
        #endif
    }

    private var mainWindow: some View {
        RootView()
            .environments(services)
            .preferredColorScheme(appearance.colorScheme)
    }
}

extension View {
    func environments(_ services: AppServices) -> some View {
        environment(services.app)
            .environment(services.router)
            .environment(services.capture)
            .environment(services.language)
            .environment(\.locale, services.language.locale)
            .fontDesign(.rounded)
    }
}
