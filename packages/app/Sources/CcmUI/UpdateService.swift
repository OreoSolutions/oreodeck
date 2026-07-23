import Foundation

public struct OreoUpdateRelease: Sendable, Equatable {
    public let version: String
    public let url: URL
}

public enum OreoUpdateService {
    private struct GitHubRelease: Decodable {
        let tag_name: String
        let html_url: URL
    }

    public static func newerVersion(
        currentVersion: String,
        session: URLSession = .shared
    ) async throws -> OreoUpdateRelease? {
        let url = URL(string: "https://api.github.com/repos/OreoSolutions/oreodeck/releases/latest")!
        var request = URLRequest(url: url)
        request.timeoutInterval = 4
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("OreoDeck/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
        let release = try JSONDecoder().decode(GitHubRelease.self, from: data)
        let version = release.tag_name.hasPrefix("v") ? String(release.tag_name.dropFirst()) : release.tag_name
        guard compare(version, currentVersion) == .orderedDescending else { return nil }
        return OreoUpdateRelease(version: version, url: release.html_url)
    }

    static func compare(_ left: String, _ right: String) -> ComparisonResult {
        let lhs = left.split(separator: ".").map { Int($0) ?? 0 }
        let rhs = right.split(separator: ".").map { Int($0) ?? 0 }
        for index in 0..<max(lhs.count, rhs.count) {
            let a = index < lhs.count ? lhs[index] : 0
            let b = index < rhs.count ? rhs[index] : 0
            if a < b { return .orderedAscending }
            if a > b { return .orderedDescending }
        }
        return .orderedSame
    }
}
