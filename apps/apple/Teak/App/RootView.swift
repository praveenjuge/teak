import PhotosUI
import SwiftUI
import TeakCore

/// Loading, offline, sign-in or the app, depending on the session.
struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openWindow) private var openWindow
    #if os(macOS)
    @Environment(\.openSettings) private var openSettings
    #endif

    var body: some View {
        Group {
            switch app.phase {
            case .loading: LoadingView()
            case .offline: OfflineView(retry: app.retryConnection)
            case let .failed(message): FailedView(message: message, retry: app.retryConfiguration)
            case .signedOut: WelcomeView()
            case .signedIn: MainView()
            }
        }
        .animation(.smooth, value: app.phase)
        .task {
            app.start()
            AppServices.shared.openMainWindow = { openWindow(id: "main") }
            #if os(macOS)
            AppServices.shared.openSettingsWindow = { openSettings() }
            #endif
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { app.becameActive() }
        }
        .onOpenURL { router.handle($0) }
        .sheet(item: Bindable(router).saveRequest) { request in
            SaveRequestView(text: request.text)
        }
    }
}

/// Home, Favorites, Trash, Add and Settings: a tab bar on iPhone and a sidebar on iPad and Mac.
struct MainView: View {
    @Environment(AppRouter.self) private var router
    @Environment(CaptureModel.self) private var capture
    @Namespace private var namespace

    /// Add stands apart from the other tabs where the system supports it.
    private var addRole: TabRole? {
        if #available(iOS 27, macOS 27, *) { .prominent } else { nil }
    }

    var body: some View {
        @Bindable var router = router
        let services = AppServices.shared
        TabView(selection: $router.tab) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                LibraryTab(library: services.home, path: $router.homePath, namespace: namespace)
            }
            Tab("Add", systemImage: "plus.circle", value: AppTab.add, role: addRole) {
                NavigationStack { AddView() }
            }
            #if os(iOS)
            Tab("Settings", systemImage: "gearshape", value: AppTab.settings) {
                NavigationStack { SettingsView() }
            }
            #endif
        }
        .tabViewStyle(.sidebarAdaptable)
        #if os(iOS)
        .tabBarMinimizeBehavior(.onScrollDown)
        #endif
        .sheet(isPresented: $router.isComposing) { NoteComposerView() }
        .sheet(isPresented: $router.isRecording) { VoiceMemoView() }
        .fileImporter(isPresented: $router.isImportingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case let .success(urls) = result { Task { await capture.uploadPicked(urls) } }
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $router.isUsingCamera) {
            CameraPicker { url in Task { await capture.upload([await CaptureModel.describe(url)]) } }
                .ignoresSafeArea()
        }
        #endif
        .alert(capture.alert?.title ?? "", isPresented: Binding(get: { capture.alert != nil }, set: { if !$0 { capture.alert = nil } }),
               presenting: capture.alert) { alert in
            #if os(macOS)
            if alert.isCardLimit {
                Button("Upgrade…") { NSWorkspace.shared.open(AppServices.shared.app.config.webURL.appending(path: "settings")) }
            }
            #endif
            Button("OK", role: .cancel) {}
        } message: { alert in
            Text(alert.message)
        }
        .sensoryFeedback(.success, trigger: capture.savedCount)
        .overlay(alignment: .top) {
            if let upload = capture.upload {
                Label("Saving \(min(upload.done + 1, upload.total)) of \(upload.total)…", systemImage: "arrow.up.circle")
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.smooth, value: capture.upload?.done)
    }
}

/// One library in a navigation stack, opening cards with a zoom.
struct LibraryTab: View {
    let library: LibraryModel
    @Binding var path: [CardRoute]
    let namespace: Namespace.ID
    @Environment(CaptureModel.self) private var capture
    @Environment(AppRouter.self) private var router
    @State private var isDropTargeted = false

    var body: some View {
        NavigationStack(path: $path) {
            LibraryView(library: library, namespace: namespace)
                .navigationDestination(for: CardRoute.self) { route in
                    CardDetailView(route: route)
                        #if os(iOS)
                        .navigationTransition(.zoom(sourceID: route.id, in: namespace))
                        #endif
                }
        }
        .environment(\.filterLibrary, LibraryFilterAction(
            tag: { tag in
                path.removeAll()
                library.filterByTag(tag)
            },
            type: { type in
                path.removeAll()
                library.filterByType(type)
            }))
        .onDrop(of: [.fileURL, .image, .movie, .audio, .pdf, .url, .plainText, .data], isTargeted: $isDropTargeted) { providers in
            Task { await capture.save(providers) }
            return true
        }
        .overlay {
            if isDropTargeted {
                ZStack {
                    Rectangle().fill(.tint.opacity(0.08))
                    Label("Drop files to upload", systemImage: "arrow.down.doc")
                        .font(.title3.weight(.semibold))
                        .padding(.horizontal, 20)
                        .padding(.vertical, 14)
                        .glassEffect(.regular, in: .capsule)
                }
                .ignoresSafeArea()
                .allowsHitTesting(false)
            }
        }
        #if os(macOS)
        .onPasteCommand(of: [.fileURL, .image, .url, .plainText]) { providers in
            Task { await capture.save(providers) }
        }
        #endif
    }
}

/// `teak://save?text=…` from Shortcuts and other automation apps.
struct SaveRequestView: View {
    let text: String
    @Environment(AppModel.self) private var app
    @Environment(CaptureModel.self) private var capture
    @Environment(\.dismiss) private var dismiss
    @State private var status: Status = .saving

    enum Status { case saving, saved, empty, signedOut, failed }

    var body: some View {
        VStack(spacing: 20) {
            switch status {
            case .saving: state("Saving", "Saving to your Teak vault…", "arrow.down.circle")
            case .saved: state("Saved", "It's in your library.", "checkmark.circle.fill")
            case .empty: state("Nothing to Save", "The shortcut didn't send any text or link.", "tray")
            case .signedOut: state("Sign In Required", "Open Teak and sign in, then run the shortcut again.",
                                   "person.crop.circle.badge.exclamationmark")
            case .failed: state("Save Failed", "Check your connection and try again.", "xmark.circle")
            }
            if status != .saving && status != .saved {
                Button("Close") { dismiss() }
                    .buttonStyle(.glass)
                    .controlSize(.large)
            }
        }
        .padding(24)
        .presentationDetents([.fraction(0.4)])
        .sensoryFeedback(trigger: status) { _, status in
            switch status {
            case .saved: .success
            case .failed, .signedOut: .error
            default: nil
            }
        }
        .task { await save() }
    }

    private func state(_ title: String, _ message: String, _ symbol: String) -> some View {
        ContentUnavailableView(title, systemImage: symbol, description: Text(message))
    }

    private func save() async {
        guard !text.isEmpty else { return status = .empty }
        guard app.user != nil else { return status = .signedOut }
        if await capture.saveText(text) != nil {
            status = .saved
            try? await Task.sleep(for: .seconds(1.2))
            dismiss()
        } else {
            capture.alert = nil
            status = .failed
        }
    }
}
