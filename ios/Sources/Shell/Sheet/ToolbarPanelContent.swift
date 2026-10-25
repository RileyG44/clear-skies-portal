import SwiftUI

/// Compact cards for the toolbar's quick tasks. Export and Connect stay in a
/// footer while their settings scroll, including above the software keyboard.
struct ToolbarPanelContent: View {
    let panel: ShellPanel

    private var content: [ShellItem] { panel.items.filter { $0.kind != "actions" } }
    private var actions: [ShellItem] { panel.items.filter { $0.kind == "actions" }.flatMap { $0.items ?? [] } }

    var body: some View {
        VStack(spacing: 0) {
          ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PanelItems(items: content, prefix: panel.id)
            }
            .padding(.horizontal, 18)
            .padding(.top, 12)
            .padding(.bottom, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollDismissesKeyboard(.interactively)
        .scrollEdgeEffectStyle(.soft, for: .top)
        .modifier(SheetScrollTracking())
        .scrollEdgeEffectStyle(.soft, for: .bottom)
            if !actions.isEmpty {
                PanelActions(items: actions)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
            }
        }
        .onSheetGlass()
    }
}

private struct PanelItems: View {
    let items: [ShellItem]
    let prefix: String

    var body: some View {
        ForEach(ItemRows.keyed(items, prefix: prefix), id: \.0) { key, item in
            switch item.kind {
            case "source":
                SourcePanelCard(item: item, key: key)
            case "group":
                PanelSection(item: item, key: key)
            case "actions":
                PanelActions(items: item.items ?? [])
            case "actionmenu":
                PanelActionMenu(item: item)
            case "disclosure":
                PanelDisclosure(item: item, key: key)
            case "picker":
                PanelPicker(item: item)
            case "field":
                VStack(alignment: .leading, spacing: 8) {
                    FieldRow(item: item, liveInput: true)
                        .textFieldStyle(.roundedBorder)
                    if let detail = item.detail, !detail.isEmpty {
                        Text(detail).portalFont(.caption).foregroundStyle(.secondary)
                    }
                }
            case "button":
                PanelAction(item: item)
            default:
                ItemView(item: item, key: key)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct PanelSection: View {
    let item: ShellItem
    let key: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !item.text.isEmpty {
                Text(item.text)
                    .portalFont(.footnote, weight: .semibold)
                    .foregroundStyle(.secondary)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.horizontal, 4)
            }
            VStack(alignment: .leading, spacing: 16) {
                AnyView(PanelItems(items: item.items ?? [], prefix: key))
            }
            .panelCard()
        }
    }
}

/// Keep the layer and its opacity together. Long provenance is a disclosure,
/// so a survey paragraph cannot crowd every other layer off the screen.
private struct SourcePanelCard: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    let key: String
    @State private var showingSource = false

    private var symbol: String {
        switch item.id {
        case "scene": "globe.americas"
        case "terrain": "mountain.2"
        case "elevation-spectrum", "elevation-bands": "chart.xyaxis.line"
        case "basemap": "map"
        default: "square.3.layers.3d"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let edit = item.edit {
                Button { shell.act(edit.ref) } label: {
                    HStack(spacing: 10) {
                        heading
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .portalFont(.caption, weight: .semibold)
                            .foregroundStyle(.tertiary)
                    }
                    .frame(minHeight: 44, alignment: .leading)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Open this layer's settings")
            } else {
                heading
                    .accessibilityAddTraits(.isHeader)
            }
            // Dates are useful at a glance; longer scientific/source metadata
            // stays intact behind the explicit disclosure below.
            if item.id == "scene", let detail = item.detail, !detail.isEmpty {
                Text(detail).portalFont(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            AnyView(PanelItems(items: item.items ?? [], prefix: key))
            if item.id != "scene", let detail = item.detail, !detail.isEmpty {
                DisclosureGroup(isExpanded: $showingSource) {
                    Text(detail)
                        .portalFont(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                } label: {
                    Text("Source details").portalFont(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(minHeight: 44, alignment: .leading)
                }
            }
        }
        .panelCard()
    }

    private var heading: some View {
        Label {
            Text(item.text).portalFont(.subheadline, weight: .semibold)
                .foregroundStyle(PortalPrimary())
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: symbol).foregroundStyle(.secondary)
        }
    }
}

private struct PanelDisclosure: View {
    let item: ShellItem
    let key: String

    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 12) {
                AnyView(PanelItems(items: item.items ?? [], prefix: key))
            }
            .padding(.top, 10)
        } label: {
            Text(item.text).portalFont(.footnote)
                .foregroundStyle(.secondary)
                .frame(minHeight: 44, alignment: .leading)
        }
        .panelCard()
    }
}

private struct PanelPicker: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    @State private var pending: String?

    var body: some View {
        let options = item.options ?? []
        let selection = Binding(get: { pending ?? item.value?.string ?? "" }, set: { value in
            pending = value
            shell.act(item.ref, .select, value)
        })
        HStack(spacing: 12) {
            Text(item.text).foregroundStyle(PortalPrimary())
            Spacer(minLength: 8)
            Menu {
                Picker(item.text, selection: selection) {
                    ForEach(options) { option in
                        Text(option.label).tag(option.value ?? option.label)
                            .selectionDisabled(option.disabled ?? false)
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Text(options.first { ($0.value ?? $0.label) == selection.wrappedValue }?.label ?? selection.wrappedValue)
                        .monospacedDigit()
                    Image(systemName: "chevron.up.chevron.down")
                        .portalFont(.caption2, weight: .semibold)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .menuGlass(in: .capsule)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(item.text)
            .accessibilityValue(selection.wrappedValue)
        }
        .disabled(item.isDisabled)
        .onChange(of: item.value) { pending = nil }
    }
}

private struct PanelActions: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let items: [ShellItem]

    var body: some View {
        // Utility actions are readable rows. A pair of capture actions shares
        // the footer when it fits and stacks for larger type or narrow widths.
        let layout = items.count <= 2 && !typeSize.isAccessibilitySize
            ? AnyLayout(HStackLayout(spacing: 10)) : AnyLayout(VStackLayout(spacing: 8))
        layout {
            ForEach(ItemRows.keyed(items, prefix: "actions"), id: \.0) { _, item in
                PanelAction(item: item)
            }
        }
    }
}

private struct PanelActionMenu: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem

    var body: some View {
        Menu {
            ForEach(ItemRows.keyed(item.items ?? [], prefix: "menu"), id: \.0) { _, action in
                Button(role: action.role == "destructive" ? .destructive : nil) { shell.act(action.ref) } label: {
                    if let symbol = Symbols.icon(action.icon) {
                        Label(action.text, systemImage: symbol)
                    } else {
                        Text(action.text)
                    }
                }
                .disabled(action.isDisabled)
            }
        } label: {
            HStack {
                Text(item.text)
                Spacer()
                Image(systemName: "ellipsis.circle")
            }
            .portalFont(.footnote)
            .foregroundStyle(.secondary)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

private struct PanelAction: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    @State private var confirming = false

    var body: some View {
        Group {
            if item.role == "primary" {
                button.buttonStyle(.glassProminent)
            } else if item.role == "action" {
                button.buttonStyle(.glass)
            } else {
                button.buttonStyle(.plain)
            }
        }
        .controlSize(.large)
        .buttonBorderShape(.capsule)
        .disabled(item.isDisabled)
        .confirmationDialog(item.confirm ?? "", isPresented: $confirming, titleVisibility: .visible) {
            Button(item.text, role: .destructive) { shell.act(item.ref) }
        }
    }

    private var button: some View {
        Button(role: item.role == "destructive" ? .destructive : nil) {
            if item.confirm != nil { confirming = true }
            else { shell.act(item.ref) }
        } label: {
            HStack(spacing: 10) {
                if let symbol = Symbols.icon(item.icon) { Image(systemName: symbol) }
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.text).fontWeight(item.role == "primary" ? .semibold : .medium)
                        .fixedSize(horizontal: false, vertical: true)
                    if let detail = item.detail, item.role != "primary", item.role != "action" {
                        Text(detail).portalFont(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44,
                   alignment: item.role == "utility" || item.role == "destructive" ? .leading : .center)
            .contentShape(.rect)
        }
        .accessibilityLabel(item.accessibility ?? item.text)
        .accessibilityHint(item.detail ?? "")
    }
}

private struct PanelCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background { SheetRowBackground() }
            .clipShape(.rect(cornerRadius: 22))
    }
}

private extension View {
    func panelCard() -> some View { modifier(PanelCard()) }
}
