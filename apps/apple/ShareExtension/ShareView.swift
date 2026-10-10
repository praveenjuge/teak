import Foundation
import Observation
import SwiftUI
import TeakCore

/// Saves what was shared straight to Teak, without opening the app.
@MainActor @Observable
final class ShareModel {
    enum Phase: Equatable {
        case saving
        case done(ShareImportResult)
        case empty
    }

    private(set) var phase: Phase = .saving
    private let providers: [NSItemProvider]

    init(providers: [NSItemProvider]) {
        self.providers = providers
    }

    func run() async {
        let items = await ItemProviders.load(providers, limit: TeakLimits.maxFilesPerUpload)
        guard !items.isEmpty else { return phase = .empty }
        let session = TeakServices.session()
        let user = try? await session.restore()
        let convex = TeakServices.http(session: session)
        let pipeline = UploadPipeline(convex: convex)
        let importer = ShareImporter(
            createText: { text in try await convex.mutation("cards:createCard", LinkDetection.resolve(text).createArgs) },
            upload: { item in try await pipeline.upload(item) })
        let result = await importer.importItems(items, isAuthenticated: user != nil)
        // A refresh can find the session revoked; that also needs a sign-in.
        if result.successfulItems == 0, await session.user == nil, user != nil {
            phase = .done(await importer.importItems(items, isAuthenticated: false))
        } else {
            phase = .done(result)
        }
    }
}

struct ShareView: View {
    let model: ShareModel
    let close: () -> Void
    let openApp: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            content
        }
        .padding(24)
        .frame(minWidth: 320, minHeight: 260)
        .fontDesign(.rounded)
        .task {
            await model.run()
            if case let .done(result) = model.phase, result.isComplete {
                try? await Task.sleep(for: .seconds(1.2))
                close()
            }
        }
        .sensoryFeedback(trigger: model.phase) { _, phase in
            guard case let .done(result) = phase else { return nil }
            return result.isComplete ? .success : .error
        }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .saving:
            ProgressView().controlSize(.large)
            Text("Saving to Teak…").foregroundStyle(.secondary)
        case .empty:
            ContentUnavailableView("Nothing to Save", systemImage: "tray",
                                   description: Text("Teak couldn't find text, a link or a file to save."))
            Button("Close", action: close).buttonStyle(.glass)
        case let .done(result):
            if result.needsSignIn {
                ContentUnavailableView("Sign In Required", systemImage: "person.crop.circle.badge.exclamationmark",
                                       description: Text("Open Teak and sign in, then share again."))
                HStack {
                    Button("Close", action: close).buttonStyle(.glass)
                    Button("Open Teak", action: openApp).buttonStyle(.glassProminent)
                }
            } else if result.isComplete {
                ContentUnavailableView("Saved", systemImage: "checkmark.circle.fill", description: Text(result.summary))
                    .symbolEffect(.bounce, value: result.successfulItems)
            } else {
                ContentUnavailableView(result.isPartial ? result.summary : "Couldn't Save",
                                       systemImage: result.isPartial ? "exclamationmark.circle" : "xmark.circle",
                                       description: Text(result.failures.first?.message ?? "Please try again."))
                Button("Close", action: close).buttonStyle(.glass)
            }
        }
    }
}
