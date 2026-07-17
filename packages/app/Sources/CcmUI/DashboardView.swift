import SwiftUI

/// The dashboard shell. Task 3 replaces the Profiles tab and Task 4 the Usage
/// and Failover tabs — each of those tasks contains the full replacement body
/// for this file.
public struct DashboardView: View {
    @ObservedObject private var model: AppModel

    public init(model: AppModel) {
        self.model = model
    }

    public var body: some View {
        TabView {
            Text("Profiles — Task 3")
                .tabItem { Label("Profiles", systemImage: "person.2") }
            Text("Usage — Task 4")
                .tabItem { Label("Usage", systemImage: "chart.bar") }
            Text("Failover — Task 4")
                .tabItem { Label("Failover", systemImage: "arrow.triangle.branch") }
        }
        .padding(12)
        .frame(minWidth: 720, minHeight: 420)
    }
}
