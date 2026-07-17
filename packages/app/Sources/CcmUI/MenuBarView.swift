import AppKit
import CcmKit
import SwiftUI

/// The menu-bar popover: one row per profile (name + active dot + a usage bar +
/// an open-session button), then Open dashboard / Quit.
public struct MenuBarView: View {
    @ObservedObject private var model: AppModel
    private let openDashboard: () -> Void

    /// Held as a stored property, not built inside `body`: a publisher created
    /// in `body` would be torn down and recreated on every re-render and the
    /// 30s tick would never actually arrive.
    private let timer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    public init(model: AppModel, openDashboard: @escaping () -> Void) {
        self.model = model
        self.openDashboard = openDashboard
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.loadError != nil {
                Text("ccm can't read its config.")
                    .font(.callout)
                Button("Open dashboard") { openDashboard() }
            } else if model.rows.isEmpty {
                Text("No profiles yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.rows) { row in
                    HStack(spacing: 8) {
                        Image(systemName: row.active ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(row.active ? Color.accentColor : Color.secondary)
                            .accessibilityLabel(row.active ? "Active profile" : "Inactive profile")
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.name)
                            Text("\(formatTokens(row.totalTokens)) tokens · resets \(formatCountdown(resetAtMs: row.resetAtMs, nowMs: model.nowMs))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Open") { model.openSession(name: row.name) }
                            .help("Open a Claude session in Terminal with this profile")
                    }
                }
            }

            if model.cliMissing {
                Divider()
                Text("The ccm CLI isn't on PATH — opening sessions won't work.")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            Divider()
            Button("Open dashboard") { openDashboard() }
            Button("Quit ccm") { NSApplication.shared.terminate(nil) }
        }
        .padding(12)
        .frame(width: 320)
        // The refresh gate: it starts when the popover is actually on screen.
        // `onAppear` fires reliably. Stopping the gate is a different story:
        // SwiftUI has no first-party API for `MenuBarExtra(.window)`'s
        // presentation state, and the sandbox this was built in has no
        // Accessibility permission to script a real menu-bar click to MEASURE
        // whether `.onDisappear` fires when the popover closes (verified
        // blocked: `osascript` "not allowed assistive access" (-1719),
        // immediate, not a hang). Absent that measurement, `.onDisappear` is
        // NOT trusted alone — the community-documented failure mode is
        // exactly a gate that silently never stops (spec §3, and the bug this
        // project already paid for once in Tauri). `didResignKeyNotification`
        // fires when the popover's backing NSWindow stops being key, which is
        // independent of `onDisappear` and is the documented fallback for
        // this exact gap; it is the mechanism actually relied on here.
        .onAppear { model.surfaceAppeared(.popover) }
        .onReceive(timer) { _ in model.tick() }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didResignKeyNotification)) { note in
            guard let window = note.object as? NSWindow, window.isVisible == false else { return }
            model.surfaceDisappeared(.popover)
        }
    }
}
