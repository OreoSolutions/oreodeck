import CcmKit
import SwiftUI

public struct ProfilesTab: View {
    @ObservedObject private var model: AppModel

    @State private var selection: ProfileRow.ID?
    @State private var showAddSubscription = false
    @State private var showAddApiKey = false
    @State private var showAddGateway = false
    @State private var rowPendingRemoval: ProfileRow?
    @State private var rowSharingResources: ProfileRow?
    @State private var rowEditingGatewayMappings: ProfileRow?

    private let timer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    public init(model: AppModel, initialSelection: ProfileRow.ID? = nil) {
        self.model = model
        self._selection = State(initialValue: initialSelection)
    }

    private var selectedRow: ProfileRow? {
        model.rows.first { $0.id == selection }
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                PageHeader(
                    eyebrow: "Identity deck",
                    title: "Profiles",
                    subtitle: "Keep Claude accounts isolated and launch the right identity on demand.",
                    systemImage: "person.crop.rectangle.stack"
                )
            HStack(spacing: 10) {
                summaryCard(
                    title: "Profiles",
                    value: "\(model.rows.count)",
                    icon: "person.2.fill",
                    color: OreoTheme.cyan
                )
                summaryCard(
                    title: "Active identity",
                    value: model.rows.first(where: \.active)?.name ?? "Not selected",
                    icon: "checkmark.seal.fill",
                    color: .green
                )
                summaryCard(
                    title: "Active 5h usage",
                    value: model.rows.first(where: \.active)?.planFiveHourPercent
                        .map { "\(Int($0.rounded()))%" } ?? "—",
                    icon: "chart.bar.fill",
                    color: .purple
                )
            }
            if let actionError = model.actionError {
                ActionErrorBanner(message: actionError) { model.dismissActionError() }
            }
            if let loadError = model.loadError {
                // Must come before the `rows.isEmpty` check below: a
                // config-read failure also leaves `rows` empty (see
                // `AppModel.load()`), and without this branch first the tab
                // would fall through to "No profiles yet" — telling the
                // user to add a profile that may already exist and simply
                // failed to read (Task 4 review, Important finding).
                LoadErrorView(model: model, error: loadError)
                    .frame(maxHeight: 220)
            } else if model.rows.isEmpty {
                OreoEmptyState(
                    title: "No profiles yet",
                    message: "Add a subscription, API key, or Anthropic-compatible gateway profile.",
                    systemImage: "person.2",
                )
            } else {
                Table(model.rows, selection: $selection) {
                    TableColumn("Profile") { row in
                        HStack(spacing: 6) {
                            Image(systemName: row.active ? "largecircle.fill.circle" : "circle")
                                .foregroundStyle(row.active ? Color.accentColor : Color.secondary)
                                .accessibilityLabel(row.active ? "Active" : "Inactive")
                            Text(row.name)
                        }
                    }
                    TableColumn("Kind") { row in
                        Text(row.kind == "api-key" ? "API key" : row.kind == "gateway" ? "Gateway" : "Subscription")
                    }
                    TableColumn("Usage") { row in
                        Text(row.kind == "subscription"
                            ? row.planFiveHourPercent.map { "\(Int($0.rounded()))% (5h)" } ?? "—"
                            : "\(formatTokens(row.totalTokens)) tokens")
                            .monospacedDigit()
                    }
                    TableColumn("Cost") { row in
                        Text(formatCost(kind: row.kind, costUsd: row.costUsd)).monospacedDigit()
                    }
                    TableColumn("Resets in") { row in
                        Text(formatCountdown(
                            resetAtMs: row.kind == "subscription" ? row.planFiveHourResetAtMs : nil,
                            nowMs: model.nowMs
                        ))
                            .monospacedDigit()
                    }
                }
                .frame(height: tableHeight)

                if let selectedRow {
                    ProfileDetailCard(
                        row: selectedRow,
                        connection: model.gatewayConnections[selectedRow.name],
                        subscriptionSync: model.subscriptionUsageSyncs[selectedRow.name],
                        directSubscriptionSyncEnabled: model.directSubscriptionUsageSyncEnabled,
                        nowMs: model.nowMs,
                        checkConnection: { Task { await model.checkGatewayConnection(name: selectedRow.name) } },
                        refreshSubscriptionUsage: { Task { await model.refreshSubscriptionUsage(name: selectedRow.name, force: true) } },
                        loginAgain: { Task { await model.loginAgain(name: selectedRow.name) } }
                    )
                }
            }

            HStack(spacing: 10) {
                Button {
                    guard let name = selectedRow?.name else { return }
                    Task { await model.setActive(name: name) }
                } label: {
                    Label("Set active", systemImage: "checkmark.circle")
                }
                .buttonStyle(.bordered)
                .disabled(selectedRow == nil || selectedRow?.active == true)

                Button {
                    guard let name = selectedRow?.name else { return }
                    Task { await model.openSession(name: name) }
                } label: {
                    Label("Open session", systemImage: "terminal")
                }
                .buttonStyle(.bordered)
                .disabled(selectedRow == nil || model.cliMissing)

                Menu {
                    Button {
                        rowSharingResources = selectedRow
                    } label: {
                        Label("Shared resources…", systemImage: "link")
                    }
                    if selectedRow?.kind == "gateway" {
                        Button {
                            rowEditingGatewayMappings = selectedRow
                        } label: {
                            Label("Edit model mapping…", systemImage: "slider.horizontal.3")
                        }
                    }
                    Divider()
                    Button(role: .destructive) {
                        rowPendingRemoval = selectedRow
                    } label: {
                        Label("Remove profile…", systemImage: "trash")
                    }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
                .menuStyle(.button)
                .disabled(selectedRow == nil)

                Spacer()

                Menu {
                    Button {
                        showAddSubscription = true
                    } label: {
                        Label("Subscription profile", systemImage: "person.crop.circle.badge.plus")
                    }
                    Button {
                        showAddApiKey = true
                    } label: {
                        Label("API key profile", systemImage: "key.fill")
                    }
                    Button {
                        showAddGateway = true
                    } label: {
                        Label("Gateway profile", systemImage: "point.3.connected.trianglepath.dotted")
                    }
                } label: {
                    Label("Add profile", systemImage: "plus")
                }
                .menuStyle(.button)
                .buttonStyle(OreoPrimaryButtonStyle())
            }
            .controlSize(.large)
            .padding(8)
            .background(OreoTheme.card, in: RoundedRectangle(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.primary.opacity(0.06))
            }

            if model.cliMissing {
                // Explains why "Open session" above is disabled — mirrors
                // `MenuBarView`'s CLI-missing copy/style (same string, same
                // `.caption`/`.orange` treatment) so the two surfaces read as
                // one consistent warning instead of two invented banners.
                // Also closes the final-review M-1/M-2 gap: the manual smoke
                // doc claims the Profiles tab shows this warning, and before
                // this it didn't — only the button went grey with no
                // explanation on screen.
                Text("The OreoDeck CLI isn't on PATH — opening sessions won't work.")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            if let pending = model.pendingSubscription {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("Waiting for \"\(pending)\" to finish logging in in Terminal…")
                        .foregroundStyle(.secondary)
                }
            }

                CommandSuggestions(model: model, commands: profileCommands)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 24)
        }
        .onAppear { Task { await model.surfaceAppeared(.profilesTab) } }
        .onDisappear { model.surfaceDisappeared(.profilesTab) }
        .onReceive(timer) { _ in Task { await model.tick() } }
        .sheet(isPresented: $showAddSubscription) {
            AddSubscriptionSheet(model: model)
        }
        .sheet(isPresented: $showAddApiKey) {
            AddApiKeySheet(model: model)
        }
        .sheet(isPresented: $showAddGateway) {
            AddGatewaySheet(model: model)
        }
        .sheet(item: $rowPendingRemoval) { row in
            RemoveProfileSheet(model: model, row: row)
        }
        .sheet(item: $rowSharingResources) { row in
            SharedResourcesSheet(model: model, row: row)
        }
        .sheet(item: $rowEditingGatewayMappings) { row in
            EditGatewayModelMappingsSheet(model: model, row: row)
        }
    }

    private var profileCommands: [CLICommandSuggestion] {
        var commands = [
            CLICommandSuggestion("ord list", "List profiles and show the global active profile."),
            CLICommandSuggestion("ord add <name>", "Add a subscription profile and complete login in Terminal."),
            CLICommandSuggestion("ord add <name> --gateway <url>", "Add an Anthropic-compatible gateway profile."),
        ]
        if let row = selectedRow {
            commands.append(CLICommandSuggestion("ord run -P \(row.name)", "Launch Claude with this profile explicitly."))
            commands.append(CLICommandSuggestion("ord shared set \(row.name)", "Choose shared global resources interactively."))
            commands.append(CLICommandSuggestion("ord use --tab \(row.name)", "Pin this profile to the current Terminal tab."))
        }
        return commands
    }

    private var tableHeight: CGFloat {
        min(270, max(150, CGFloat(model.rows.count) * 32 + 42))
    }

    private func summaryCard(title: String, value: String, icon: String, color: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(color)
                .frame(width: 28, height: 28)
                .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.callout.weight(.semibold))
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(11)
        .frame(maxWidth: .infinity)
        .background(OreoTheme.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color.primary.opacity(0.06))
        }
    }
}

private struct ProfileDetailCard: View {
    let row: ProfileRow
    let connection: GatewayConnectionView?
    let subscriptionSync: SubscriptionUsageSyncView?
    let directSubscriptionSyncEnabled: Bool
    let nowMs: Int64
    let checkConnection: () -> Void
    let refreshSubscriptionUsage: () -> Void
    let loginAgain: () -> Void

    var body: some View {
        OreoSectionCard("Selected profile", subtitle: row.active ? "Active for new sessions" : "Ready when you are") {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(row.name).font(.title3.weight(.semibold))
                    StatusPill(
                        text: row.kind == "gateway" ? "Gateway" : row.kind == "api-key" ? "API key" : "Subscription",
                        color: row.kind == "gateway" ? .purple : OreoTheme.terracotta
                    )
                }
                Spacer()
                if row.kind == "gateway" {
                    Button(connection?.state == "checking" ? "Checking…" : "Check connection", action: checkConnection)
                        .buttonStyle(.bordered)
                        .disabled(connection?.state == "checking")
                }
            }

            if row.kind == "gateway" {
                Divider()
                Text("Gateway connection").font(.subheadline.weight(.semibold))
                OreoStatusRow(
                    title: connection?.message ?? "Not checked yet",
                    detail: connection?.endpoint.isEmpty == false ? connection!.endpoint : "Checks the provider's /models endpoint without sending a completion.",
                    color: connectionColor,
                    systemImage: connectionIcon
                )
                Text("Model aliases").font(.subheadline.weight(.semibold))
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    alias("Opus", row.modelMappings?.opus)
                    alias("Sonnet", row.modelMappings?.sonnet)
                    alias("Haiku", row.modelMappings?.haiku)
                    alias("Fable", row.modelMappings?.fable)
                }
            } else if row.kind == "subscription" {
                SubscriptionUsageSyncStatus(
                    sync: subscriptionSync,
                    enabled: directSubscriptionSyncEnabled,
                    nowMs: nowMs,
                    refresh: refreshSubscriptionUsage,
                    loginAgain: loginAgain
                )
            } else {
                Text("Use this profile for the next Claude Code session, or choose More to manage shared resources.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var connectionColor: Color {
        switch connection?.state {
        case "connected": .green
        case "unauthorized": .orange
        case "unreachable", "unexpected-response": .red
        default: OreoTheme.terracotta
        }
    }

    private var connectionIcon: String {
        switch connection?.state {
        case "connected": "checkmark.circle.fill"
        case "unauthorized": "key.slash.fill"
        case "unreachable", "unexpected-response": "exclamationmark.triangle.fill"
        case "checking": "arrow.triangle.2.circlepath"
        default: "network"
        }
    }

    private func alias(_ family: String, _ id: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(family).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(id?.isEmpty == false ? id! : "Claude default")
                .font(.caption.monospaced())
                .lineLimit(1)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 9))
    }
}

struct AddGatewaySheet: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var baseUrl = ""
    @State private var key = ""
    @State private var isSubmitting = false
    @State private var opus = ""
    @State private var sonnet = ""
    @State private var haiku = ""
    @State private var fable = ""
    @State private var discoveredModelIndex: GatewayModelIndexView?
    @State private var endpointMessage: String?
    @State private var isCheckingEndpoint = false

    init(model: AppModel, initialModelIndex: GatewayModelIndexView? = nil) {
        self.model = model
        self._discoveredModelIndex = State(initialValue: initialModelIndex)
    }

    private var hasConnectionInputs: Bool {
        !baseUrl.trimmingCharacters(in: .whitespaces).isEmpty && !key.isEmpty
    }

    private var hasDiscoveredModels: Bool {
        !(discoveredModelIndex?.modelIds.isEmpty ?? true)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            OreoModalHeader(
                title: "Add gateway profile",
                subtitle: "Connect Claude Code through an Anthropic-compatible HTTPS gateway.",
                systemImage: "point.3.connected.trianglepath.dotted",
                tone: OreoTheme.terracotta
            )
            OreoModalSection {
                VStack(alignment: .leading, spacing: 12) {
                    GatewayFormRow("Profile name") {
                        TextField("e.g. team-gateway", text: $name)
                            .textFieldStyle(.roundedBorder)
                            .controlSize(.large)
                    }
                    GatewayFormRow("Gateway URL") {
                        TextField("https://gateway.example.com/anthropic", text: $baseUrl)
                            .textFieldStyle(.roundedBorder)
                            .controlSize(.large)
                    }
                    GatewayFormRow("API key") {
                        SecureField("Token", text: $key)
                            .textFieldStyle(.roundedBorder)
                            .controlSize(.large)
                    }

                    HStack(spacing: 10) {
                        Spacer().frame(width: 142)
                        Button(isCheckingEndpoint ? "Checking…" : "Check endpoint") { checkEndpoint() }
                            .buttonStyle(.bordered)
                            .disabled(!hasConnectionInputs || isCheckingEndpoint)
                            .accessibilityLabel("Check gateway endpoint for available models")
                        if let endpointMessage {
                            Label(endpointMessage, systemImage: endpointStatusIcon)
                                .font(.caption)
                                .foregroundStyle(endpointStatusColor)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }

                    if hasDiscoveredModels {
                        Divider().padding(.vertical, 2)
                        GatewayModelMappingRows(
                            modelIDs: discoveredModelIndex!.modelIds,
                            opus: $opus,
                            sonnet: $sonnet,
                            haiku: $haiku,
                            fable: $fable
                        )
                    }

                    Label("The URL is saved with this profile. The token stays only in macOS Keychain.", systemImage: "lock.shield.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if let actionError = model.actionError {
                ActionErrorBanner(message: actionError) { model.dismissActionError() }
            }
            Divider()
            HStack {
                Spacer()
                Button("Cancel") { key = ""; dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)
                Button(isSubmitting ? "Adding…" : "Add") { submit() }
                    .buttonStyle(OreoPrimaryButtonStyle())
                    .keyboardShortcut(.defaultAction)
                    .disabled(isSubmitting || name.trimmingCharacters(in: .whitespaces).isEmpty || baseUrl.trimmingCharacters(in: .whitespaces).isEmpty || key.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .controlSize(.large)
        }
        .onAppear { model.dismissActionError() }
        .onChange(of: baseUrl) { _, _ in clearDiscoveredModels() }
        .onChange(of: key) { _, _ in clearDiscoveredModels() }
        .padding(22)
        .frame(width: 680)
        .background(OreoTheme.canvas)
    }

    private var endpointStatusIcon: String {
        switch discoveredModelIndex?.state {
        case "connected": "checkmark.circle.fill"
        case "unauthorized": "key.slash.fill"
        default: "exclamationmark.triangle.fill"
        }
    }

    private var endpointStatusColor: Color {
        switch discoveredModelIndex?.state {
        case "connected": .green
        case "unauthorized": .orange
        default: .secondary
        }
    }

    private func clearDiscoveredModels() {
        isCheckingEndpoint = false
        discoveredModelIndex = nil
        endpointMessage = nil
    }

    private func checkEndpoint() {
        guard hasConnectionInputs else { return }
        let requestedURL = baseUrl.trimmingCharacters(in: .whitespaces)
        let requestedKey = key
        isCheckingEndpoint = true
        endpointMessage = nil
        discoveredModelIndex = nil
        Task {
            let result = await model.probeGatewayModels(baseUrl: requestedURL, key: requestedKey)
            guard baseUrl.trimmingCharacters(in: .whitespaces) == requestedURL, key == requestedKey else { return }
            discoveredModelIndex = result
            endpointMessage = result?.message ?? "Could not check the gateway. Verify its URL and API key."
            isCheckingEndpoint = false
        }
    }

    private func submit() {
        let profileName = name.trimmingCharacters(in: .whitespaces)
        let profileBaseUrl = baseUrl.trimmingCharacters(in: .whitespaces)
        let profileKey = key
        key = ""
        isSubmitting = true
        Task {
            await model.addGatewayProfile(
                name: profileName,
                baseUrl: profileBaseUrl,
                key: profileKey,
                modelMappings: gatewayModelMappings(opus: opus, sonnet: sonnet, haiku: haiku, fable: fable)
            )
            isSubmitting = false
            if model.actionError == nil { dismiss() }
        }
    }
}

private struct GatewayFormRow<Content: View>: View {
    let label: String
    let content: Content

    init(_ label: String, @ViewBuilder content: () -> Content) {
        self.label = label
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 10) {
            Text(label)
                .font(.callout.weight(.semibold))
                .frame(width: 114, alignment: .trailing)
            Image(systemName: "arrow.right")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 18)
            content
        }
    }
}

struct GatewayModelMappingRows: View {
    let modelIDs: [String]
    @Binding var opus: String
    @Binding var sonnet: String
    @Binding var haiku: String
    @Binding var fable: String

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("Model mapping").font(.callout.weight(.semibold))
            Text("Choose a provider model or type an ID directly. Blank keeps Claude's default.")
                .font(.caption)
                .foregroundStyle(.secondary)
            mappingRow("Claude Fable", mapping: $fable)
            mappingRow("Claude Opus", mapping: $opus)
            mappingRow("Claude Sonnet", mapping: $sonnet)
            mappingRow("Claude Haiku", mapping: $haiku)
        }
    }

    private func mappingRow(_ family: String, mapping: Binding<String>) -> some View {
        HStack(spacing: 10) {
            Text(family)
                .font(.callout.weight(.semibold))
                .frame(width: 114, alignment: .trailing)
            Image(systemName: "arrow.right")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 18)
            TextField("Provider model ID", text: mapping)
                .textFieldStyle(.roundedBorder)
            if !mapping.wrappedValue.isEmpty {
                Button {
                    mapping.wrappedValue = ""
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Clear \(family) mapping")
            }
            Menu("Select model") {
                ForEach(modelIDs, id: \.self) { modelID in
                    Button(modelID) { mapping.wrappedValue = modelID }
                }
            }
            .menuStyle(.button)
            .accessibilityLabel("Select model for \(family)")
        }
    }
}

private func gatewayModelMappings(
    opus: String, sonnet: String, haiku: String, fable: String
) -> GatewayModelMappings {
    GatewayModelMappings(opus: opus, sonnet: sonnet, haiku: haiku, fable: fable)
}

private struct GatewayModelMappingFields: View {
    @Binding var opus: String
    @Binding var sonnet: String
    @Binding var haiku: String
    @Binding var fable: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Optional model mapping").font(.caption.weight(.semibold))
            Text("Leave blank to keep Claude's default model for that family.")
                .font(.caption2).foregroundStyle(.secondary)
            TextField("Opus provider model ID", text: $opus).textFieldStyle(.roundedBorder)
            TextField("Sonnet provider model ID", text: $sonnet).textFieldStyle(.roundedBorder)
            TextField("Haiku provider model ID", text: $haiku).textFieldStyle(.roundedBorder)
            TextField("Fable provider model ID", text: $fable).textFieldStyle(.roundedBorder)
        }
    }
}

private struct EditGatewayModelMappingsSheet: View {
    @ObservedObject var model: AppModel
    let row: ProfileRow
    @Environment(\.dismiss) private var dismiss
    @State private var opus: String
    @State private var sonnet: String
    @State private var haiku: String
    @State private var fable: String
    @State private var isSaving = false

    init(model: AppModel, row: ProfileRow) {
        self.model = model
        self.row = row
        self._opus = State(initialValue: row.modelMappings?.opus ?? "")
        self._sonnet = State(initialValue: row.modelMappings?.sonnet ?? "")
        self._haiku = State(initialValue: row.modelMappings?.haiku ?? "")
        self._fable = State(initialValue: row.modelMappings?.fable ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            OreoModalHeader(
                title: "Edit model mapping",
                subtitle: "Map Claude model families for \(row.name).",
                systemImage: "slider.horizontal.3",
                tone: .purple
            )
            OreoModalSection { GatewayModelMappingFields(opus: $opus, sonnet: $sonnet, haiku: $haiku, fable: $fable) }
            if let actionError = model.actionError { ActionErrorBanner(message: actionError) { model.dismissActionError() } }
            Divider()
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.buttonStyle(.bordered).keyboardShortcut(.cancelAction)
                Button(isSaving ? "Saving…" : "Save") {
                    isSaving = true
                    Task {
                        await model.updateGatewayModelMappings(
                            name: row.name,
                            modelMappings: gatewayModelMappings(opus: opus, sonnet: sonnet, haiku: haiku, fable: fable)
                        )
                        isSaving = false
                        if model.actionError == nil { dismiss() }
                    }
                }.buttonStyle(OreoPrimaryButtonStyle()).keyboardShortcut(.defaultAction).disabled(isSaving)
            }.controlSize(.large)
        }
        .onAppear { model.dismissActionError() }
        .padding(22)
        .frame(width: 500)
        .background(OreoTheme.canvas)
    }
}

struct SharedResourcesSheet: View {
    static let choices = ["mcp", "skills", "plugins", "statusline.sh"]

    @ObservedObject var model: AppModel
    let row: ProfileRow
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String>
    @State private var isSaving = false
    @State private var showForceConfirmation = false

    init(model: AppModel, row: ProfileRow) {
        self.model = model
        self.row = row
        self._selected = State(initialValue: Set(row.sharedResources))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            OreoModalHeader(
                title: "Shared resources",
                subtitle: "Choose which global Claude resources “\(row.name)” should reuse. Login credentials and conversations always remain isolated.",
                systemImage: "link"
            )

            OreoModalSection {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(Self.choices, id: \.self) { resource in
                        VStack(alignment: .leading, spacing: 3) {
                            Toggle(label(for: resource), isOn: Binding(
                                get: { selected.contains(resource) },
                                set: { enabled in
                                    if enabled { selected.insert(resource) } else { selected.remove(resource) }
                                }
                            ))
                            .toggleStyle(.checkbox)
                            Text(description(for: resource))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .padding(.leading, 20)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 4)
                    }
                }
            }
            if let actionError = model.actionError {
                ActionErrorBanner(message: actionError) { model.dismissActionError() }
            }

            Divider()
            HStack {
                Button("Replace & back up…") { showForceConfirmation = true }
                    .buttonStyle(.bordered)
                    .disabled(isSaving)
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)
                Button(isSaving ? "Saving…" : "Save") {
                    save(force: false)
                }
                .buttonStyle(OreoPrimaryButtonStyle())
                .keyboardShortcut(.defaultAction)
                .disabled(isSaving)
            }
            .controlSize(.large)
        }
        .onAppear { model.dismissActionError() }
        .confirmationDialog(
            "Replace conflicting profile resources?",
            isPresented: $showForceConfirmation,
            titleVisibility: .visible
        ) {
            Button("Replace and create backup", role: .destructive) { save(force: true) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Existing local files or folders will be moved into .oreodeck-backups/shared before symlinks are created.")
        }
        .padding(22)
        .frame(width: 520)
        .background(OreoTheme.canvas)
    }

    private func save(force: Bool) {
        isSaving = true
        let resources = Self.choices.filter(selected.contains)
        Task {
            if force {
                await model.setSharedResourcesForce(name: row.name, resources: resources)
            } else {
                await model.setSharedResources(name: row.name, resources: resources)
            }
            isSaving = false
            if model.actionError == nil { dismiss() }
        }
    }

    private func label(for resource: String) -> String {
        switch resource {
        case "mcp": "MCP servers"
        case "skills": "Skills"
        case "plugins": "Plugins"
        case "statusline.sh": "Status line"
        default: resource
        }
    }

    private func description(for resource: String) -> String {
        switch resource {
        case "mcp": "Global server definitions"
        case "skills": "Global skill directory"
        case "plugins": "Plugins and activation state"
        case "statusline.sh": "Script and statusLine configuration"
        default: ""
        }
    }
}

/// Renders `AppModel.actionError`, dismissibly. This is the fix for the
/// Critical finding on Task 3's review: the model already turned every
/// failure on the three new actions (add-api-key, add-subscription,
/// remove) into human copy via `message(for:)`, but nothing ever showed it —
/// sheets dismissed regardless of outcome and the string was set but never
/// read outside `AppModel`. `add-subscription`'s terminal-open failure and
/// poll timeout land here too, since that sheet always dismisses immediately
/// (see `AddSubscriptionSheet` below) and has nothing else on screen to show
/// the error once it's gone.
///
/// Not `private`: `FailoverTab` (Task 4) reuses it verbatim for the same
/// reason — the toggle/reorder actions go through the same `actionError`
/// published property via `perform`, and Task 3's Critical finding was
/// exactly a failure path that set the error but never rendered it.
struct ActionErrorBanner: View {
    let message: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Text(message)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Dismiss")
        }
        .padding(10)
        .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// Opens `ccm add <name>` in Terminal, then polls. The old webview app used
/// `window.prompt` here — which does nothing at all in a packaged webview, so
/// the feature was dead on arrival. A real SwiftUI form cannot fail that way.
///
/// Always dismisses on submit, success or failure: unlike `AddApiKeySheet`
/// there is nothing in this form worth correcting and resubmitting — a
/// terminal-open failure or a 5-minute poll timeout aren't caused by
/// anything typed here, and the poll itself takes far too long to hold a
/// modal sheet open for. Both failure paths (`AppModel.addSubscriptionProfile`)
/// land in `actionError`, surfaced by `ActionErrorBanner` in `ProfilesTab`
/// once this sheet is gone.
struct AddSubscriptionSheet: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name: String

    /// `initialName` exists so tests can pin the trim-at-submit fix (Task 3
    /// review, Minor finding) by presetting untrimmed `@State` up front —
    /// ViewInspector can't drive a live `TextField` edit through a plain
    /// `@State` without hosting the view in a real window loop, which this
    /// package has no need for elsewhere. Production call sites never pass
    /// this; it defaults to empty, same as before.
    init(model: AppModel, initialName: String = "") {
        self.model = model
        self._name = State(initialValue: initialName)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            OreoModalHeader(
                title: "Add subscription profile",
                subtitle: "Create an isolated Claude identity, then complete its login in Terminal.",
                systemImage: "person.crop.circle.badge.plus"
            )

            OreoModalSection {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Profile name").font(.caption.weight(.semibold))
                    TextField("e.g. work", text: $name)
                        .textFieldStyle(.roundedBorder)
                        .controlSize(.large)
                    Label(
                        "Runs `oreodeck add \(name.isEmpty ? "<name>" : name)` and automatically detects the profile after login.",
                        systemImage: "terminal"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }

            Divider()
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)
                Button("Open Terminal") {
                    let profileName = name.trimmingCharacters(in: .whitespaces)
                    dismiss()
                    Task { await model.addSubscriptionProfile(name: profileName) }
                }
                .buttonStyle(OreoPrimaryButtonStyle())
                .keyboardShortcut(.defaultAction)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .controlSize(.large)
        }
        .padding(22)
        .frame(width: 500)
        .background(OreoTheme.canvas)
    }
}

/// Unlike `AddSubscriptionSheet`, a failure here (most commonly
/// `AlreadyExists` or a Keychain write failure) is directly correctable —
/// the user just needs a different name and to retype the key — so this
/// sheet stays open and shows the error inline instead of dismissing into
/// the banner behind it. `model.actionError` is cleared on `onAppear` so a
/// stale error from some earlier, unrelated action can't leak into a fresh
/// sheet before this one has submitted anything.
struct AddApiKeySheet: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var key = ""
    @State private var isSubmitting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            OreoModalHeader(
                title: "Add API key profile",
                subtitle: "Create an isolated profile for automation or usage billed through the Anthropic API.",
                systemImage: "key.fill",
                tone: .purple
            )

            OreoModalSection {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Profile name").font(.caption.weight(.semibold))
                        TextField("e.g. automation", text: $name)
                            .textFieldStyle(.roundedBorder)
                            .controlSize(.large)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Anthropic API key").font(.caption.weight(.semibold))
                        // SecureField, not TextField: the key must never be shown on
                        // screen, and it is wiped from this view's state on submit.
                        SecureField("sk-ant-…", text: $key)
                            .textFieldStyle(.roundedBorder)
                            .controlSize(.large)
                    }
                    Label("Stored only in macOS Keychain — never in config.json.", systemImage: "lock.shield.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if let actionError = model.actionError {
                ActionErrorBanner(message: actionError) { model.dismissActionError() }
            }

            Divider()
            HStack {
                Spacer()
                Button("Cancel") {
                    key = ""
                    dismiss()
                }
                .buttonStyle(.bordered)
                .keyboardShortcut(.cancelAction)
                Button(isSubmitting ? "Adding…" : "Add") {
                    submit()
                }
                .buttonStyle(OreoPrimaryButtonStyle())
                .keyboardShortcut(.defaultAction)
                .disabled(
                    isSubmitting
                        || name.trimmingCharacters(in: .whitespaces).isEmpty
                        || key.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .controlSize(.large)
        }
        .onAppear { model.dismissActionError() }
        .padding(22)
        .frame(width: 500)
        .background(OreoTheme.canvas)
    }

    private func submit() {
        let profileName = name.trimmingCharacters(in: .whitespaces)
        let profileKey = key
        key = ""  // no key material outstanding past the round-trip
        isSubmitting = true
        Task {
            await model.addApiKeyProfile(name: profileName, key: profileKey)
            isSubmitting = false
            if model.actionError == nil {
                dismiss()
            }
        }
    }
}

/// Destructive and irreversible (the profile directory is deleted), so the user
/// has to type the name exactly — same bar as `ccm remove`.
///
/// Dismisses on submit regardless of outcome, unlike `AddApiKeySheet`: the
/// confirmation the user typed is already correct by the time "Remove" is
/// enabled (it matches `row.name`), so there is nothing about this form to
/// retype after a failure — a Keychain error here is a system-level problem,
/// not a form-input one. Failure lands in `actionError`, surfaced by
/// `ActionErrorBanner` once this sheet is gone.
struct RemoveProfileSheet: View {
    @ObservedObject var model: AppModel
    let row: ProfileRow
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            OreoModalHeader(
                title: "Remove \(row.name)?",
                subtitle: "This permanently deletes the profile login, settings, history and Keychain API key.",
                systemImage: "trash.fill",
                tone: .red
            )

            OreoModalSection {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Type **\(row.name)** to confirm").font(.callout)
                    TextField(row.name, text: $typed)
                        .textFieldStyle(.roundedBorder)
                        .controlSize(.large)
                }
            }

            Divider()
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)
                Button("Remove", role: .destructive) {
                    let profileName = row.name
                    dismiss()
                    Task { await model.removeProfile(name: profileName) }
                }
                .buttonStyle(OreoPrimaryButtonStyle(color: .red))
                .disabled(typed != row.name)
            }
            .controlSize(.large)
        }
        .padding(22)
        .frame(width: 500)
        .background(OreoTheme.canvas)
    }
}
