import AppKit
import CcmKit
import SwiftUI

/// A zero-size, invisible helper that hands back the `NSWindow` hosting it,
/// once AppKit has actually inserted it into a window. Used to identify "the
/// popover's own window" for `PopoverCloseObserver` — `MenuBarExtra(.window)`
/// does not expose its backing window through any public SwiftUI API, so this
/// is the closest available substitute: the popover's content view (and
/// therefore this accessor, embedded in it) is hosted in exactly that window.
private struct WindowAccessor: NSViewRepresentable {
    let onResolve: (NSWindow?) -> Void

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async { onResolve(view.window) }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async { onResolve(nsView.window) }
    }
}

/// The menu-bar popover: one row per profile (name + active dot + a usage bar +
/// an open-session button), then Open dashboard / Quit.
public struct MenuBarView: View {
    @ObservedObject private var model: AppModel
    private let openDashboard: () -> Void

    /// Held as a stored property, not built inside `body`: a publisher created
    /// in `body` would be torn down and recreated on every re-render and the
    /// 30s tick would never actually arrive.
    private let timer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    /// Identity: created once and held across re-renders via `@State`, same
    /// reasoning as `timer` above — a fresh `PopoverCloseObserver` on every
    /// render would re-subscribe (and leak the old subscription) constantly.
    @State private var closeObserver: PopoverCloseObserver?

    public init(model: AppModel, openDashboard: @escaping () -> Void) {
        self.model = model
        self.openDashboard = openDashboard
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 13)
                        .fill(
                            LinearGradient(
                                colors: [OreoTheme.chocolate, OreoTheme.chocolate.opacity(0.78)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    Image(systemName: "circle.grid.3x3.fill")
                        .font(.title3)
                        .foregroundStyle(OreoTheme.cream)
                }
                .frame(width: 46, height: 46)
                VStack(alignment: .leading, spacing: 3) {
                    Text("OreoDeck").font(.title3.weight(.bold))
                    HStack(spacing: 6) {
                        Circle()
                            .fill(model.loadError == nil ? OreoTheme.cyan : Color.orange)
                            .frame(width: 6, height: 6)
                        Text(headerStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Text("ORD")
                    .font(.caption2.weight(.bold))
                    .tracking(1.1)
                    .foregroundStyle(OreoTheme.chocolate)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(OreoTheme.cream.opacity(0.8), in: Capsule())
            }

            if let loadError = model.loadError {
                // `message(for:)` — the same typed switch `LoadErrorView`
                // (dashboard tabs) uses — not the popover's own copy: Task 4's
                // review flagged a blanket "ccm can't read its config." here
                // regardless of error, diverging from the tabs'
                // ConfigCorrupt-vs-other distinction. Reusing the shared
                // function keeps the two surfaces from drifting again.
                callout(
                    icon: "exclamationmark.triangle.fill",
                    title: "Configuration needs attention",
                    message: message(for: loadError),
                    color: .orange
                )
            } else if model.rows.isEmpty {
                callout(
                    icon: "person.crop.rectangle.badge.plus",
                    title: "No profiles yet",
                    message: "Open the dashboard to add your first Claude identity.",
                    color: OreoTheme.cyan
                )
            } else {
                VStack(spacing: 7) {
                    ForEach(model.rows) { row in
                        HStack(spacing: 10) {
                            ZStack {
                                Circle().fill(row.active ? OreoTheme.cyan.opacity(0.16) : Color.secondary.opacity(0.1))
                                Image(systemName: row.active ? "checkmark" : "person.fill")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(row.active ? OreoTheme.cyan : Color.secondary)
                            }
                            .frame(width: 30, height: 30)
                            .accessibilityLabel(row.active ? "Active profile" : "Inactive profile")
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(row.name).font(.callout.weight(.semibold))
                                    if row.active { StatusPill(text: "Active", color: OreoTheme.cyan) }
                                }
                                Text("\(formatTokens(row.totalTokens)) tokens · resets \(formatCountdown(resetAtMs: row.resetAtMs, nowMs: model.nowMs))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button {
                                Task { await model.openSession(name: row.name) }
                            } label: {
                                Image(systemName: "arrow.up.right")
                            }
                            .buttonStyle(.borderless)
                            .help("Open a Claude session in Terminal with this profile")
                        }
                        .padding(9)
                        .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 11))
                    }
                }
            }

            if model.cliMissing {
                Label("CLI isn't on PATH — session launch is unavailable.", systemImage: "terminal.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            if let update = model.availableUpdate {
                Button {
                    Task { await model.installAvailableUpdate() }
                } label: {
                    HStack {
                        Image(systemName: "arrow.down.circle.fill")
                        VStack(alignment: .leading, spacing: 2) {
                            Text("OreoDeck v\(update.version) is available")
                                .font(.callout.weight(.semibold))
                            Text("Download, verify and install in Terminal")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                    }
                    .padding(10)
                    .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 11))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            VStack(spacing: 8) {
                Button(action: openDashboard) {
                    HStack {
                        Image(systemName: "rectangle.grid.2x2")
                        Text("Open dashboard")
                        Spacer()
                        Image(systemName: "arrow.up.right")
                    }
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(OreoTheme.cream)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity)
                    .background(OreoTheme.chocolate, in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)

                Button {
                    NSApplication.shared.terminate(nil)
                } label: {
                    Label("Quit OreoDeck", systemImage: "power")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .padding(.vertical, 4)
            }
        }
        .padding(16)
        .frame(width: 350)
        // Resolves the popover's own NSWindow so PopoverCloseObserver can
        // scope its notification filter to it (Finding 2 of the Task 2
        // review) instead of reacting to ANY window resigning key.
        .background(
            WindowAccessor { window in
                if closeObserver == nil {
                    closeObserver = PopoverCloseObserver {
                        model.surfaceDisappeared(.popover)
                    }
                }
                closeObserver?.popoverWindow = window
            }
        )
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
        // project already paid for once in the old webview app). `didResignKeyNotification`
        // fires when the popover's backing NSWindow stops being key, which is
        // independent of `onDisappear` and is the documented fallback for
        // this exact gap; it is the mechanism actually relied on here.
        // `PopoverCloseObserver` (above) owns the actual subscription and
        // scopes it to this popover's own window.
        .onAppear {
            Task {
                await model.surfaceAppeared(.popover)
                await model.checkForUpdates()
            }
        }
        .onReceive(timer) { _ in Task { await model.tick() } }
    }

    private var headerStatus: String {
        if model.loadError != nil { return "Needs attention" }
        if model.rows.isEmpty { return "Ready to set up" }
        return "\(model.rows.count) profile\(model.rows.count == 1 ? "" : "s") ready"
    }

    private func callout(icon: String, title: String, message: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(color)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.callout.weight(.semibold))
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(color.opacity(0.09), in: RoundedRectangle(cornerRadius: 12))
    }
}
