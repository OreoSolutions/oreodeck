import Testing
import ViewInspector

@testable import CcmUI

@MainActor
@Test func dashboardMakesSystemReadinessVisibleWithoutCompetingWithNavigation() async throws {
    let backend = FakeBackend()
    backend.set(cliInstalled: true)
    let model = AppModel(backend: backend)
    await model.load()

    let dashboard = DashboardView(model: model)

    #expect(try dashboard.inspect().find(text: "System status").string() == "System status")
    #expect(try dashboard.inspect().find(text: "CLI connected").string() == "CLI connected")
    #expect(try dashboard.inspect().find(text: "Profiles").string() == "Profiles")
}
