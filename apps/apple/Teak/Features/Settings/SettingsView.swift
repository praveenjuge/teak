import SwiftUI
import TeakCore
import TeakSync

enum Appearance: String, CaseIterable, Identifiable {
    case auto, light, dark
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var colorScheme: ColorScheme? {
        switch self {
        case .auto: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// Appearance, account, Mac options and About.
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @AppStorage("teak.appearance") private var appearance = Appearance.auto
    @State private var account = AccountModel()

    var body: some View {
        Form {
            Section("Appearance") {
                Picker("Theme", selection: $appearance) {
                    ForEach(Appearance.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
            }
            AccountSection(account: account)
            #if os(macOS)
            MacOptionsSection()
            #endif
            SafariExtensionSection()
            AboutSection()
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .task { await account.watch(app.backend) }
    }
}

/// `auth:getCurrentUser`, live.
@MainActor @Observable
final class AccountModel {
    private(set) var user: CurrentUser?
    private(set) var isLoading = true

    func watch(_ backend: TeakBackend) async {
        while !Task.isCancelled {
            do {
                for try await value in backend.subscribe("auth:getCurrentUser", [:], as: CurrentUser?.self) {
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

private struct AccountSection: View {
    let account: AccountModel
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var confirmLogOut = false
    @State private var confirmDelete = false
    @State private var typingConfirmation = false
    @State private var confirmation = ""
    @State private var isWorking = false
    @State private var error: String?

    static let deletePhrase = "delete account"

    var body: some View {
        Section("Profile") {
            LabeledContent("Email", value: app.user?.email ?? account.user?.email ?? "Not logged in")
            LabeledContent("Usage") {
                if let user = account.user { Text(user.usageLabel) } else if account.isLoading { ProgressView().controlSize(.small) } else { Text("Not available") }
            }
            LabeledContent("Plan") {
                if let user = account.user { Text(user.plan) } else if account.isLoading { ProgressView().controlSize(.small) } else { Text("Not available") }
            }
            #if os(macOS)
            if let user = account.user {
                Button(user.hasPremium ? "Manage…" : "Upgrade…") { openURL(app.config.webURL.appending(path: "settings")) }
            }
            #endif
            Button(isWorking ? "Deleting…" : "Delete Account", role: .destructive) {
                if app.authMode?.accountChangesPaused == true {
                    error = TeakMessages.accountChangesPaused
                } else {
                    confirmDelete = true
                }
            }
            .disabled(isWorking || app.authMode?.accountChangesPaused == true)
            if app.authMode?.accountChangesPaused == true {
                Text(TeakMessages.accountChangesPaused).font(.footnote).foregroundStyle(.secondary)
            }
            Button("Log Out") { confirmLogOut = true }
                .tint(.primary)
                .accessibilityIdentifier("settings.logOut")
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
        .confirmationDialog("Log Out", isPresented: $confirmLogOut) {
            Button("Log Out", role: .destructive) { logOut() }
        } message: {
            Text("Are you sure you want to log out?")
        }
        .confirmationDialog("Delete Account", isPresented: $confirmDelete) {
            Button("Delete Account", role: .destructive) { typingConfirmation = true }
        } message: {
            Text("This will permanently remove your account, cards, tags, and uploaded files. Are you sure?")
        }
        .alert("Delete Account", isPresented: $typingConfirmation) {
            TextField(Self.deletePhrase, text: $confirmation)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
            Button("Cancel", role: .cancel) { confirmation = "" }
            Button("Delete", role: .destructive) { deleteAccount() }
        } message: {
            Text("Type \u{201C}\(Self.deletePhrase)\u{201D} to confirm.")
        }
    }

    private func logOut() {
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
            error = "Type \u{201C}\(Self.deletePhrase)\u{201D} to confirm."
            return
        }
        isWorking = true
        error = nil
        Task {
            defer { isWorking = false }
            do {
                try await app.deleteAccount()
            } catch let failure as TeakError where failure.message == TeakMessages.accountChangesPaused {
                error = failure.message
            } catch {
                self.error = "Something went wrong while deleting your account."
            }
        }
    }
}

private struct AboutSection: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Section("About") {
            LabeledContent("Teak", value: "by @praveenjuge")
            Text("Hope you enjoy using Teak as much as I enjoyed creating it.")
                .foregroundStyle(.secondary)
            LabeledContent("Version", value: "\(app.config.version) (\(app.config.build))")
        }
    }
}
