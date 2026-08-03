import AppKit
import SwiftUI

enum OreoTheme {
    static let canvas = Color(nsColor: .windowBackgroundColor)
    static let card = Color(nsColor: .controlBackgroundColor)
    static let sidebar = Color(red: 0.13, green: 0.12, blue: 0.12)
    static let charcoal = Color(red: 0.16, green: 0.14, blue: 0.13)
    static let terracotta = Color(red: 0.76, green: 0.31, blue: 0.20)
    static let cream = Color(red: 0.96, green: 0.91, blue: 0.82)
    static let sand = Color(red: 0.91, green: 0.83, blue: 0.72)
    static let cyan = Color(red: 0.10, green: 0.72, blue: 0.92)
    static let chocolate = charcoal
}

/// The bundled Layered Bloom mark, with a graceful fallback for preview and test hosts.
struct OreoBrandMark: View {
    var size: CGFloat = 34

    var body: some View {
        Group {
            if let url = Bundle.main.url(forResource: "OreoDeck", withExtension: "png"),
               let logo = NSImage(contentsOf: url) {
                Image(nsImage: logo)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: size * 0.28).fill(OreoTheme.terracotta)
                    Image(systemName: "rectangle.stack.fill")
                        .font(.system(size: size * 0.46, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
        .accessibilityLabel("OreoDeck logo")
    }
}

struct OreoCard<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .background(OreoTheme.card.opacity(0.92), in: RoundedRectangle(cornerRadius: 16))
            .overlay {
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color.primary.opacity(0.07))
            }
            .shadow(color: Color.black.opacity(0.05), radius: 12, y: 5)
    }
}

/// A named task boundary for dashboard content. Unlike generic card grids,
/// sections carry a clear heading and optional next action.
struct OreoSectionCard<Content: View>: View {
    let title: String
    let subtitle: String?
    let content: Content

    init(_ title: String, subtitle: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                if let subtitle {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(OreoTheme.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(Color.primary.opacity(0.08)) }
    }
}

struct OreoMetric: View {
    let label: String
    let value: String
    let systemImage: String
    var color: Color = OreoTheme.terracotta

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.callout.weight(.semibold))
                .foregroundStyle(color)
                .frame(width: 30, height: 30)
                .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Text(value).font(.callout.weight(.semibold)).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(11)
        .background(OreoTheme.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.07)) }
    }
}

struct OreoStatusRow: View {
    let title: String
    let detail: String
    let color: Color
    let systemImage: String

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: systemImage).foregroundStyle(color).frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.caption.weight(.semibold))
                Text(detail).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

struct PageHeader: View {
    let eyebrow: String
    let title: String
    let subtitle: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 13)
                    .fill(
                        LinearGradient(
                            colors: [OreoTheme.terracotta, OreoTheme.terracotta.opacity(0.78)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                Image(systemName: systemImage)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 48, height: 48)

            VStack(alignment: .leading, spacing: 3) {
                Text(eyebrow.uppercased())
                    .font(.caption2.weight(.semibold))
                    .tracking(1.2)
                    .foregroundStyle(OreoTheme.terracotta)
                Text(title).font(.title2.weight(.bold))
                Text(subtitle).font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }
}

struct StatusPill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(color.opacity(0.14), in: Capsule())
            .foregroundStyle(color)
    }
}

struct OreoEmptyState: View {
    let title: String
    let message: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 14)
                    .fill(OreoTheme.cream.opacity(0.62))
                Image(systemName: systemImage)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(OreoTheme.chocolate)
            }
            .frame(width: 54, height: 54)

            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.headline)
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(OreoTheme.card, in: RoundedRectangle(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(Color.primary.opacity(0.07))
        }
    }
}

struct OreoModalHeader: View {
    let title: String
    let subtitle: String
    let systemImage: String
    var tone: Color = OreoTheme.cyan

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 13)
                    .fill(tone.opacity(0.14))
                Image(systemName: systemImage)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(tone)
            }
            .frame(width: 48, height: 48)

            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.title3.weight(.bold))
                Text(subtitle)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }
}

struct OreoModalSection<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OreoTheme.card, in: RoundedRectangle(cornerRadius: 13))
            .overlay {
                RoundedRectangle(cornerRadius: 13)
                    .strokeBorder(Color.primary.opacity(0.07))
            }
    }
}

struct OreoPrimaryButtonStyle: ButtonStyle {
    var color: Color = OreoTheme.terracotta
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.semibold))
            .foregroundStyle(isEnabled ? .white : Color.secondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(
                isEnabled ? color.opacity(configuration.isPressed ? 0.78 : 1) : Color.secondary.opacity(0.12),
                in: RoundedRectangle(cornerRadius: 9)
            )
    }
}
