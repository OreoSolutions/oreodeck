import CcmKit
import Testing

@testable import CcmUI

@MainActor
@Test func loadPopulatesRowsFailoverAndCliStatus() async {
    let backend = FakeBackend()
    backend.set(profiles: [ProfileView(name: "work", kind: "subscription", active: true)])
    backend.set(failover: FailoverView(enabled: false, order: ["work"]))
    backend.set(cliInstalled: false)
    let model = AppModel(backend: backend)

    await model.load()

    #expect(model.rows.map(\.name) == ["work"])
    #expect(model.failover.enabled == false)
    #expect(model.cliMissing)
    #expect(model.loadError == nil)
}

@MainActor
@Test func tickDoesNothingWhileNoSurfaceIsOnScreen() async {
    // The 30s refresh must be gated on the popover/tab actually being visible
    // (spec §3) — an invisible menu-bar agent has no business walking every
    // transcript on disk every 30 seconds.
    let backend = FakeBackend()
    let model = AppModel(backend: backend)

    await model.tick()
    await model.tick()

    #expect(model.loadCount == 0)
    #expect(backend.listCallCount == 0)
}

@MainActor
@Test func tickRefreshesOnlyWhileASurfaceIsOnScreen() async {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)

    await model.surfaceAppeared(.popover)  // loads immediately
    #expect(model.loadCount == 1)

    await model.tick()
    #expect(model.loadCount == 2)

    model.surfaceDisappeared(.popover)
    await model.tick()
    #expect(model.loadCount == 2, "refresh must stop the moment the surface goes away")
}

@MainActor
@Test func refreshKeepsRunningWhileAnyOtherSurfaceIsStillOnScreen() async {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)

    await model.surfaceAppeared(.popover)
    await model.surfaceAppeared(.profilesTab)
    model.surfaceDisappeared(.popover)

    await model.tick()
    #expect(model.loadCount == 3, "the dashboard tab is still visible, so keep refreshing")
}

@MainActor
@Test func loadErrorIsKeptAsATypedValue() async {
    let backend = FakeBackend()
    backend.set(listError: .ConfigCorrupt)
    let model = AppModel(backend: backend)

    await model.load()

    #expect(model.loadError == .ConfigCorrupt)
    #expect(model.rows.isEmpty)
}

// MARK: - Profiles tab actions
//
// Deviation from the Task 3 brief: the brief's snippets call
// `addApiKeyProfile`/`removeProfile` synchronously. That predates the Task 2
// Critical fix (a659d42) that made every backend-touching AppModel method
// `async` and route through `perform`'s `Task.detached` hop. These tests
// call the async versions instead, to stay consistent with that
// established, load-bearing pattern rather than reintroduce a
// main-actor-blocking call.

@MainActor
@Test func addApiKeyProfilePassesTheKeyStraightThroughAndNeverKeepsIt() async {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)

    await model.addApiKeyProfile(name: "bot", key: "sk-ant-supersecret")

    #expect(backend.addApiKeyCalls.count == 1)
    #expect(backend.addApiKeyCalls[0].name == "bot")
    #expect(backend.addApiKeyCalls[0].key == "sk-ant-supersecret")
    // Nothing on the model may retain key material after the round-trip.
    #expect(model.actionError == nil)
    #expect(!model.rows.contains { $0.name.contains("sk-ant") })
}

@MainActor
@Test func addApiKeyProfileSurfacesAKeychainFailureAsHumanCopyWithoutTheKey() async {
    let backend = FakeBackend()
    backend.addApiKeyError = .Keychain(
        message: "Failed to save API key for profile \"bot\" to macOS Keychain.")
    let model = AppModel(backend: backend)

    await model.addApiKeyProfile(name: "bot", key: "sk-ant-supersecret")

    #expect(model.actionError == "Failed to save API key for profile \"bot\" to macOS Keychain.")
    #expect(!(model.actionError ?? "").contains("sk-ant-supersecret"))
}

@MainActor
@Test func addSubscriptionOpensTerminalThenPollsUntilTheProfileAppears() async {
    // This is the flow the Tauri version shipped DEAD. It gets an automated
    // test AND a manual smoke item — one is not a substitute for the other.
    //
    // Deterministic on purpose (Task 3 review, Important finding): the
    // previous version raced a fixed `Task.sleep(100ms)` against however
    // long the spawned `Task` above took to get its first scheduling slot —
    // reproduced by the reviewer at ~19% failure. `waitUntil` instead polls
    // `model.pendingSubscription`, the real signal `addSubscriptionProfile`
    // sets (deterministically, after its terminal-open await and before its
    // first poll sleep — see `AppModel.swift`), so this only proceeds once
    // that has actually happened, with no wall-clock guess involved.
    let backend = FakeBackend()
    let model = AppModel(backend: backend)

    let task = Task { @MainActor in
        await model.addSubscriptionProfile(
            name: "work", pollInterval: .milliseconds(5), timeout: .seconds(5))
    }

    let sawPending = await waitUntil { model.pendingSubscription == "work" }
    #expect(sawPending, "addSubscriptionProfile should set pendingSubscription before its first poll")
    #expect(backend.openLoginTerminalCalls == ["work"])

    backend.simulateLoginCompleted(name: "work")
    await task.value

    #expect(model.rows.map(\.name) == ["work"])
    #expect(model.pendingSubscription == nil)
    #expect(model.actionError == nil)
}

@MainActor
@Test func addSubscriptionGivesUpWithHumanCopyWhenTheLoginNeverFinishes() async {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)

    await model.addSubscriptionProfile(
        name: "work", pollInterval: .milliseconds(5), timeout: .milliseconds(30))

    #expect(model.pendingSubscription == nil)
    #expect(model.actionError?.contains("work") == true)
    #expect(model.rows.isEmpty)
}

@MainActor
@Test func removeProfileDelegatesTheWholeOrderedTeardownToTheCore() async {
    // The canonicalize → keychain → store ordering lives in Rust
    // (api::remove_profile_with) and is pinned by cargo tests. The model's job
    // is to call it once with what the user typed and reload — no second
    // opinion, no reordering, no local Keychain call.
    let backend = FakeBackend()
    backend.set(profiles: [ProfileView(name: "work", kind: "subscription", active: true)])
    let model = AppModel(backend: backend)
    await model.load()

    await model.removeProfile(name: "work")

    #expect(backend.removeCalls == ["work"])
    #expect(model.rows.isEmpty)
}

@MainActor
@Test func removeProfileSurfacesATypedFailureAsHumanCopyAndKeepsTheRow() async {
    let backend = FakeBackend()
    backend.set(profiles: [ProfileView(name: "work", kind: "subscription", active: true)])
    backend.removeError = .Keychain(
        message: "Failed to delete API key for profile \"work\" from macOS Keychain.")
    let model = AppModel(backend: backend)
    await model.load()

    await model.removeProfile(name: "work")

    #expect(model.actionError == "Failed to delete API key for profile \"work\" from macOS Keychain.")
    #expect(model.rows.map(\.name) == ["work"], "a failed remove must leave the profile recoverable")
}
