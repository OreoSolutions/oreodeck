import SwiftUI

/// The dashboard shell: Profiles (Task 3), Usage and Failover (Task 4).
public struct DashboardView: View {
    @ObservedObject private var model: AppModel

    public init(model: AppModel) {
        self.model = model
    }

    public var body: some View {
        TabView {
            ProfilesTab(model: model)
                .tabItem { Label("Profiles", systemImage: "person.2") }
            UsageTab(model: model)
                .tabItem { Label("Usage", systemImage: "chart.bar") }
            FailoverTab(model: model)
                .tabItem { Label("Failover", systemImage: "arrow.triangle.branch") }
        }
        .padding(12)
        .frame(minWidth: 720, minHeight: 420)
    }
}
