import PhotosUI
import SwiftUI
import TeakCore

struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(AppRouter.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openWindow) private var openWindow
    #if os(macOS)
    @Environment(\.openSettings) private var openSettings
    #endif

    private var isSignedIn: Bool { app.phase == .signedIn }

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
        #if os(macOS)
        .frame(minWidth: isSignedIn ? 760 : 420, maxWidth: isSignedIn ? .infinity : 420,
               minHeight: isSignedIn ? 520 : 560, maxHeight: isSignedIn ? .infinity : 560)
        .onChange(of: isSignedIn) { _, signedIn in
            if signedIn { MainWindow.growToLibrarySize() }
        }
        #endif
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

struct MainView: View {
    @Environment(AppRouter.self) private var router
    @Environment(CaptureModel.self) private var capture
    @Namespace private var namespace
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    #if os(iOS)
    private var addRole: TabRole? {
        if #available(iOS 27, *) { .prominent } else { nil }
    }
    #endif

    @ViewBuilder private var content: some View {
        #if os(macOS)
        SidebarMainView(namespace: namespace)
        #else
        if sizeClass == .regular {
            SidebarMainView(namespace: namespace)
        } else {
            tabs
        }
        #endif
    }

    #if os(iOS)
    @ViewBuilder private var tabs: some View {
        @Bindable var router = router
        let services = AppServices.shared
        TabView(selection: $router.tab) {
            Tab(tr("native.filters.home"), systemImage: "house", value: AppTab.home) {
                LibraryTab(library: services.home, path: $router.homePath, namespace: namespace)
            }
            Tab(tr("native.folders.title"), systemImage: "folder", value: AppTab.folders) {
                FoldersTab(namespace: namespace)
            }
            Tab(tr("native.app.nav.add"), systemImage: "plus.circle", value: AppTab.add, role: addRole) {
                NavigationStack { AddView() }
            }
            Tab(tr("native.settings.title"), systemImage: "gearshape", value: AppTab.settings) {
                NavigationStack { SettingsView() }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
    }
    #endif

    var body: some View {
        @Bindable var router = router
        content
        #if os(iOS)
        .tabBarMinimizeBehavior(.onScrollDown)
        #endif
        .task { AppServices.shared.folders.start() }
        .task { await AppServices.shared.language.watch(AppServices.shared.app.backend) }
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
                Button(tr("native.app.upgrade")) { NSWorkspace.shared.open(AppServices.shared.app.config.webURL.appending(path: "settings")) }
            }
            #endif
            Button(tr("native.app.ok"), role: .cancel) {}
        } message: { alert in
            Text(alert.message)
        }
        .sensoryFeedback(.success, trigger: capture.savedCount)
        .overlay(alignment: .top) {
            if let upload = capture.upload {
                Label(tr("native.app.uploadProgress", localizedNumber(min(upload.done + 1, upload.total)), localizedNumber(upload.total)),
                      systemImage: "arrow.up.circle")
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
                    Label(tr("native.app.dropFiles"), systemImage: "arrow.down.doc")
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
            case .saving: state(tr("native.app.saveRequest.savingTitle"), tr("native.app.saveRequest.savingMessage"), "arrow.down.circle")
            case .saved: state(tr("native.capture.saved"), tr("native.share.savedMessage"), "checkmark.circle.fill")
            case .empty: state(tr("native.share.nothingToSave"), tr("native.app.saveRequest.emptyMessage"), "tray")
            case .signedOut: state(tr("native.share.signInRequired"), tr("native.app.saveRequest.signedOutMessage"),
                                   "person.crop.circle.badge.exclamationmark")
            case .failed: state(tr("native.app.saveRequest.failedTitle"), tr("native.errors.offline"), "xmark.circle")
            }
            if status != .saving && status != .saved {
                Button(tr("common.close")) { dismiss() }
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
