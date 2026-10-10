import SwiftUI
import TeakCore

/// The objects every scene, menu and system integration shares.
@MainActor
final class AppServices {
    static let shared = AppServices()

    let app: AppModel
    let router = AppRouter()
    let capture: CaptureModel
    let home: LibraryModel
    var openMainWindow: (() -> Void)?
    var openSettingsWindow: (() -> Void)?

    private init() {
        SentryReporting.start()
        app = AppModel()
        capture = CaptureModel(backend: app.backend)
        home = LibraryModel(backend: app.backend)
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
        .defaultSize(width: 1100, height: 760)
        #endif

        #if os(macOS)
        Settings {
            NavigationStack { SettingsView() }
                .environments(services)
                .preferredColorScheme(appearance.colorScheme)
                .frame(minWidth: 460, idealWidth: 520, minHeight: 520)
        }
        #endif
    }
}

extension View {
    func environments(_ services: AppServices) -> some View {
        environment(services.app)
            .environment(services.router)
            .environment(services.capture)
            .fontDesign(.rounded)
    }
}
