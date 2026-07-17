import AppKit
import Testing

@testable import CcmUI

/// The cheap, deterministic substitute for the blocked click-through
/// measurement (spec's own suggestion): drive the ACTUAL
/// `NotificationCenter` → `PopoverCloseObserver` wiring with a real
/// `NSWindow` and a real posted `NSWindow.didResignKeyNotification`, not just
/// `AppModel`'s gate logic in isolation (already covered by `AppModelTests`).
/// No SwiftUI hosting, no Accessibility permission required.
@MainActor
@Test func windowResigningKeyAndGoingInvisibleClosesItsOwnPopover() {
    let popoverWindow = NSWindow()  // never ordered front: isVisible == false
    var closeCount = 0
    let observer = PopoverCloseObserver { closeCount += 1 }
    observer.popoverWindow = popoverWindow

    NotificationCenter.default.post(
        name: NSWindow.didResignKeyNotification, object: popoverWindow)

    #expect(closeCount == 1)
}

/// Finding 2's regression pin: a DIFFERENT window resigning key must never be
/// mistaken for the popover closing — this is exactly the landmine the
/// review flagged for Task 3/4's dashboard window. Removing the identity
/// filter in `PopoverCloseObserver.shouldClose` makes this go red.
@MainActor
@Test func aDifferentWindowResigningKeyDoesNotCloseThePopover() {
    let popoverWindow = NSWindow()
    let otherWindow = NSWindow()
    var closeCount = 0
    let observer = PopoverCloseObserver { closeCount += 1 }
    observer.popoverWindow = popoverWindow

    NotificationCenter.default.post(
        name: NSWindow.didResignKeyNotification, object: otherWindow)

    #expect(closeCount == 0)
}

/// The popover resigning key while still ON SCREEN (e.g. focus moving to
/// another app) must not count as "closed" — the exact failure mode the
/// original brief worried about. Removing the `isVisible` check in
/// `shouldClose` makes this go red.
@MainActor
@Test func popoverResigningKeyWhileStillVisibleDoesNotClose() {
    let popoverWindow = NSWindow()
    popoverWindow.makeKeyAndOrderFront(nil)  // isVisible == true
    defer { popoverWindow.orderOut(nil) }
    var closeCount = 0
    let observer = PopoverCloseObserver { closeCount += 1 }
    observer.popoverWindow = popoverWindow

    NotificationCenter.default.post(
        name: NSWindow.didResignKeyNotification, object: popoverWindow)

    #expect(closeCount == 0)
}

/// Before `WindowAccessor` resolves a window (or in a misconfigured caller),
/// `popoverWindow` is `nil` — every notification must be ignored rather than
/// matching anything, per the documented limitation in
/// `PopoverCloseObserver`.
@MainActor
@Test func noPopoverWindowKnownYetIgnoresEveryNotification() {
    let someWindow = NSWindow()
    var closeCount = 0
    let observer = PopoverCloseObserver { closeCount += 1 }
    #expect(observer.popoverWindow == nil)  // not resolved yet — the case under test

    NotificationCenter.default.post(
        name: NSWindow.didResignKeyNotification, object: someWindow)

    #expect(closeCount == 0)
}
