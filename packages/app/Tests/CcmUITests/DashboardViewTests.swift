import Testing
import ViewInspector

@testable import CcmUI

@MainActor
@Test func dashboardKeepsSystemReadinessCompactWithoutCompetingWithNavigation() async throws {
    let backend = FakeBackend()
    backend.set(cliInstalled: false)
    let model = AppModel(backend: backend)
    await model.load()

    let dashboard = DashboardView(model: model)

    #expect(try dashboard.inspect().find(text: "CLI setup needed").string() == "CLI setup needed")
    #expect(try dashboard.inspect().find(text: "Profiles").string() == "Profiles")
}

@MainActor
@Test func dashboardShowsCompactConnectedStateWhenCLIIsAvailable() async throws {
    let backend = FakeBackend()
    backend.set(cliInstalled: true)
    let model = AppModel(backend: backend)
    await model.load()

    let dashboard = DashboardView(model: model)

    #expect(try dashboard.inspect().find(text: "CLI connected").string() == "CLI connected")
}
