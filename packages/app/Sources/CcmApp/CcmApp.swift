import AppKit
import CcmUI
import SwiftUI

@main
struct CcmApp: App {
    /// One model shared by the popover and the dashboard, so an action taken in
    /// one is reflected in the other without a second round-trip to disk.
    @StateObject private var model = AppModel(backend: LiveBackend())
    @Environment(\.openWindow) private var openWindow

    var body: some Scene {
        MenuBarExtra("ccm", systemImage: "person.2.circle") {
            MenuBarView(model: model) {
                // An LSUIElement app is not activated by opening a window, so
                // the dashboard would come up behind everything else without
                // this. Activate first, then open.
                NSApplication.shared.activate(ignoringOtherApps: true)
                openWindow(id: "dashboard")
            }
        }
        .menuBarExtraStyle(.window)

        Window("ccm", id: "dashboard") {
            DashboardView(model: model)
        }
        // macOS 15+. Without this the dashboard pops open at launch — wrong for
        // a menu-bar agent, which should show nothing until asked.
        .defaultLaunchBehavior(.suppressed)
    }
}
