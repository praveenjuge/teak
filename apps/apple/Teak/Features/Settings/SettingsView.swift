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
            ProfileSection(account: account)
            AppearanceSection()
            LanguageSection()
            #if os(iOS)
            if sizeClass == .compact { LibrarySection() }
            #endif
            SafariExtensionSection()
            AboutSection()
            AccountActions()
        }
        .formStyle(.grouped)
        .navigationTitle(tr("native.settings.title"))
        .task { await account.watch(app.backend) }
    }
}

#if os(iOS)
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

struct ProfileSection: View {
    let account: AccountModel
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL

    var body: some View {
        Section(tr("native.settings.profile")) {
            LabeledContent(tr("native.settings.email")) {
                Text(app.user?.email ?? account.user?.email ?? tr("native.settings.notSignedIn"))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
            LabeledContent(tr("native.settings.plan")) {
                HStack(spacing: 12) {
                    value(account.user.map(AccountText.plan))
                    #if os(macOS)
                    if let user = account.user {
                        Button(user.hasPremium ? tr("native.settings.manage") : tr("native.app.upgrade")) {
                            openURL(app.config.planURL)
                        }
                    }
                    #endif
                }
            }
            LabeledContent(tr("native.settings.usage")) { value(account.user.map(AccountText.usage)) }
        }
    }

    @ViewBuilder private func value(_ text: String?) -> some View {
        if let text {
            Text(text)
        } else if account.isLoading {
            ProgressView().controlSize(.small)
        } else {
            Text(tr("native.settings.notAvailable"))
        }
    }
}

struct AccountActions: View {
    @Environment(AppModel.self) private var app
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var typingConfirmation = false
    @State private var confirmation = ""
    @State private var isWorking = false
    @State private var error: String?

    var body: some View {
        Group {
            Section {
                Button(tr("native.settings.signOut")) { confirmSignOut = true }
                    .tint(.primary)
                    .accessibilityIdentifier("settings.logOut")
            } footer: {
                if let error { Text(error).foregroundStyle(.red) }
            }
            Section {
                Button(isWorking ? tr("native.settings.deleting") : tr("native.settings.deleteAccount"), role: .destructive) {
                    confirmDelete = true
                }
                .disabled(isWorking)
            }
        }
        .disabled(app.user == nil)
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
            TextField(AccountText.deletePhrase, text: $confirmation)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
            Button(tr("common.cancel"), role: .cancel) { confirmation = "" }
            Button(tr("native.actions.deleteForever"), role: .destructive) { deleteAccount() }
        } message: {
            Text(tr("native.settings.typeToConfirm", AccountText.deletePhrase))
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
        guard typed == AccountText.deletePhrase else {
            error = tr("native.settings.typeToConfirm", AccountText.deletePhrase)
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

enum AccountText {
    /// What the person types to delete their account. It stays English in every language.
    static let deletePhrase = "delete account"

    static func usage(_ user: CurrentUser) -> String {
        let count = Int(user.cardCount)
        guard !user.hasPremium else { return tr("native.common.cardCount", count: count) }
        let locale = AppLanguage.locale
        return tr("native.settings.usageFree", count.formatted(.number.locale(locale)),
                  TeakLimits.freeTierCards.formatted(.number.locale(locale)))
    }

    static func plan(_ user: CurrentUser) -> String {
        user.hasPremium ? "Pro" : tr("native.card.plan.free")
    }
}

private struct AboutSection: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Section {
            LabeledContent(tr("native.settings.version"), value: "\(app.config.version) (\(app.config.build))")
        } header: {
            Text(tr("native.settings.about"))
        } footer: {
            Text(tr("native.settings.hope") + "\n" + tr("native.settings.byAuthor", "@praveenjuge"))
        }
    }
}
