import Foundation

struct AppConfig {
    let webBaseURL: URL
    let convexURL: String
    let convexSiteURL: URL

    private static let productionWebURL = "http://app.teak.localhost:1355"
    private static let productionConvexURL = "https://reminiscent-kangaroo-59.convex.cloud"
    private static let productionConvexSiteURL = "https://reminiscent-kangaroo-59.convex.site"

    nonisolated static let current = AppConfig(
        webBaseURL: Self.resolveURL(
            envKey: "TEAK_WEB_URL",
            infoKey: "TeakWebURL",
            fallback: productionWebURL
        ),
        convexURL: Self.resolveString(
            envKey: "TEAK_CONVEX_URL",
            infoKey: "TeakConvexURL",
            fallback: productionConvexURL
        ),
        convexSiteURL: Self.resolveURL(
            envKey: "TEAK_CONVEX_SITE_URL",
            infoKey: "TeakConvexSiteURL",
            fallback: productionConvexSiteURL
        )
    )

    func buildWebURL(path: String, queryItems: [URLQueryItem] = []) -> URL {
        var components = URLComponents(url: webBaseURL, resolvingAgainstBaseURL: false)
        components?.path = path
        components?.queryItems = queryItems.isEmpty ? nil : queryItems
        return components?.url ?? webBaseURL
    }

    private static func resolveString(
        envKey: String,
        infoKey: String,
        fallback: String
    ) -> String {
        let environment = ProcessInfo.processInfo.environment[envKey]?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let environment, !environment.isEmpty {
            return environment
        }

        let infoValue = Bundle.main.object(forInfoDictionaryKey: infoKey) as? String
        let trimmed = infoValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed! : fallback
    }

    private static func resolveURL(
        envKey: String,
        infoKey: String,
        fallback: String
    ) -> URL {
        let rawValue = resolveString(envKey: envKey, infoKey: infoKey, fallback: fallback)
        guard let url = URL(string: rawValue) else {
            fatalError("Invalid URL for \(infoKey)")
        }
        return normalized(url)
    }

    private static func normalized(_ url: URL) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url ?? url
    }
}
