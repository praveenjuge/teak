import SwiftUI
import TeakCore

@MainActor
final class AppServices {
    static let shared = AppServices()

    let app: AppModel
    let router = AppRouter()
    let capture: CaptureModel
    let home: LibraryModel
    /// iPhone's Folders tab shows a folder's cards without changing Home.
    let folderLibrary: LibraryModel
    let folders: FoldersModel
    let tags: TagsModel
    let language = LanguageModel()
    var openMainWindow: (() -> Void)?
    var openSettingsWindow: (() -> Void)?

    private init() {
        PostHogReporting.start()
        app = AppModel()
        capture = CaptureModel(backend: app.backend)
        home = LibraryModel(backend: app.backend)
        folderLibrary = LibraryModel(backend: app.backend)
        folders = FoldersModel(backend: app.backend)
        tags = TagsModel(backend: app.backend)
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
}

@main
struct TeakApp: App {
    #if os(macOS)
    @NSApplicationDelegateAdaptor(MacAppDelegate.self) private var delegate
    #endif
    private let services = AppServices.shared
    @AppStorage("teak.appearance") private var appearance = Appearance.auto

    var body: some Scene {
        WindowGroup("Teak", id: "main") {
            RootView()
                .environments(services)
                .preferredColorScheme(appearance.colorScheme)
        }
        .commands { TeakCommands(services: services) }
        #if os(macOS)
        .windowResizability(.contentSize)
        #endif

        #if os(macOS)
        // A card's image at full size, zoomable, beside the main window.
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

        Settings {
            MacSettingsView()
                .environments(services)
                .preferredColorScheme(appearance.colorScheme)
        }
        #endif
    }
}

extension View {
    /// The app's models, and its language for formatting. Text read with `tr`
    /// updates in place when the language changes, so drafts being typed survive.
    func environments(_ services: AppServices) -> some View {
        environment(services.app)
            .environment(services.router)
            .environment(services.capture)
            .environment(services.language)
            .environment(\.locale, services.language.locale)
            .fontDesign(.rounded)
    }
}
