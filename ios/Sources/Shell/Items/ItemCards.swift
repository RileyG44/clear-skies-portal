import SwiftUI

/// A web radio group or set of pressed buttons. Short lists become a native
/// segmented control; longer ones a row of capsules that scrolls.
struct SegmentedRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    @State private var pending: String?

    var body: some View {
        let options = item.options ?? []
        let selected = pending ?? options.first(where: { $0.selected == true })?.id
        VStack(alignment: .leading, spacing: 6) {
            if !item.text.isEmpty { RowLabel(title: item.text, detail: item.detail) }
            if options.count <= 4, options.allSatisfy({ $0.label.count <= 12 }) {
                Picker(item.text, selection: Binding(get: { selected ?? "" }, set: { choose($0, in: options) })) {
                    ForEach(options) { option in
                        Text(option.label).tag(option.id)
                            .selectionDisabled(option.disabled ?? false)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(options) { option in
                            let on = option.id == selected
                            Button { choose(option.id, in: options) } label: {
                                Text(option.label)
                                    .portalFont(.footnote, weight: on ? .semibold : .regular)
                                    .padding(.horizontal, 12).padding(.vertical, 6)
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
                                    Image(systemName: "a.circle").foregroundStyle(.secondary)
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
                        Text(detail).portalFont(.caption).foregroundStyle(.secondary)
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
                Text(confirm).portalFont(.caption).foregroundStyle(.secondary)
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
            Image(systemName: "ellipsis").foregroundStyle(.secondary)
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
            Image(systemName: "circle.lefthalf.filled").portalFont(.caption).foregroundStyle(.secondary)
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
                .foregroundStyle(.secondary)
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
                    if let detail = item.detail { Text(detail).portalFont(.caption, digits: true).foregroundStyle(.secondary) }
                    if let tags = item.tags, !tags.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(Array(tags.prefix(4).enumerated()), id: \.offset) { _, tag in
                                Text(tag.title)
                                    .portalFont(.caption2, weight: .medium)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(.fill.tertiary, in: .capsule)
                                    .foregroundStyle(.secondary)
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
