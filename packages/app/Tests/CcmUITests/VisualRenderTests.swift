import AppKit
import CcmKit
import SwiftUI
import Testing

@testable import CcmUI

/// Opt-in render harness used by release QA:
/// OREODECK_RENDER_QA_PATH=/tmp/oreodeck-dashboard.png swift test ... --filter dashboardVisualRender
@MainActor
@Test func dashboardVisualRender() async throws {
    guard let output = ProcessInfo.processInfo.environment["OREODECK_RENDER_QA_PATH"] else { return }
    let backend = FakeBackend()
    backend.set(
        profiles: [
            ProfileView(name: "work", kind: "subscription", active: true),
            ProfileView(name: "personal", kind: "subscription", active: false),
            ProfileView(name: "automation", kind: "api-key", active: false),
        ],
        usage: [
            ProfileUsageView(
                profile: "work", kind: "subscription", inputTokens: 12_400,
                cacheWrite5mTokens: 2_100, cacheWrite1hTokens: 900,
                cacheReadTokens: 8_200, outputTokens: 4_600, totalTokens: 28_200,
                costUsd: 0, resetAtMs: nil),
        ])
    let model = AppModel(backend: backend)
    await model.load()
    let root = DashboardView(model: model)
        .frame(width: 1100, height: 720)
        .preferredColorScheme(.light)
    let hosting = NSHostingView(rootView: root)
    hosting.frame = NSRect(x: 0, y: 0, width: 1100, height: 720)
    let window = NSWindow(
        contentRect: hosting.frame,
        styleMask: [.titled, .closable, .resizable],
        backing: .buffered,
        defer: false
    )
    window.contentView = hosting
    window.makeKeyAndOrderFront(nil)
    window.layoutIfNeeded()
    hosting.layoutSubtreeIfNeeded()
    try await Task.sleep(for: .milliseconds(100))
    guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
        Issue.record("Dashboard could not be rendered to PNG")
        return
    }
    hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        Issue.record("Dashboard bitmap could not be encoded as PNG")
        return
    }
    try png.write(to: URL(fileURLWithPath: output))
}

/// Opt-in popover render for checking the compact empty state without having
/// to automate a menu-bar click:
/// OREODECK_POPOVER_QA_PATH=/tmp/oreodeck-popover.png swift test ... --filter popoverVisualRender
@MainActor
@Test func popoverVisualRender() async throws {
    guard let output = ProcessInfo.processInfo.environment["OREODECK_POPOVER_QA_PATH"] else { return }
    let model = AppModel(backend: FakeBackend())
    await model.load()
    let root = MenuBarView(model: model, openDashboard: {})
        .frame(width: 350, height: 275)
        .preferredColorScheme(.dark)
    let hosting = NSHostingView(rootView: root)
    hosting.frame = NSRect(x: 0, y: 0, width: 350, height: 275)
    let window = NSWindow(
        contentRect: hosting.frame,
        styleMask: [.borderless],
        backing: .buffered,
        defer: false
    )
    window.contentView = hosting
    window.backgroundColor = .windowBackgroundColor
    window.makeKeyAndOrderFront(nil)
    window.layoutIfNeeded()
    hosting.layoutSubtreeIfNeeded()
    try await Task.sleep(for: .milliseconds(100))
    guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
        Issue.record("Popover could not be rendered to PNG")
        return
    }
    hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        Issue.record("Popover bitmap could not be encoded as PNG")
        return
    }
    try png.write(to: URL(fileURLWithPath: output))
}

/// OREODECK_EMPTY_USAGE_QA_PATH=/tmp/oreodeck-empty-usage.png swift test ... --filter emptyUsageVisualRender
@MainActor
@Test func emptyUsageVisualRender() async throws {
    guard let output = ProcessInfo.processInfo.environment["OREODECK_EMPTY_USAGE_QA_PATH"] else { return }
    let model = AppModel(backend: FakeBackend())
    await model.load()
    let root = UsageTab(model: model)
        .padding(24)
        .frame(width: 900, height: 620, alignment: .topLeading)
        .background(OreoTheme.canvas)
        .preferredColorScheme(.dark)
    let hosting = NSHostingView(rootView: root)
    hosting.frame = NSRect(x: 0, y: 0, width: 900, height: 620)
    let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = hosting
    window.makeKeyAndOrderFront(nil)
    window.layoutIfNeeded()
    hosting.layoutSubtreeIfNeeded()
    try await Task.sleep(for: .milliseconds(100))
    guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
        Issue.record("Empty usage view could not be rendered to PNG")
        return
    }
    hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        Issue.record("Empty usage bitmap could not be encoded as PNG")
        return
    }
    try png.write(to: URL(fileURLWithPath: output))
}

/// OREODECK_MODAL_QA_PATH=/tmp/oreodeck-modal.png swift test ... --filter modalVisualRender
@MainActor
@Test func modalVisualRender() async throws {
    guard let output = ProcessInfo.processInfo.environment["OREODECK_MODAL_QA_PATH"] else { return }
    let model = AppModel(backend: FakeBackend())
    let root = AddSubscriptionSheet(model: model, initialName: "work")
        .preferredColorScheme(.dark)
    let hosting = NSHostingView(rootView: root)
    hosting.frame = NSRect(x: 0, y: 0, width: 500, height: 310)
    let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = hosting
    window.makeKeyAndOrderFront(nil)
    window.layoutIfNeeded()
    hosting.layoutSubtreeIfNeeded()
    try await Task.sleep(for: .milliseconds(100))
    guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
        Issue.record("Modal could not be rendered to PNG")
        return
    }
    hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        Issue.record("Modal bitmap could not be encoded as PNG")
        return
    }
    try png.write(to: URL(fileURLWithPath: output))
}

/// OREODECK_SETTINGS_QA_PATH=/tmp/oreodeck-settings.png swift test ... --filter settingsVisualRender
@MainActor
@Test func settingsVisualRender() async throws {
    guard let output = ProcessInfo.processInfo.environment["OREODECK_SETTINGS_QA_PATH"] else { return }
    let backend = FakeBackend()
    backend.set(terminal: "ghostty")
    let model = AppModel(backend: backend)
    await model.load()
    let root = SettingsView(model: model)
        .padding(24)
        .frame(width: 900, height: 620, alignment: .topLeading)
        .background(OreoTheme.canvas)
        .preferredColorScheme(.dark)
    let hosting = NSHostingView(rootView: root)
    hosting.frame = NSRect(x: 0, y: 0, width: 900, height: 620)
    let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = hosting
    window.makeKeyAndOrderFront(nil)
    window.layoutIfNeeded()
    hosting.layoutSubtreeIfNeeded()
    try await Task.sleep(for: .milliseconds(100))
    guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
        Issue.record("Settings view could not be rendered to PNG")
        return
    }
    hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        Issue.record("Settings bitmap could not be encoded as PNG")
        return
    }
    try png.write(to: URL(fileURLWithPath: output))
}
