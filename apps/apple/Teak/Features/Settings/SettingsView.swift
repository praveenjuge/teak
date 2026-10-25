import SwiftUI
import TeakCore
import TeakSync

enum Appearance: String, CaseIterable, Identifiable {
    case auto, light, dark
    var id: String { rawValue }
    var title: String {
        switch self {
        case .auto: tr("native.settings.themeAuto")
        case .light: tr("native.settings.themeLight")
        case .dark: tr("native.settings.themeDark")
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .auto: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var account = AccountModel()
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        Form {
            #if os(iOS)
            if sizeClass == .compact { LibrarySection() }
            #endif
            AppearanceSection()
            LanguageSection()
            AccountSection(account: account)
            SafariExtensionSection()
            AboutSection()
        }
        .formStyle(.grouped)
        .navigationTitle(tr("native.settings.title"))
        .task { await account.watch(app.backend) }
    }
}

#if os(iOS)
/// iPhone's way to the tag manager; the iPad and Mac have it in the sidebar.
struct LibrarySection: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        Section(tr("native.settings.library")) {
            NavigationLink {
                TagsView(model: AppServices.shared.tags) { tag in
                    let library = AppServices.shared.home
                    library.open(nil)
                    library.filterByTag(tag)
                    router.homePath = []
                    router.tab = .home
                }
            } label: {
                Label(tr("native.tags.title"), systemImage: "number")
            }
            .accessibilityIdentifier("settings.tags")
        }
    }
}
#endif

struct AppearanceSection: View {
    @AppStorage("teak.appearance") private var appearance = Appearance.auto

    var body: some View {
        Section(tr("native.settings.appearance")) {
            Picker(tr("native.settings.theme"), selection: $appearance) {
                ForEach(Appearance.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
        }
    }
}

@MainActor @Observable
final class AccountModel {
    private(set) var user: CurrentUser?
    private(set) var isLoading = true

    func watch(_ backend: TeakBackend) async {
        while !Task.isCancelled {
            do {
                for try await value in backend.subscribe(ConvexFunctions.getCurrentUser) {
                    user = value
                    isLoading = false
                }
            } catch {
                isLoading = false
            }
            try? await Task.sleep(for: .seconds(3))
        }
    }
}

struct AccountSection: View {
    let account: AccountModel
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var typingConfirmation = false
    @State private var confirmation = ""
    @State private var isWorking = false
    @State private var error: String?

    /// What the person types to delete their account. It stays English in every language.
    static let deletePhrase = "delete account"

    var body: some View {
        Group {
            Section(tr("native.settings.profile")) {
                LabeledContent(tr("native.settings.email"),
                               value: app.user?.email ?? account.user?.email ?? tr("native.settings.notSignedIn"))
                LabeledContent(tr("native.settings.usage")) {
                    if let user = account.user { Text(Self.usage(user)) } else if account.isLoading { ProgressView().controlSize(.small) } else { Text(tr("native.settings.notAvailable")) }
                }
                LabeledContent(tr("native.settings.plan")) {
                    HStack(spacing: 12) {
                        if let user = account.user { Text(Self.plan(user)) } else if account.isLoading { ProgressView().controlSize(.small) } else { Text(tr("native.settings.notAvailable")) }
                        #if os(macOS)
                        if let user = account.user {
                            Button(user.hasPremium ? tr("native.settings.manage") : tr("native.app.upgrade")) {
                                openURL(app.config.webURL.appending(path: "settings"))
                            }
                        }
                        #endif
                    }
                }
                #if os(iOS)
                deleteButton
                signOutButton
                errorText
                #endif
            }
            #if os(macOS)
            Section {
                HStack {
                    deleteButton
                    Spacer()
                    signOutButton
                }
                errorText
            }
            #endif
        }
        .confirmationDialog(tr("native.settings.signOut"), isPresented: $confirmSignOut) {
            Button(tr("native.settings.signOut"), role: .destructive) { signOut() }
        } message: {
            Text(tr("native.settings.signOutConfirm"))
        }
        .confirmationDialog(tr("native.settings.deleteAccount"), isPresented: $confirmDelete) {
            Button(tr("native.settings.deleteAccount"), role: .destructive) { typingConfirmation = true }
        } message: {
            Text(tr("native.settings.deleteWarning"))
        }
        .alert(tr("native.settings.deleteAccount"), isPresented: $typingConfirmation) {
            TextField(Self.deletePhrase, text: $confirmation)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
            Button(tr("common.cancel"), role: .cancel) { confirmation = "" }
            Button(tr("native.actions.deleteForever"), role: .destructive) { deleteAccount() }
        } message: {
            Text(tr("native.settings.typeToConfirm", Self.deletePhrase))
        }
    }

    /// "12 cards", or "12 of 200 cards" on the Free plan.
    static func usage(_ user: CurrentUser) -> String {
        let count = Int(user.cardCount)
        guard !user.hasPremium else { return tr("native.common.cardCount", count: count) }
        let locale = AppLanguage.locale
        return tr("native.settings.usageFree", count.formatted(.number.locale(locale)),
                  TeakLimits.freeTierCards.formatted(.number.locale(locale)))
    }

    /// "Pro" is a name, so it stays as it is.
    static func plan(_ user: CurrentUser) -> String {
        user.hasPremium ? "Pro" : tr("native.card.plan.free")
    }

    private var deleteButton: some View {
        Button(isWorking ? tr("native.settings.deleting") : tr("native.settings.deleteAccount"), role: .destructive) {
            confirmDelete = true
        }
        .disabled(isWorking)
    }

    private var signOutButton: some View {
        Button(tr("native.settings.signOut")) { confirmSignOut = true }
            .tint(.primary)
            .accessibilityIdentifier("settings.logOut")
    }

    @ViewBuilder private var errorText: some View {
        if let error {
            Text(error).font(.footnote).foregroundStyle(.red)
        }
    }

    private func signOut() {
        error = nil
        Task {
            do {
                try await app.signOut()
            } catch {
                self.error = error.teakMessage
            }
        }
    }

    private func deleteAccount() {
        let typed = confirmation.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        confirmation = ""
        guard typed == Self.deletePhrase else {
            error = tr("native.settings.typeToConfirm", Self.deletePhrase)
            return
        }
        isWorking = true
        error = nil
        Task {
            defer { isWorking = false }
            do {
                try await app.deleteAccount()
            } catch {
                self.error = tr("native.settings.deleteFailed")
            }
        }
    }
}

private struct AboutSection: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Section(tr("native.settings.about")) {
            // The app's name and the author's handle stay as they are in every language.
            LabeledContent {
                Text(verbatim: "by @praveenjuge")
            } label: {
                Text(verbatim: "Teak")
            }
            Text(tr("native.settings.hope"))
                .foregroundStyle(.secondary)
            LabeledContent(tr("native.settings.version"), value: "\(app.config.version) (\(app.config.build))")
        }
    }
}
