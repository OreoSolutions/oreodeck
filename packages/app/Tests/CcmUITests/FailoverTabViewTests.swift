import CcmKit
import Foundation
import Testing
import ViewInspector

@testable import CcmUI

// Pins the same Critical-finding pattern as `ProfilesTabViewTests.swift`:
// a rejected toggle/reorder sets `AppModel.actionError`, and that value must
// actually render, not just sit on the model unread. Verified by hand:
// removing the `if let actionError = model.actionError { ActionErrorBanner
// (...) }` block from `FailoverTab.body` makes
// `aRejectedReorderIsRenderedInTheFailoverTabBanner` fail with "Search did
// not find a match".

@MainActor
@Test func failoverTabEmptyStateRendersWhenThereAreNoProfiles() throws {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)

    let tab = FailoverTab(model: model)
    let empty = try tab.inspect().find(text: "No profiles yet")
    #expect(try empty.string() == "No profiles yet")
}

@MainActor
@Test func aSingleProfileOrderRendersFineAndDoesNotCrash() async throws {
    let backend = FakeBackend()
    backend.set(failover: FailoverView(enabled: true, order: ["work"]))
    let model = AppModel(backend: backend)
    await model.load()

    let tab = FailoverTab(model: model)
    let row = try tab.inspect().find(text: "work")
    #expect(try row.string() == "work")
}

@MainActor
@Test func theToggleReflectsTheModelsFailoverEnabledState() async throws {
    let backend = FakeBackend()
    backend.set(failover: FailoverView(enabled: false, order: ["work"]))
    let model = AppModel(backend: backend)
    await model.load()

    let tab = FailoverTab(model: model)
    let toggle = try tab.inspect().find(ViewType.Toggle.self)
    #expect(try toggle.isOn() == false)
}

@MainActor
@Test func aRejectedReorderIsRenderedInTheFailoverTabBanner() async throws {
    let backend = FakeBackend()
    backend.set(failover: FailoverView(enabled: true, order: ["work", "bot"]))
    backend.setFailoverOrderError = .Io(message: "disk full")
    let model = AppModel(backend: backend)
    await model.load()

    await model.moveFailover(fromOffsets: IndexSet(integer: 1), toOffset: 0)
    #expect(model.actionError == "disk full")

    let tab = FailoverTab(model: model)
    let banner = try tab.inspect().find(text: "disk full")
    #expect(try banner.string() == "disk full")
}

@MainActor
@Test func tappingTheFailoverBannersDismissButtonClearsTheModelsActionError() async throws {
    let backend = FakeBackend()
    backend.set(failover: FailoverView(enabled: true, order: ["work"]))
    backend.setFailoverEnabledError = .Io(message: "boom")
    let model = AppModel(backend: backend)
    await model.load()

    await model.setFailoverEnabled(false)
    #expect(model.actionError != nil)

    let tab = FailoverTab(model: model)
    let dismissButton = try tab.inspect().find(ViewType.Button.self) { button in
        (try? button.accessibilityLabel().string()) == "Dismiss"
    }
    try dismissButton.tap()

    #expect(model.actionError == nil)
}
