import CcmKit
import Testing
import ViewInspector

@testable import CcmUI

// Not the drag/bar-color pixel behavior — that has no automated equivalent
// (see the Task 4 brief and docs/manual-smoke-test.md) — but the text-level
// facts a regression can silently break: the empty state, the per-layer
// legend counts, and the cost/countdown copy for a zero-usage row.

@MainActor
@Test func usageTabEmptyStateRendersWhenThereAreNoProfiles() throws {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)

    let tab = UsageTab(model: model)
    let empty = try tab.inspect().find(text: "No profiles yet")
    #expect(try empty.string() == "No profiles yet")
}

@MainActor
@Test func aRowWithUsageRendersItsFiveLayerLegendAndTotals() async throws {
    let backend = FakeBackend()
    backend.set(
        profiles: [ProfileView(name: "work", kind: "api-key", active: true)],
        usage: [
            ProfileUsageView(
                profile: "work", kind: "api-key", inputTokens: 100, cacheWrite5mTokens: 10,
                cacheWrite1hTokens: 5, cacheReadTokens: 20, outputTokens: 65, totalTokens: 200,
                costUsd: 1.23, resetAtMs: nil)
        ])
    let model = AppModel(backend: backend)
    await model.load()

    let tab = UsageTab(model: model)
    #expect(try tab.inspect().find(text: "200 tokens").string() == "200 tokens")
    #expect(try tab.inspect().find(text: "$1.23").string() == "$1.23")
    #expect(try tab.inspect().find(text: "resets in —").string() == "resets in —")
    #expect(try tab.inspect().find(text: "Input 100").string() == "Input 100")
    #expect(try tab.inspect().find(text: "Cache write 5m 10").string() == "Cache write 5m 10")
    #expect(try tab.inspect().find(text: "Cache write 1h 5").string() == "Cache write 1h 5")
    #expect(try tab.inspect().find(text: "Cache read 20").string() == "Cache read 20")
    #expect(try tab.inspect().find(text: "Output 65").string() == "Output 65")
}

// Pins the Task 4 review's Important finding: a config-read failure
// (`loadError` set) was falling through to the generic "No profiles yet"
// empty state, which misleadingly tells the user to add a profile that may
// already exist and simply failed to read. Verified by hand: temporarily
// changing `if let loadError = model.loadError { LoadErrorView(...) }` in
// `UsageTab.body` to `if false, let loadError = ...` makes
// `aLoadErrorRendersDistinctlyAndNotTheEmptyStateInTheUsageTab` fail with
// ViewInspector's real "Search did not find a match".

@MainActor
@Test func aLoadErrorRendersDistinctlyAndNotTheEmptyStateInTheUsageTab() async throws {
    let backend = FakeBackend()
    backend.set(listError: .ConfigCorrupt)
    let model = AppModel(backend: backend)
    await model.load()
    #expect(model.loadError == .ConfigCorrupt)
    #expect(model.rows.isEmpty)

    let tab = UsageTab(model: model)
    let error = try tab.inspect().find(text: "OreoDeck can't read its config")
    #expect(try error.string() == "OreoDeck can't read its config")
    #expect(throws: (any Error).self) {
        try tab.inspect().find(text: "No profiles yet")
    }
}

@MainActor
@Test func aGenuinelyEmptySuccessfulLoadStillShowsTheEmptyStateInTheUsageTab() async throws {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)
    await model.load()
    #expect(model.loadError == nil)
    #expect(model.rows.isEmpty)

    let tab = UsageTab(model: model)
    let empty = try tab.inspect().find(text: "No profiles yet")
    #expect(try empty.string() == "No profiles yet")
}

@MainActor
@Test func aZeroUsageSubscriptionRowRendersDashesNotCrashesOrNaN() async throws {
    // Pins the "zero-usage profile must render sanely" requirement: a fresh
    // profile has totalTokens == 0, which would divide-by-zero in the bar's
    // width math if `UsageBar` did not guard it before this test was added.
    let backend = FakeBackend()
    backend.set(profiles: [ProfileView(name: "fresh", kind: "subscription", active: false)])
    let model = AppModel(backend: backend)
    await model.load()

    let tab = UsageTab(model: model)
    #expect(try tab.inspect().find(text: "0 tokens").string() == "0 tokens")
    #expect(try tab.inspect().find(text: "—").string() == "—")  // cost, subscription
    #expect(try tab.inspect().find(text: "resets in —").string() == "resets in —")
}
