import SwiftUI
import UIKit

private struct PortalAppearanceKey: EnvironmentKey {
    nonisolated static let defaultValue = NativeAppearance()
}

extension EnvironmentValues {
    nonisolated var portalAppearance: NativeAppearance {
        get { self[PortalAppearanceKey.self] }
        set { self[PortalAppearanceKey.self] = newValue }
    }
}

/// Typography follows the web's existing choices while retaining Dynamic Type.
private struct PortalFont: ViewModifier {
    @Environment(\.portalAppearance) private var appearance
    let style: Font.TextStyle
    let weight: Font.Weight?
    let digits: Bool

    func body(content: Content) -> some View {
        let size: CGFloat = switch style {
        case .largeTitle: 34
        case .title: 28
        case .title2: 22
        case .title3: 20
        case .headline, .body: 17
        case .callout: 16
        case .subheadline: 15
        case .footnote: 13
        case .caption: 12
        case .caption2: 11
        @unknown default: 17
        }
        let family: String? = switch appearance.font {
        case "inter": "Inter-Regular"
        case "serif": "Georgia"
        default: nil
        }
        let base: Font = if let family {
            .custom(family, size: size * appearance.textSize, relativeTo: style)
        } else if appearance.textSize != 1 {
            .custom(appearance.font == "mono" ? UIFont.monospacedSystemFont(ofSize: size, weight: .regular).fontName : UIFont.systemFont(ofSize: size, weight: .regular).fontName,
                    size: size * appearance.textSize, relativeTo: style)
        } else {
            .system(style, design: appearance.font == "mono" ? .monospaced : .default)
        }
        let weighted = base.weight(weight ?? (style == .headline ? .semibold : .regular))
        content.font(digits ? weighted.monospacedDigit() : weighted)
    }
}

extension View {
    func portalFont(_ style: Font.TextStyle, weight: Font.Weight? = nil, digits: Bool = false) -> some View {
        modifier(PortalFont(style: style, weight: weight, digits: digits))
    }
}

struct PortalPrimary: ShapeStyle {
    func resolve(in environment: EnvironmentValues) -> some ShapeStyle {
        Color(hex: environment.portalAppearance.fontColor) ?? .primary
    }
}

/// UIKit exposes both track colors. The callbacks preserve the existing web
/// slider's input/change lifecycle, including VoiceOver value changes.
struct PortalSlider: UIViewRepresentable {
    @Environment(\.portalAppearance) private var appearance
    @Binding var value: Double
    let range: ClosedRange<Double>
    let title: String
    let onEditingChanged: (Bool) -> Void

    final class TouchSlider: UISlider {
        override var intrinsicContentSize: CGSize {
            CGSize(width: super.intrinsicContentSize.width, height: 44)
        }
    }

    func makeUIView(context: Context) -> UISlider {
        let view = TouchSlider()
        view.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .valueChanged)
        view.addTarget(context.coordinator, action: #selector(Coordinator.began), for: .touchDown)
        view.addTarget(context.coordinator, action: #selector(Coordinator.ended), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        return view
    }

    func updateUIView(_ view: UISlider, context: Context) {
        context.coordinator.parent = self
        view.minimumValue = Float(range.lowerBound)
        view.maximumValue = Float(range.upperBound)
        if abs(Double(view.value) - value) > 0.000001 { view.value = Float(value) }
        view.minimumTrackTintColor = appearance.toggle.flatMap { Color(hex: $0) }.map { UIColor($0) } ?? .systemGreen
        view.maximumTrackTintColor = appearance.track.flatMap { Color(hex: $0) }.map { UIColor($0) }
        view.accessibilityLabel = title
        view.isEnabled = context.environment.isEnabled
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject {
        var parent: PortalSlider
        init(_ parent: PortalSlider) { self.parent = parent }
        @objc func changed(_ sender: UISlider) { parent.value = Double(sender.value) }
        @objc func began() { parent.onEditingChanged(true) }
        @objc func ended() { parent.onEditingChanged(false) }
    }
}
