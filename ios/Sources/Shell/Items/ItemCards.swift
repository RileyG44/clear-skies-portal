import SwiftUI

/// A web radio group or set of pressed buttons. Short lists become a native
/// segmented control; longer ones a row of capsules that scrolls.
struct SegmentedRow: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dynamicTypeSize) private var typeSize
    let item: ShellItem
    @State private var pending: String?

    var body: some View {
        let options = item.options ?? []
        let selected = pending ?? options.first(where: { $0.selected == true })?.id
        VStack(alignment: .leading, spacing: 6) {
            if !item.text.isEmpty { RowLabel(title: item.text, detail: item.detail) }
            if typeSize.isAccessibilitySize {
                ForEach(options) { option in
                    Button { choose(option.id, in: options) } label: {
                        HStack(spacing: 10) {
                            Text(option.label).fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 8)
                            if option.id == selected { Image(systemName: "checkmark") }
                        }
                        .frame(minHeight: MenuMetrics.minimumTarget)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .disabled(option.disabled ?? false)
                    .accessibilityAddTraits(option.id == selected ? .isSelected : [])
                }
            } else if options.count <= 4, options.allSatisfy({ $0.label.count <= 12 }) {
                Picker(item.text, selection: Binding(get: { selected ?? "" }, set: { choose($0, in: options) })) {
                    ForEach(options) { option in
                        Text(option.label).tag(option.id)
                            .selectionDisabled(option.disabled ?? false)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(minHeight: MenuMetrics.minimumTarget)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(options) { option in
                            let on = option.id == selected
                            Button { choose(option.id, in: options) } label: {
                                Text(option.label)
                                    .portalFont(.footnote, weight: on ? .semibold : .regular)
                                    .padding(.horizontal, 12).padding(.vertical, 6)
                                    .frame(minHeight: MenuMetrics.minimumTarget)
                                    .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(PortalPrimary()))
                                    .background(on ? AnyShapeStyle(.tint.opacity(0.14)) : AnyShapeStyle(.fill.quaternary), in: .capsule)
                            }
                            .buttonStyle(.plain)
                            .disabled(option.disabled ?? false)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .scrollClipDisabled()
            }
        }
        .disabled(item.isDisabled)
        .onChange(of: item.options) { pending = nil }
    }

    private func choose(_ id: String, in options: [ItemOption]) {
        guard !item.isDisabled, let option = options.first(where: { $0.id == id }), option.disabled != true else { return }
        pending = id
        shell.act(option.ref)
    }
}

/// Color swatches, with the custom color well the web offers beside them.
struct SwatchesRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    @State private var pending: String?

    var body: some View {
        let options = item.options ?? []
        let selected = pending ?? options.first(where: { $0.selected == true })?.id
        VStack(alignment: .leading, spacing: 8) {
        if !item.text.isEmpty { RowLabel(title: item.text, detail: item.detail) }
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(options) { option in
                    let on = option.id == selected
                    Button {
                        pending = option.id
                        shell.act(option.ref)
                    } label: {
                        Circle()
                            .fill(Color(hex: option.color) ?? .clear)
                            .overlay(Circle().strokeBorder(.primary.opacity(0.18), lineWidth: 0.5))
                            .overlay {
                                if option.color == nil {
                                    Image(systemName: "a.circle").foregroundStyle(MenuSecondary())
                                }
                            }
                            .frame(width: 26, height: 26)
                            .padding(3)
                            .overlay(Circle().strokeBorder(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.clear), lineWidth: 2))
                    }
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
                    .buttonStyle(.plain)
                    .accessibilityLabel(option.label)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
                if let custom = item.custom {
                    ColorPicker(selection: Binding(get: { Color(hex: custom.value?.string) ?? .white }, set: { color in
                        shell.act(custom.ref, .commit, color.hexString)
                    }), supportsOpacity: false) { Text(custom.title ?? "Custom color") }
                        .labelsHidden()
                        .frame(width: 44, height: 44)
                }
            }
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
        }
        .onChange(of: item.options) { pending = nil }
    }
}

/// A layer in the Layers page or a markup layer: its switch, opacity, and the
/// web card's own actions.
struct LayerCard: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    @State private var pendingVisible: Bool?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                if let color = Color(hex: item.color) {
                    Circle().fill(color).frame(width: 9, height: 9).padding(.top, 5)
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 5) {
                        if let edit = item.edit {
                            Button(item.text) { shell.act(edit.ref) }
                                .buttonStyle(.borderless)
                                .foregroundStyle(PortalPrimary())
                                .fontWeight(.medium)
                                .frame(minHeight: 44, alignment: .leading)
                                .accessibilityHint("Open layer settings")
                        } else {
                            Text(item.text).fontWeight(.medium)
                        }
                        if item.locked == true {
                            Image(systemName: "lock").portalFont(.caption2).foregroundStyle(.tertiary)
                        }
                        if item.active == true {
                            Image(systemName: "pencil").portalFont(.caption).foregroundStyle(.tint)
                        }
                    }
                    if let detail = item.detail, !detail.isEmpty {
                        Text(detail).portalFont(.caption).foregroundStyle(MenuSecondary())
                    }
                }
                Spacer(minLength: 8)
                // The switch is pinned to the trailing edge, in line with
                // every other switch; the actions sit before it or below.
                if item.opacity == nil, let actions = item.actions, !actions.isEmpty { actionsMenu(actions) }
                if let toggle = item.toggle {
                    Toggle(item.text, isOn: Binding(get: { pendingVisible ?? toggle.value?.bool ?? false }, set: { value in
                        pendingVisible = value
                        shell.act(toggle.ref, .toggle, value)
                    }))
                    .labelsHidden()
                    .disabled(toggle.disabled ?? false)
                }
            }
            if let opacity = item.opacity {
                HStack(spacing: 4) {
                    OpacitySlider(control: opacity, title: "\(item.text) opacity")
                    if let actions = item.actions, !actions.isEmpty { actionsMenu(actions) }
                }
            }
            if let confirm = item.confirm {
                Text(confirm).portalFont(.caption).foregroundStyle(MenuSecondary())
            }
            if let buttons = item.buttons, !buttons.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(buttons.enumerated()), id: \.offset) { _, button in
                            Button(role: button.role == "destructive" ? .destructive : nil) { shell.act(button.ref) } label: {
                                Label(button.text, systemImage: Symbols.icon(button.icon) ?? "circle")
                                    .labelStyle(button.icon == nil ? AnyLabelStyle(.titleOnly) : AnyLabelStyle(.titleAndIcon))
                                    .portalFont(.footnote)
                                    .lineLimit(1)
                            }
                            .buttonStyle(.bordered)
                            .buttonBorderShape(.capsule)
                            .controlSize(.small)
                            .tint(button.role == "destructive" ? .red : button.pressed == true ? .accentColor : .primary)
                            .disabled(button.isDisabled)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .scrollClipDisabled()
            }
        }
        .padding(.vertical, 2)
        .onChange(of: item.toggle) { pendingVisible = nil }
        .contextMenu { if let actions = item.actions { actionButtons(actions) } }
    }

    private func actionsMenu(_ actions: [LayerAction]) -> some View {
        Menu { actionButtons(actions) } label: {
            Image(systemName: "ellipsis").foregroundStyle(MenuSecondary())
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .menuOrder(.fixed)
        .menuStyle(.button)
        .buttonStyle(.plain)
    }

    @ViewBuilder private func actionButtons(_ actions: [LayerAction]) -> some View {
        ForEach(actions) { action in
            Button { shell.act(action.ref) } label: {
                Label(action.title, systemImage: symbol(for: action.action))
            }
            .disabled(action.disabled ?? false)
        }
    }

    private func symbol(for action: String) -> String {
        switch action {
        case "up": "arrow.up"
        case "down": "arrow.down"
        case "edit": "slider.horizontal.3"
        case "reset": "arrow.counterclockwise"
        default: "circle"
        }
    }
}

struct AnyLabelStyle: LabelStyle {
    private let make: (Configuration) -> AnyView
    init<S: LabelStyle>(_ style: S) { make = { AnyView(style.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}

struct OpacitySlider: View {
    @Environment(ShellModel.self) private var shell
    let control: SubControl
    let title: String
    @State private var local: Double?
    @State private var editing = false

    var body: some View {
        let value = local ?? control.value?.number ?? 100
        HStack(spacing: 10) {
            Image(systemName: "circle.lefthalf.filled").portalFont(.caption).foregroundStyle(MenuSecondary())
            PortalSlider(value: Binding(get: { value }, set: { next in
                local = next.rounded()
                shell.act(control.ref, editing ? .input : .commit, next.rounded())
            }), range: 0...100, title: title, onEditingChanged: { isEditing in
                editing = isEditing
                if !isEditing { shell.act(control.ref, .commit, (local ?? value).rounded()) }
            })
            .frame(minHeight: 44)
            Text("\(Int(value.rounded()))%")
                .portalFont(.caption, digits: true)
                .foregroundStyle(MenuSecondary())
                .frame(width: 36, alignment: .trailing)
        }
        .onChange(of: control.value) { if !editing { local = nil } }
    }
}

/// A satellite scene from the results list, with its thumbnail and tags.
struct SceneRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem

    var body: some View {
        Button { shell.act(item.ref) } label: {
            HStack(spacing: 12) {
                Group {
                    if let src = item.src { ShellImage(src: src) } else {
                        Color.secondary.opacity(0.12).overlay(Image(systemName: "globe.americas").foregroundStyle(.tertiary))
                    }
                }
                .frame(width: 48, height: 48)
                .clipShape(.rect(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.text).fontWeight(.medium).foregroundStyle(PortalPrimary())
                    if let detail = item.detail { Text(detail).portalFont(.caption, digits: true).foregroundStyle(MenuSecondary()) }
                    if let tags = item.tags, !tags.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(Array(tags.prefix(4).enumerated()), id: \.offset) { _, tag in
                                Text(tag.title)
                                    .portalFont(.caption2, weight: .medium)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(.fill.tertiary, in: .capsule)
                                    .foregroundStyle(MenuSecondary())
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
                if item.selected == true {
                    Image(systemName: "checkmark").portalFont(.footnote, weight: .semibold).foregroundStyle(.tint)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/// Search filters as one line of chips under the search field. Each chip
/// names its current choice and opens the same choices as the web select.
struct FilterChipsRow: View {
    let item: ShellItem

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(item.items ?? [], id: \.stableID) { picker in
                    FilterChip(item: picker)
                }
            }
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(item.text.isEmpty ? "Search filters" : item.text)
    }
}

struct FilterChip: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    @State private var pending: String?

    var body: some View {
        let options = item.options ?? []
        let selection = Binding(get: { pending ?? item.value?.string ?? "" }, set: { value in
            pending = value
            shell.act(item.ref, .select, value)
        })
        let current = options.first { ($0.value ?? $0.label) == selection.wrappedValue }?.label ?? selection.wrappedValue
        Menu {
            Picker(item.text, selection: selection) {
                ForEach(options) { option in
                    Text(option.label).tag(option.value ?? option.label)
                }
            }
            .pickerStyle(.inline)
        } label: {
            HStack(spacing: 4) {
                Text(Self.label(for: item.ref, current: current)).lineLimit(1)
                Image(systemName: "chevron.down").portalFont(.caption2, weight: .semibold)
            }
            .portalFont(.footnote, weight: .medium)
            .foregroundStyle(PortalPrimary())
            .padding(.horizontal, 12)
            .frame(minHeight: 34)
            .background(.fill.tertiary, in: .capsule)
            // A compact pill with a full 44-point target around it.
            .frame(minHeight: MenuMetrics.minimumTarget)
            .contentShape(.rect)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .accessibilityLabel(item.text)
        .accessibilityValue(current)
        .onChange(of: item.value) { pending = nil }
    }

    /// "Any" alone does not say what it filters.
    static func label(for ref: String?, current: String) -> String {
        switch (ref, current) {
        case ("#cloud", "Any"): "Any cloud"
        case ("#cloud", _): current.replacingOccurrences(of: "Under ", with: "Cloud < ")
        default: current
        }
    }
}

/// The three colors of a scale side by side, captioned by role, with the
/// action that swaps the ends.
struct ColorWellsRow: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dynamicTypeSize) private var typeSize
    let item: ShellItem

    var body: some View {
        let rows = item.items ?? []
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 10))
        layout {
            Text(item.text.isEmpty ? "Colors" : item.text)
            if !typeSize.isAccessibilitySize { Spacer(minLength: 4) }
            HStack(spacing: 10) {
            ForEach(rows.filter { $0.kind == "color" }, id: \.stableID) { well in
                VStack(spacing: 1) {
                    ColorPicker(selection: Binding(get: { Color(hex: well.value?.string) ?? .white }, set: { color in
                        shell.act(well.ref, .commit, color.hexString)
                    }), supportsOpacity: false) { Text(well.text) }
                    .labelsHidden()
                    .frame(minWidth: MenuMetrics.minimumTarget, minHeight: 32)
                    .contentShape(.rect)
                    .disabled(well.isDisabled)
                    Text(well.text).portalFont(.caption2).foregroundStyle(MenuSecondary()).lineLimit(1).fixedSize()
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(well.text) color")
            }
            ForEach(rows.filter { $0.kind == "button" }, id: \.stableID) { button in
                Button { shell.act(button.ref) } label: {
                    Image(systemName: "arrow.left.arrow.right")
                        .portalFont(.footnote, weight: .semibold)
                        .frame(width: 36, height: 36)
                        .background(.fill.tertiary, in: .circle)
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .foregroundStyle(PortalPrimary())
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
                .accessibilityLabel(button.text.isEmpty ? "Reverse colors" : button.text)
            }
            }
        }
    }
}

/// A card's closing actions (resets, fill and remove) side by side as quiet
/// capsules rather than one full-width plate each.
struct ActionsRow: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dynamicTypeSize) private var typeSize
    let item: ShellItem

    var body: some View {
        let buttons = item.items ?? []
        let stacked = typeSize.isAccessibilitySize || buttons.count > 2
        let layout = stacked ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        VStack(alignment: .leading, spacing: 6) {
            layout { ForEach(buttons, id: \.stableID) { action($0) } }
            // Say what each reset puts back, as the web's tooltips do.
            // With several buttons, name each one so the hints stay apart.
            let hinted = buttons.filter { !($0.hint ?? "").isEmpty }
            let hints = hinted.map { button -> String in
                let hint = button.hint ?? ""
                guard hinted.count > 1 else { return hint }
                let sentence = hint.prefix(1).lowercased() + hint.dropFirst()
                return "\(button.title ?? ""): \(sentence.hasSuffix(".") ? sentence : sentence + ".")"
            }
            if !hints.isEmpty {
                Text(hints.joined(separator: "\n"))
                    .portalFont(.caption).foregroundStyle(MenuSecondary())
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .listRowSeparator(.hidden, edges: .top)
    }

    private func action(_ button: ShellItem) -> some View {
        Button(role: button.role == "destructive" ? .destructive : nil) { shell.act(button.ref) } label: {
            Text(button.text).portalFont(.footnote, weight: .semibold)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, minHeight: 36)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.capsule)
        .frame(minHeight: MenuMetrics.minimumTarget)
        .disabled(button.isDisabled)
        .accessibilityLabel(button.accessibility ?? button.text)
        .accessibilityHint(button.hint ?? "")
    }
}

/// One elevation highlight: its color, the height, and whether it is on.
struct ThresholdRow: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dynamicTypeSize) private var typeSize
    let item: ShellItem
    @State private var pending: Bool?

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 12))
        layout {
            HStack(spacing: 12) {
                if let well = item.well {
                    ColorPicker(selection: Binding(get: { Color(hex: well.value?.string) ?? .white }, set: { color in
                        shell.act(well.ref, .commit, color.hexString)
                    }), supportsOpacity: false) { Text(well.title ?? "Color") }
                    .labelsHidden()
                    .frame(minWidth: MenuMetrics.minimumTarget, minHeight: MenuMetrics.minimumTarget)
                    .contentShape(.rect)
                    .disabled(well.disabled ?? false)
                    .accessibilityLabel("\(item.text) color")
                }
                Text(item.text)
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            HStack(spacing: 12) {
            NumberEntry(control: SubControl(ref: item.ref ?? "", value: item.value, disabled: item.disabled,
                                            title: "\(item.text) height", unit: item.unit))
            if let toggle = item.toggle {
                Toggle(toggle.title ?? item.text, isOn: Binding(get: { pending ?? toggle.value?.bool ?? false }, set: { value in
                    pending = value
                    shell.act(toggle.ref, .toggle, value)
                }))
                .labelsHidden()
                .tint(Color(hex: shell.appearance.toggle) ?? .green)
                .disabled(toggle.disabled ?? false)
                .accessibilityLabel(toggle.title ?? "Highlight \(item.text.lowercased())")
            }
            }
        }
        .frame(minHeight: MenuMetrics.minimumTarget)
        .onChange(of: item.toggle?.value) { pending = nil }
    }
}

/// Satellite's recommendation: the scene, why it was chosen, and one action.
/// A selected scene says whether it can actually be seen on the map.
struct RecommendationRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(item.text).fontWeight(.semibold).foregroundStyle(PortalPrimary())
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                if let badge = item.badge, !badge.isEmpty {
                    Text(badge)
                        .portalFont(.caption2, weight: .semibold)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(badge == "Shown" ? AnyShapeStyle(.green.opacity(0.22)) : AnyShapeStyle(.orange.opacity(0.25)), in: .capsule)
                        .foregroundStyle(PortalPrimary())
                }
            }
            if let detail = item.detail, !detail.isEmpty {
                Text(detail).portalFont(.caption, digits: true).foregroundStyle(MenuSecondary())
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let action = item.edit, item.selected != true {
                Button { shell.act(action.ref) } label: {
                    Text(action.title ?? "Show").fontWeight(.semibold).frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .buttonBorderShape(.capsule)
                .disabled(action.disabled ?? false)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .contain)
        .accessibilityValue(item.accessibility ?? item.badge ?? "")
    }
}

extension ShellItem {
    /// Identity that survives value changes, so an open picker is not rebuilt.
    var stableID: String { ref ?? "\(kind):\(title ?? "")" }
}
