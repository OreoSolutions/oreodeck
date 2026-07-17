import SwiftUI
import CcmSpikeKit
import Foundation

/// PROOF: writes exactly what crossed the FFI boundary, on the same code path
/// that populates the view. This is the "doesn't need eyes" proof the spike
/// asked for — read this file back after the app renders.
let proofPath = "/tmp/ccm-spike-proof.txt"

func writeProof(_ lines: [String]) {
    let text = lines.joined(separator: "\n") + "\n"
    try? text.write(toFile: proofPath, atomically: true, encoding: .utf8)
}

@MainActor
final class SpikeModel: ObservableObject {
    @Published var rows: [ProfileUsageView] = []
    @Published var errorSwitchResult: String = ""

    func load() {
        do {
            let result = try getUsage()
            self.rows = result
            var lines = ["=== getUsage() (happy path) ==="]
            for r in result {
                lines.append("profile=\(r.profile) inputTokens=\(r.inputTokens) resetAtMs=\(String(describing: r.resetAtMs))")
            }
            lines.append("=== getUsageFailing() (typed error path) ===")
            do {
                _ = try getUsageFailing()
                lines.append("UNEXPECTED: did not throw")
            } catch let error as CcmError {
                switch error {
                case .ConfigCorrupt:
                    lines.append("switched: ConfigCorrupt")
                case .NotFound(let name):
                    lines.append("switched: NotFound(name: \(name))")
                    self.errorSwitchResult = "NotFound(name: \(name))"
                }
            } catch {
                lines.append("UNEXPECTED non-typed error: \(error)")
            }
            writeProof(lines)
        } catch {
            writeProof(["FATAL: \(error)"])
        }
    }
}

@main
struct CcmSpikeApp: App {
    @StateObject private var model = SpikeModel()

    init() {
        // Load at launch (not gated on the popover ever being opened by a human):
        // this is the same model/code path the MenuBarExtra view below renders from,
        // so the proof file reflects exactly what the UI would show.
        let m = SpikeModel()
        m.load()
    }

    var body: some Scene {
        MenuBarExtra("ccm spike") {
            VStack(alignment: .leading) {
                ForEach(model.rows, id: \.profile) { row in
                    Text("\(row.profile): \(row.inputTokens) tok, reset=\(row.resetAtMs.map(String.init) ?? "nil")")
                }
                Divider()
                Text("typed error: \(model.errorSwitchResult)")
                Divider()
                Button("Quit") { NSApplication.shared.terminate(nil) }
            }
            .padding()
            .onAppear { model.load() }
        }
        .menuBarExtraStyle(.window)
    }
}
