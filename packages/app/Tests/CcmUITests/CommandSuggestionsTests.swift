import Testing
import ViewInspector
import CcmKit

@testable import CcmUI

@MainActor
@Test func profilesExposeContextualCliSuggestions() async throws {
    let backend = FakeBackend()
    backend.set(profiles: [ProfileView(name: "work", kind: "subscription", active: true)])
    let model = AppModel(backend: backend)
    await model.load()
    let view = ProfilesTab(model: model)
    #expect(try view.inspect().find(text: "ord list").string() == "ord list")
    #expect(try view.inspect().find(text: "ord add <name>").string() == "ord add <name>")
}

@MainActor
@Test func usageAndFailoverExposeMatchingCliSuggestions() throws {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)
    #expect(try UsageTab(model: model).inspect().find(text: "ord status").string() == "ord status")
    #expect(try FailoverTab(model: model).inspect().find(text: "ord failover show").string() == "ord failover show")
}

@MainActor
@Test func cliToolsCoverShellUiAndUninstallCommands() throws {
    let backend = FakeBackend()
    let model = AppModel(backend: backend)
    let tools = CLIToolsView(model: model)
    #expect(try tools.inspect().find(text: "oreodeck shell-init >> ~/.zshrc && source ~/.zshrc").string().contains("shell-init"))
    #expect(try tools.inspect().find(text: "ord ui install").string() == "ord ui install")
    #expect(try tools.inspect().find(text: "ord uninstall").string() == "ord uninstall")
}
