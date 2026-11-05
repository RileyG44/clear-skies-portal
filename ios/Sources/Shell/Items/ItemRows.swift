import SwiftUI

/// Native rows for described web controls. Each row shows the web control's
/// current state and sends a person's change back to that control.

struct ToggleRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    @State private var pending: Bool?

    private var isOn: Bool { pending ?? item.value?.bool ?? false }

    var body: some View {
        Toggle(isOn: Binding(get: { isOn }, set: { value in
            pending = value
            shell.act(item.ref, .toggle, value)
        })) {
            HStack(spacing: 12) {
                if let color = Color(hex: item.color) {
                    Circle().fill(color).frame(width: 12, height: 12)
                        .overlay(Circle().strokeBorder(.primary.opacity(0.15), lineWidth: 0.5))
                }
                RowLabel(title: item.text, detail: item.detail, badge: item.badge)
            }
        }
        .tint(Color(hex: shell.appearance.toggle) ?? .green)
        .disabled(item.isDisabled)
        .onChange(of: item.value) { pending = nil }
    }
}

struct RowLabel: View {
    let title: String
    var detail: String?
    var badge: String?

    var body: some View {
        VStack(alignment: .leading, spacing: MenuMetrics.labelSpacing) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title).fixedSize(horizontal: false, vertical: true)
                if let badge, !badge.isEmpty {
                    Text(badge)
                        .portalFont(.caption2, weight: .medium, digits: true)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(.fill.tertiary, in: .capsule)
                        .foregroundStyle(MenuSecondary())
                }
            }
            if let detail, !detail.isEmpty {
                Text(detail).portalFont(.caption).foregroundStyle(MenuSecondary())
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// A web range input. The finger owns the value while it drags: page updates
/// do not move the thumb, input events reach the web at most once a frame,
/// and the release sends change, as a person's drag on the web slider would.
struct SliderRow: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dynamicTypeSize) private var typeSize
    let ref: String?
    let title: String
    let value: Double
    let range: ClosedRange<Double>
    let step: Double
    let display: String?
    var detail: String?
    var disabled = false
    /// The number field the web shows beside this slider.
    var entry: SubControl?
    /// A control in place of the value, such as a markup size's exact entry.
    var trailing: AnyView?
    /// Title, slider and value on one line, for compact tool panes, when
    /// the row has room for a usable track beside them.
    var inline = false
    var spoken: String?
    /// The filled track's colour when the person has not chosen one.
    var tint: Color?
    @State private var rowWidth: CGFloat = 0
    @State private var labelsWidth: CGFloat = 0

    @State private var local: Double?
    @State private var editing = false
    @State private var lastSent = Date.distantPast
    @State private var flush: Task<Void, Never>?

    init(item: ShellItem, trailing: AnyView? = nil, inline: Bool = false, tint: Color? = nil) {
        self.trailing = trailing
        self.inline = inline
        self.tint = tint
        spoken = item.accessibility ?? item.display
        ref = item.ref
        title = item.text
        let min = item.min?.number ?? 0
        let max = item.max?.number ?? 100
        range = min...Swift.max(min + 0.0001, max)
        step = item.step?.number ?? 1
        value = item.value?.number ?? min
        display = item.display
        detail = item.detail
        disabled = item.isDisabled
        entry = item.entry
    }

    init(spec: SliderSpec) {
        ref = spec.ref
        title = spec.title ?? ""
        let min = spec.min?.number ?? 0
        let max = spec.max?.number ?? 100
        range = min...Swift.max(min + 0.0001, max)
        step = spec.step?.number ?? 1
        value = spec.value?.number ?? min
        display = spec.display
        disabled = spec.disabled ?? false
    }

    var body: some View {
        Group {
            if inline && !typeSize.isAccessibilitySize && (rowWidth == 0 || rowWidth - labelsWidth >= 140) {
                HStack(spacing: 12) {
                    Text(title).lineLimit(1).fixedSize()
                    slider.layoutPriority(-1)
                    valueLabel(trailingWidth: 40)
                }
                .disabled(disabled)
                .onChange(of: value) { if !editing { local = nil } }
            } else {
                stacked
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { rowWidth = $0 }
        // The title and value's own widths decide whether a track still fits.
        .background {
            HStack(spacing: 12) {
                Text(title).lineLimit(1).fixedSize()
                valueLabel(trailingWidth: 40)
            }
            .fixedSize()
            .hidden()
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { labelsWidth = $0 + 12 }
            .accessibilityHidden(true)
        }
    }

    @ViewBuilder private func valueLabel(trailingWidth: CGFloat) -> some View {
        if let trailing {
            trailing
        } else if let display, !display.isEmpty {
            Text(display)
                .portalFont(.footnote, digits: true)
                .foregroundStyle(MenuSecondary())
                .contentTransition(.numericText())
                .frame(minWidth: trailingWidth, alignment: .trailing)
        }
    }

    private var stacked: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let trailing {
                // A wide value control moves under its title rather than
                // squeezing it (a number field keeps one stable place).
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(title).fixedSize()
                        Spacer(minLength: 8)
                        trailing
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(title).fixedSize(horizontal: false, vertical: true)
                        trailing
                    }
                }
            } else {
                HStack(alignment: .firstTextBaseline) {
                    Text(title)
                    Spacer(minLength: 8)
                    if let entry {
                        NumberEntry(control: entry)
                    } else if let display, !display.isEmpty {
                        Text(display)
                            .portalFont(.footnote, digits: true)
                            .foregroundStyle(MenuSecondary())
                            .contentTransition(.numericText())
                    }
                }
            }
            slider
            if let detail, !detail.isEmpty {
                Text(detail).portalFont(.caption).foregroundStyle(MenuSecondary())
            }
        }
        .padding(.vertical, 2)
        .disabled(disabled)
        .onChange(of: value) { if !editing { local = nil } }
    }

    /// Continuous, then snapped to the web's step: a stepped Slider draws a
    /// tick for every step, which reads as a dotted line on fine ranges.
    private var slider: some View {
        PortalSlider(value: Binding(get: { local ?? value }, set: { send(snapped($0)) }),
                     range: range, title: title, onEditingChanged: editingChanged, spoken: spoken, tint: tint)
            .frame(height: 44)
    }

    private func snapped(_ next: Double) -> Double {
        guard step > 0 else { return next }
        let stepped = range.lowerBound + ((next - range.lowerBound) / step).rounded() * step
        // Clear float noise (1.2000000000000002) before the web reads it.
        return (min(range.upperBound, max(range.lowerBound, stepped)) * 1e6).rounded() / 1e6
    }

    private func send(_ next: Double) {
        local = next
        // VoiceOver/keyboard adjustments need a committed value too.
        if !editing { shell.act(ref, .commit, next); settle(); return }
        let now = Date()
        if now.timeIntervalSince(lastSent) >= 1.0 / 60 {
            lastSent = now
            shell.act(ref, .input, next)
        } else {
            flush?.cancel()
            flush = Task {
                try? await Task.sleep(for: .milliseconds(17))
                guard !Task.isCancelled, let latest = local else { return }
                lastSent = Date()
                shell.act(ref, .input, latest)
            }
        }
    }

    private func editingChanged(_ isEditing: Bool) {
        editing = isEditing
        if !isEditing {
            flush?.cancel()
            if let latest = local { shell.act(ref, .commit, latest) }
            settle()
        }
    }

    /// After a commit the web's value is the truth again, even when the web
    /// kept its old value and so sent no change to reset the thumb.
    private func settle() {
        flush = Task {
            do { try await Task.sleep(for: .seconds(1)) } catch { return }
            if !editing { local = nil }
        }
    }
}

struct PickerRow: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dynamicTypeSize) private var typeSize
    let item: ShellItem
    @State private var pending: String?

    var body: some View {
        let options = item.options ?? []
        let selection = Binding(get: { pending ?? item.value?.string ?? "" }, set: { value in
            pending = value
            shell.act(item.ref, .select, value)
        })
        Group {
            if !typeSize.isAccessibilitySize, options.count <= 3, options.allSatisfy({ $0.label.count <= 10 && $0.disabled != true }) {
                // Two or three short choices are one tap apart, not a menu.
                VStack(alignment: .leading, spacing: 8) {
                    RowLabel(title: item.text, detail: item.detail)
                    Picker(item.text, selection: selection) {
                        ForEach(options) { Text($0.label).tag($0.value ?? $0.label) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(.rect)
                }
            } else {
                // The value reads as quiet text on one line; a menu picker's
                // own label ignores the sheet's type and wraps long values.
                let layout = typeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                    : AnyLayout(HStackLayout(spacing: 12))
                layout {
                    RowLabel(title: item.text, detail: item.detail)
                    if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
                    Menu {
                        Picker(item.text, selection: selection) {
                            ForEach(options) { option in
                                Text(option.label).tag(option.value ?? option.label)
                                    .selectionDisabled(option.disabled ?? false)
                            }
                        }
                        .pickerStyle(.inline)
                    } label: {
                        HStack(spacing: 4) {
                            Text(options.first { ($0.value ?? $0.label) == selection.wrappedValue }?.label ?? selection.wrappedValue)
                                .fixedSize(horizontal: false, vertical: true)
                                .multilineTextAlignment(typeSize.isAccessibilitySize ? .leading : .trailing)
                            Image(systemName: "chevron.up.chevron.down").portalFont(.caption2, weight: .semibold)
                        }
                        .foregroundStyle(MenuSecondary())
                        .frame(minHeight: MenuMetrics.minimumTarget)
                        .contentShape(.rect)
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                    .accessibilityLabel(item.text)
                }
            }
        }
        .disabled(item.isDisabled)
        .onChange(of: item.value) { pending = nil }
    }
}

/// Text, number, URL and date inputs. A date travels as yyyy-mm-dd, the
/// value an HTML date input holds.
struct FieldRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    /// Toolbar connection actions read the live DOM value while the native
    /// field can still have focus. Keep input in sync before the button fires.
    var liveInput = false
    @State private var text = ""
    @State private var editing = false
    @FocusState private var focused: Bool

    var body: some View {
        if item.input == "date" {
            HStack {
                if let date = HTMLDate.date(item.value?.string) {
                    DatePicker(selection: Binding(get: { date }, set: { shell.act(item.ref, .commit, HTMLDate.string($0)) }),
                               in: (HTMLDate.date(item.min?.string) ?? .distantPast)...(HTMLDate.date(item.max?.string) ?? .distantFuture),
                               displayedComponents: .date) {
                        RowLabel(title: item.text, detail: item.detail)
                    }
                    .environment(\.calendar, HTMLDate.calendar)
                    .environment(\.timeZone, HTMLDate.timeZone)
                    Button { shell.act(item.ref, .commit, "") } label: {
                        Image(systemName: "xmark.circle.fill").frame(width: 44, height: 44)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Clear \(item.text)")
                } else {
                    RowLabel(title: item.text, detail: item.detail)
                    Spacer()
                    Button("Any date") {
                        let date = min(HTMLDate.date(item.max?.string) ?? .now, .now)
                        shell.act(item.ref, .commit, HTMLDate.string(date))
                    }
                    .frame(minHeight: 44)
                    .accessibilityHint("Set a date; leave empty for an open-ended range")
                }
            }
            .disabled(item.isDisabled)
        } else if item.input == "number" {
            HStack(spacing: 10) {
                if let well = item.well {
                    ColorPicker(selection: Binding(get: { Color(hex: well.value?.string) ?? .white }, set: { color in
                        shell.act(well.ref, .commit, color.hexString)
                    }), supportsOpacity: false) { Text(well.title ?? "Color") }
                    .labelsHidden()
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
                }
                RowLabel(title: item.text, detail: item.detail)
                Spacer(minLength: 8)
                NumberEntry(control: SubControl(ref: item.ref ?? "", value: item.value, disabled: item.disabled,
                                                title: item.title, unit: item.unit))
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                if !item.text.isEmpty { Text(item.text).portalFont(.footnote).foregroundStyle(MenuSecondary()) }
                field
            }
            .onAppear { text = item.value?.string ?? "" }
            .onChange(of: text) {
                if liveInput && focused { shell.act(item.ref, .input, text) }
            }
            .onChange(of: item.value) { if !focused { text = item.value?.string ?? "" } }
        }
    }

    @ViewBuilder private var field: some View {
        if item.input == "multiline" {
            TextField(item.placeholder ?? "", text: $text, axis: .vertical)
                .lineLimit(2...6)
                .focused($focused)
                .onChange(of: focused) { if !focused { shell.act(item.ref, .commit, text) } }
        } else {
            TextField(item.placeholder ?? item.text, text: $text)
                .focused($focused)
                .keyboardType(keyboard)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit { shell.act(item.ref, .commit, text) }
                .onChange(of: focused) { if !focused { shell.act(item.ref, .commit, text) } }
        }
    }

    private var keyboard: UIKeyboardType {
        switch item.input {
        case "number": .numbersAndPunctuation
        case "url": .URL
        case "email": .emailAddress
        default: .default
        }
    }
}

/// A number typed in place, with its unit. It goes to the web's own field on
/// Return or when focus leaves, as a typed value does on the web.
struct NumberEntry: View {
    @Environment(ShellModel.self) private var shell
    let control: SubControl
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 4) {
            TextField(control.title ?? "", text: $text)
                .portalFont(.footnote, digits: true)
                .multilineTextAlignment(.trailing)
                .keyboardType(.numbersAndPunctuation)
                .submitLabel(.done)
                .focused($focused)
                .frame(minWidth: 56, maxWidth: 96)
                .fixedSize(horizontal: true, vertical: false)
                .padding(.vertical, 7)
                .padding(.horizontal, 8)
                .background(.fill.tertiary, in: .rect(cornerRadius: 8))
                .frame(minHeight: MenuMetrics.minimumTarget)
                .contentShape(.rect)
                .accessibilityLabel(control.title ?? "Value")
                .onSubmit(commit)
                .onChange(of: focused) { if !focused { commit() } }
            if let unit = control.unit, !unit.isEmpty {
                Text(unit).portalFont(.footnote).foregroundStyle(MenuSecondary())
            }
        }
        .disabled(control.disabled ?? false)
        .onAppear { text = control.value?.string ?? "" }
        .onChange(of: control.value) { if !focused { text = control.value?.string ?? "" } }
    }

    private func commit() {
        let typed = text.trimmingCharacters(in: .whitespaces)
        guard !typed.isEmpty, typed != control.value?.string else { return }
        shell.act(control.ref, .commit, typed)
    }
}

struct ColorRow: View {
    @Environment(ShellModel.self) private var shell
    let ref: String?
    let title: String
    let value: String?

    var body: some View {
        ColorPicker(selection: Binding(get: { Color(hex: value) ?? .white }, set: { color in
            shell.act(ref, .commit, color.hexString)
        }), supportsOpacity: false) {
            Text(title.isEmpty ? "Custom color" : title)
        }
    }
}

/// A web button. A primary action is the filled capsule. Other actions
/// (Cancel, Save current, Select Area) are glass capsules: the list's own
/// button style draws them as a full-width plate. A disclosure, a menu item
/// and a navigation row stay rows.
struct ButtonRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem

    var body: some View {
        if item.role == "primary" {
            actionCapsule(.glassProminent)
        } else if isCapsule {
            actionCapsule(.glass)
        } else if item.role == "group", item.expanded != nil {
            disclosureRow(chevron: nil, showsState: true)
        } else if item.role == "navigate" || item.role == "group" || item.role == "option" {
            disclosureRow(chevron: item.role == "option" ? nil : (item.role == "group" ? "chevron.up.chevron.down" : "chevron.right"))
        } else {
            disclosureRow(chevron: nil, showsState: true)
        }
    }

    /// Pills and text buttons. A control that opens or closes (aria-expanded)
    /// stays a row even when its class is otherwise an action.
    private var isCapsule: Bool {
        if item.expanded != nil { return false }
        switch item.role {
        case "link", "action", "destructive": return true
        case "navigate", "group", "option": return false
        default: return item.pressed == nil
        }
    }

    @ViewBuilder private func actionCapsule(_ style: some PrimitiveButtonStyle) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(role: item.role == "destructive" ? .destructive : nil) { shell.act(item.ref) } label: {
                HStack {
                    if item.pressed == true { Image(systemName: "checkmark") }
                    Text(item.text)
                }
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(style)
            .controlSize(.large)
            .buttonBorderShape(.capsule)
            .disabled(item.isDisabled)
            .accessibilityLabel(item.accessibility ?? item.text)
            .accessibilityHint(item.hint ?? "")
            .accessibilityValue(item.pressed.map { $0 ? "On" : "Off" } ?? "")
            .accessibilityAddTraits(item.pressed == true ? .isSelected : [])
            if let detail = item.detail, !detail.isEmpty {
                Text(detail).portalFont(.caption).foregroundStyle(MenuSecondary())
                    .padding(.horizontal, 8)
            }
        }
        .listRowBackground(SheetRowBackground())
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
    }

    private func disclosureRow(chevron: String?, showsState: Bool = false) -> some View {
        Button(role: item.role == "destructive" ? .destructive : nil) { shell.act(item.ref) } label: {
            HStack(spacing: 10) {
                if let symbol = Symbols.icon(item.icon) {
                    Image(systemName: symbol).frame(width: 20)
                }
                RowLabel(title: item.text, detail: item.detail)
                    .foregroundStyle(PortalPrimary())
                Spacer(minLength: 0)
                if showsState, item.pressed == true {
                    Image(systemName: "checkmark").portalFont(.caption, weight: .bold)
                } else if showsState, item.expanded != nil {
                    Image(systemName: "chevron.down")
                        .portalFont(.caption, weight: .semibold)
                        .rotationEffect(.degrees(item.expanded == true ? 180 : 0))
                        .foregroundStyle(.tertiary)
                } else if let chevron {
                    Image(systemName: chevron)
                        .portalFont(.caption, weight: .semibold)
                        .foregroundStyle(.tertiary)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(item.isDisabled)
        .accessibilityLabel(item.accessibility ?? item.text)
        .listRowBackground(SheetRowBackground())
    }
}

struct LinkRow: View {
    let item: ShellItem

    var body: some View {
        if let href = item.href, let url = URL(string: href) {
            Link(destination: url) {
                HStack {
                    Text(item.text)
                    Spacer()
                    Image(systemName: "arrow.up.forward").portalFont(.caption, weight: .semibold).foregroundStyle(.tertiary)
                }
            }
        }
    }
}

/// Plain text in the styles the web uses: body, hint, status, warning,
/// success, a titled row, a key and value pair, or Markdown with live links.
struct TextRow: View {
    let item: ShellItem

    var body: some View {
        switch item.style {
        case "row":
            HStack(alignment: .firstTextBaseline) {
                RowLabel(title: item.text, detail: item.detail, badge: item.badge)
                Spacer(minLength: 8)
                if let value = item.value?.string, !value.isEmpty {
                    Text(value).foregroundStyle(MenuSecondary()).multilineTextAlignment(.trailing)
                }
            }
        case "pair":
            LabeledContent(item.text, value: item.value?.string ?? "")
        case "warning":
            Label { content } icon: { Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange) }
                .portalFont(.footnote)
        case "success":
            Label { content } icon: { Image(systemName: "checkmark.circle").foregroundStyle(.green) }
                .portalFont(.footnote)
        case "status":
            Label { content } icon: { Image(systemName: "info.circle").foregroundStyle(MenuSecondary()) }
                .portalFont(.footnote)
        case "hint":
            content.portalFont(.caption).foregroundStyle(MenuSecondary())
        default:
            content.portalFont(.footnote)
        }
    }

    @ViewBuilder private var content: some View {
        if let markdown = item.markdown,
           let text = try? AttributedString(markdown: markdown, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            Text(text).tint(.accentColor)
        } else {
            Text(item.text)
        }
    }
}

struct ProgressRow: View {
    let item: ShellItem

    var body: some View {
        if let value = item.value?.number {
            ProgressView(value: value)
        } else {
            ProgressView().frame(maxWidth: .infinity)
        }
    }
}

/// Pictures from the page: remote URLs, or a canvas encoded as a data URL.
struct ShellImage: View {
    @Environment(ShellModel.self) private var shell
    let src: String
    var contentMode: ContentMode = .fill

    var body: some View {
        let src = shell.images[src] ?? src
        if src.hasPrefix("data:") {
            if let image = DataImageCache.shared.image(for: src) {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else {
                Color.secondary.opacity(0.15)
            }
        } else if src.hasPrefix("csp-image:") {
            Color.secondary.opacity(0.15)
        } else if let url = URL(string: src) {
            AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
                switch phase {
                case .success(let image): image.resizable().aspectRatio(contentMode: contentMode)
                case .failure: Color.secondary.opacity(0.12).overlay(Image(systemName: "photo").foregroundStyle(.tertiary))
                default: Color.secondary.opacity(0.12)
                }
            }
        }
    }
}

/// Decoded canvas pictures, keyed by their data URL so an unchanged preview
/// is decoded once however often its page is described.
final class DataImageCache {
    static let shared = DataImageCache()
    private let cache = NSCache<NSString, UIImage>()

    init() { cache.countLimit = 96 }

    func image(for src: String) -> UIImage? {
        if let cached = cache.object(forKey: src as NSString) { return cached }
        guard let comma = src.firstIndex(of: ","),
              let data = Data(base64Encoded: String(src[src.index(after: comma)...])),
              let image = UIImage(data: data, scale: 2) else { return nil }
        cache.setObject(image, forKey: src as NSString)
        return image
    }
}
