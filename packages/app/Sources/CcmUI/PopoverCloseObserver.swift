import AppKit
import Combine
import Foundation

/// Wires `NSWindow.didResignKeyNotification` to an `onClose` callback, scoped
/// to one specific window.
///
/// Extracted out of `MenuBarView`'s `body` for two reasons:
///  1. `NotificationCenter` has no per-window filter for this notification
///     out of the box (Finding 2 in the Task 2 review: the previous
///     `.onReceive` had no `object:` filter, so ANY window resigning key —
///     e.g. a future dashboard sheet — would trigger the popover's
///     "disappeared" path). The identity check has to live somewhere, and a
///     plain object makes it a one-line, unit-testable predicate.
///  2. The wiring itself — not just the gate logic it drives — needed a
///     deterministic test (Finding 3). That requires something a test can
///     construct, hand a real `NSWindow`, and post a real notification
///     against, with no SwiftUI hosting.
///
/// Limitation: `popoverWindow` must be supplied by the caller.
/// `MenuBarExtra(.window)`'s backing window is not exposed by any public
/// SwiftUI API, so `MenuBarView` resolves it indirectly via a hidden
/// `NSViewRepresentable` (`WindowAccessor`) once the popover's content view is
/// inserted into its hosting window. Until that resolves — a brief window
/// right after the popover first appears — `popoverWindow` is `nil` and every
/// notification is ignored rather than risking a false match. This is the
/// closest defensible identity check available without a public API for
/// "the MenuBarExtra popover's own window."
@MainActor
final class PopoverCloseObserver {
    /// The popover's own window, once known. `nil` until `WindowAccessor`
    /// resolves it, or in tests that construct this directly.
    var popoverWindow: NSWindow?

    private var cancellable: AnyCancellable?
    private let onClose: () -> Void

    init(onClose: @escaping () -> Void) {
        self.onClose = onClose
        // `NotificationCenter.publisher` delivers on the posting thread (both
        // `NSWindow`'s real notifications and a test's hand-posted one are
        // posted from the main thread), so this is deterministically
        // testable with a plain `post` + immediate assert — no queue hop, no
        // `await`.
        cancellable = NotificationCenter.default
            .publisher(for: NSWindow.didResignKeyNotification)
            .sink { [weak self] note in
                self?.handle(note)
            }
    }

    /// Pure predicate: true only for the tracked window resigning key AND
    /// going invisible (focus moving to another app leaves the popover
    /// visible, which must NOT count as "closed" — the failure mode the
    /// original brief worried about).
    static func shouldClose(from note: Notification, popoverWindow: NSWindow?) -> Bool {
        guard let window = note.object as? NSWindow,
            let popoverWindow, window === popoverWindow
        else { return false }
        return window.isVisible == false
    }

    private func handle(_ note: Notification) {
        guard Self.shouldClose(from: note, popoverWindow: popoverWindow) else { return }
        onClose()
    }
}
