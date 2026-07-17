import CcmKit
import Testing

@testable import CcmUI

@MainActor
@Test func loadPopulatesRowsFailoverAndCliStatus() {
    let backend = FakeBackend()
    backend.set(profiles: [ProfileView(name: "work", kind: "subscription", active: true)])
    backend.set(failover: FailoverView(enabled: false, order: ["work"]))
    backend.set(cliInstalled: false)
    let model = AppModel(backend: backend)

    model.load()

    #expect(model.rows.map(\.name) == ["work"])
    #expect(model.failover.enabled == false)
    #expect(model.cliMissing)
    #expect(model.loadError == nil)
}

@MainActor
@Test func tickDoesNothingWhileNoSurfaceIsOnScreen() {
    // The 30s refresh must be gated on the popover/tab actually being visible
    // (spec §3) — an invisible menu-bar agent has no business walking every
    // transcript on disk every 30 seconds.
    let backend = FakeBackend()
    let model = AppModel(backend: backend)

    model.tick()
    model.tick()

    #expect(model.loadCount == 0)
    #expect(backend.listCallCount == 0)
}

@MainActor
@Test func tickRefreshesOnlyWhileASurfaceIsOnScreen() {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)

    model.surfaceAppeared(.popover)   // loads immediately
    #expect(model.loadCount == 1)

    model.tick()
    #expect(model.loadCount == 2)

    model.surfaceDisappeared(.popover)
    model.tick()
    #expect(model.loadCount == 2, "refresh must stop the moment the surface goes away")
}

@MainActor
@Test func refreshKeepsRunningWhileAnyOtherSurfaceIsStillOnScreen() {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)

    model.surfaceAppeared(.popover)
    model.surfaceAppeared(.profilesTab)
    model.surfaceDisappeared(.popover)

    model.tick()
    #expect(model.loadCount == 3, "the dashboard tab is still visible, so keep refreshing")
}

@MainActor
@Test func loadErrorIsKeptAsATypedValue() {
    let backend = FakeBackend()
    backend.set(listError: .ConfigCorrupt)
    let model = AppModel(backend: backend)

    model.load()

    #expect(model.loadError == .ConfigCorrupt)
    #expect(model.rows.isEmpty)
}
