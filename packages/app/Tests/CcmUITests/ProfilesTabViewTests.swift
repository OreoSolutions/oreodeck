import CcmKit
import Testing
import ViewInspector

@testable import CcmUI

// Pins the Task 3 review's Critical finding: `AppModel.actionError` was set
// on every failure path of the three new actions but nothing ever rendered
// it. These tests exercise the real SwiftUI render tree via ViewInspector
// (not just the model's published state, which was already covered and
// already passing before this fix) — deleting `ActionErrorBanner`'s render
// call in `ProfilesTab`, or the inline error `Label` in `AddApiKeySheet`,
// turns the matching test red. Verified by hand: temporarily removing the
// `if let actionError = model.actionError { ActionErrorBanner(...) }` block
// from `ProfilesTab.body` makes
// `addApiKeyFailureIsRenderedInTheProfilesTabBanner` fail with "Search did
// not find a match" — confirming these are non-vacuous, not just re-checks
// of `AppModel`'s already-tested state.

@MainActor
@Test func addApiKeyFailureIsRenderedInTheProfilesTabBanner() async throws {
    let backend = FakeBackend()
    backend.addApiKeyError = .AlreadyExists(name: "bot")
    let model = AppModel(backend: backend)

    await model.addApiKeyProfile(name: "bot", key: "sk-ant-supersecret")
    let expectedMessage = "A profile named \"bot\" already exists. Pick another name."
    #expect(model.actionError == expectedMessage)

    let tab = ProfilesTab(model: model)
    let banner = try tab.inspect().find(text: expectedMessage)
    #expect(try banner.string() == expectedMessage)
}

@MainActor
@Test func addSubscriptionTimeoutFailureIsRenderedInTheProfilesTabBanner() async throws {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)

    await model.addSubscriptionProfile(
        name: "work", pollInterval: .milliseconds(5), timeout: .milliseconds(30))
    let message = try #require(model.actionError)
    #expect(message.contains("work"))

    let tab = ProfilesTab(model: model)
    let banner = try tab.inspect().find(text: message)
    #expect(try banner.string() == message)
}

@MainActor
@Test func removeFailureIsRenderedInTheProfilesTabBanner() async throws {
    let backend = FakeBackend()
    backend.set(profiles: [ProfileView(name: "work", kind: "subscription", active: true)])
    backend.removeError = .Keychain(
        message: "Failed to delete API key for profile \"work\" from macOS Keychain.")
    let model = AppModel(backend: backend)
    await model.load()

    await model.removeProfile(name: "work")
    let expectedMessage = "Failed to delete API key for profile \"work\" from macOS Keychain."
    #expect(model.actionError == expectedMessage)

    let tab = ProfilesTab(model: model)
    let banner = try tab.inspect().find(text: expectedMessage)
    #expect(try banner.string() == expectedMessage)
}

@MainActor
@Test func tappingTheBannersDismissButtonClearsTheModelsActionError() async throws {
    let backend = FakeBackend()
    backend.addApiKeyError = .Keychain(message: "boom")
    let model = AppModel(backend: backend)
    await model.addApiKeyProfile(name: "bot", key: "sk-ant-x")
    #expect(model.actionError != nil)

    let tab = ProfilesTab(model: model)
    let dismissButton = try tab.inspect().find(ViewType.Button.self) { button in
        (try? button.accessibilityLabel().string()) == "Dismiss"
    }
    try dismissButton.tap()

    #expect(model.actionError == nil)
}

@MainActor
@Test func addApiKeySheetRendersAKeychainFailureInlineWithoutTheKey() async throws {
    // Design decision pinned here: unlike add-subscription/remove,
    // add-api-key failures are directly correctable (wrong/duplicate name,
    // retry with a different key), so this sheet shows the error inline
    // instead of relying on the banner behind it — see the doc comment on
    // `AddApiKeySheet` in ProfilesTab.swift.
    let backend = FakeBackend()
    backend.addApiKeyError = .Keychain(
        message: "Failed to save API key for profile \"bot\" to macOS Keychain.")
    let model = AppModel(backend: backend)
    await model.addApiKeyProfile(name: "bot", key: "sk-ant-supersecret")

    let sheet = AddApiKeySheet(model: model)
    let inline = try sheet.inspect().find(
        text: "Failed to save API key for profile \"bot\" to macOS Keychain.")
    #expect(try inline.string() == "Failed to save API key for profile \"bot\" to macOS Keychain.")
    // Key hygiene invariant must hold even in the new failure-rendering path.
    #expect(!(try sheet.inspect().findAll(ViewType.Text.self).contains {
        (try? $0.string())?.contains("sk-ant-supersecret") == true
    }))
}

@MainActor
@Test func addSubscriptionSheetTrimsTheNameBeforeSubmitting() async throws {
    // Task 3 review, Minor finding: the disabled-check trimmed the name but
    // submit sent the raw value. Drives the real button tap (not just the
    // model directly) so this is pinned at the layer the bug was actually
    // in — deleting `.trimmingCharacters(in: .whitespaces)` from the
    // button's action closure turns this red.
    let backend = FakeBackend()
    let model = AppModel(backend: backend)
    // `initialName` (test-only init parameter) stands in for a user having
    // typed padded text into the TextField — see its doc comment for why
    // this sidesteps needing a hosted, live-editing TextField.
    let sheet = AddSubscriptionSheet(model: model, initialName: "  work  ")

    try sheet.inspect().find(button: "Open Terminal").tap()

    let sawCall = await waitUntil { backend.openLoginTerminalCalls == ["work"] }
    #expect(sawCall, "expected a single trimmed openLoginTerminal call, got \(backend.openLoginTerminalCalls)")
}
