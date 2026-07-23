import Testing
import ViewInspector

@testable import CcmUI

@MainActor
@Test func terminalPreferenceLoadsPersistsAndRunsCommandsThroughBackend() async {
    let backend = FakeBackend()
    backend.set(terminal: "ghostty")
    let model = AppModel(backend: backend)

    await model.load()
    #expect(model.terminal == "ghostty")

    await model.setTerminal("iterm2")
    #expect(model.terminal == "iterm2")
    #expect(backend.setTerminalCalls == ["iterm2"])

    await model.openTerminalCommand("ord status")
    #expect(backend.openTerminalCommandCalls == ["ord status"])
}

@MainActor
@Test func settingsViewExposesEverySupportedTerminal() throws {
    let model = AppModel(backend: FakeBackend())
    let view = SettingsView(model: model)

    #expect(try view.inspect().find(text: "Terminal.app").string() == "Terminal.app")
    #expect(try view.inspect().find(text: "Ghostty").string() == "Ghostty")
    #expect(try view.inspect().find(text: "iTerm2").string() == "iTerm2")
    #expect(try view.inspect().find(text: "WezTerm").string() == "WezTerm")
    #expect(try view.inspect().find(text: "Alacritty").string() == "Alacritty")
    #expect(try view.inspect().find(text: "Kitty").string() == "Kitty")
    #expect(try view.inspect().find(text: "Warp").string() == "Warp")
    #expect(try view.inspect().find(text: "Hyper").string() == "Hyper")
    #expect(try view.inspect().find(text: "Tabby").string() == "Tabby")
    #expect(try view.inspect().find(text: "Rio").string() == "Rio")
    #expect(try view.inspect().find(text: "Wave Terminal").string() == "Wave Terminal")
    #expect(try view.inspect().find(text: "Test terminal").string() == "Test terminal")
    #expect(try view.inspect().find(text: "Support OreoDeck").string() == "Support OreoDeck")
    #expect(try view.inspect().find(text: "Support on Ko-fi").string() == "Support on Ko-fi")
}
