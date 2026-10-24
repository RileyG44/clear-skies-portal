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
        .disabled(item.isDisabled)
        .onChange(of: item.value) { pending = nil }
    }
}

struct RowLabel: View {
    let title: String
    var detail: String?
    var badge: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(title)
                if let badge, !badge.isEmpty {
                    Text(badge)
                        .font(.caption2.weight(.medium).monospacedDigit())
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(.fill.tertiary, in: .capsule)
                        .foregroundStyle(.secondary)
                }
            }
            if let detail, !detail.isEmpty {
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

/// A web range input. The finger owns the value while it drags: page updates
/// do not move the thumb, input events reach the web at most once a frame,
/// and the release sends change, as a person's drag on the web slider would.
struct SliderRow: View {
    @Environment(ShellModel.self) private var shell
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

    @State private var local: Double?
    @State private var editing = false
    @State private var lastSent = Date.distantPast
    @State private var flush: Task<Void, Never>?

    init(item: ShellItem) {
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
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                Spacer(minLength: 8)
                if let entry {
                    NumberEntry(control: entry)
                } else if let display, !display.isEmpty {
                    Text(display)
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                }
            }
            slider
            if let detail, !detail.isEmpty {
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
        .disabled(disabled)
        .onChange(of: value) { if !editing { local = nil } }
    }

    /// Continuous, then snapped to the web's step: a stepped Slider draws a
    /// tick for every step, which reads as a dotted line on fine ranges.
    private var slider: some View {
        Slider(value: Binding(get: { local ?? value }, set: { send(snapped($0)) }), in: range) {
            Text(title)
        } onEditingChanged: { editingChanged($0) }
        .controlSize(.small)
    }

    private func snapped(_ next: Double) -> Double {
        guard step > 0 else { return next }
        let stepped = range.lowerBound + ((next - range.lowerBound) / step).rounded() * step
        // Clear float noise (1.2000000000000002) before the web reads it.
        return (min(range.upperBound, max(range.lowerBound, stepped)) * 1e6).rounded() / 1e6
    }

    private func send(_ next: Double) {
        local = next
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
        }
    }
}

struct PickerRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    @State private var pending: String?

    var body: some View {
        let options = item.options ?? []
        let selection = Binding(get: { pending ?? item.value?.string ?? "" }, set: { value in
            pending = value
            shell.act(item.ref, .select, value)
        })
        Group {
            if options.count <= 3, options.allSatisfy({ $0.label.count <= 10 && $0.disabled != true }) {
                // Two or three short choices are one tap apart, not a menu.
                HStack(spacing: 12) {
                    RowLabel(title: item.text, detail: item.detail)
                    Spacer(minLength: 8)
                    Picker(item.text, selection: selection) {
                        ForEach(options) { Text($0.label).tag($0.value ?? $0.label) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                }
            } else {
                // The value reads as quiet text on one line; a menu picker's
                // own label ignores the sheet's type and wraps long values.
                HStack(spacing: 12) {
                    RowLabel(title: item.text, detail: item.detail)
                    Spacer(minLength: 8)
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
                                .lineLimit(1)
                            Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.semibold))
                        }
                        .foregroundStyle(.secondary)
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
    @State private var text = ""
    @State private var editing = false
    @FocusState private var focused: Bool

    private static let dateFormat: DateFormatter = {
        let format = DateFormatter()
        format.calendar = Calendar(identifier: .gregorian)
        format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = TimeZone(secondsFromGMT: 0)
        format.dateFormat = "yyyy-MM-dd"
        return format
    }()

    var body: some View {
        if item.input == "date" {
            let date = Self.dateFormat.date(from: item.value?.string ?? "") ?? .now
            DatePicker(selection: Binding(get: { date }, set: { shell.act(item.ref, .commit, Self.dateFormat.string(from: $0)) }),
                       displayedComponents: .date) {
                RowLabel(title: item.text, detail: item.detail)
            }
            .disabled(item.isDisabled)
        } else if item.input == "number" {
            HStack(spacing: 10) {
                if let well = item.well {
                    ColorPicker(selection: Binding(get: { Color(hex: well.value?.string) ?? .white }, set: { color in
                        shell.act(well.ref, .input, color.hexString)
                    }), supportsOpacity: false) { Text(well.title ?? "Color") }
                    .labelsHidden()
                    .fixedSize()
                }
                RowLabel(title: item.text, detail: item.detail)
                Spacer(minLength: 8)
                NumberEntry(control: SubControl(ref: item.ref ?? "", value: item.value, disabled: item.disabled,
                                                title: item.title, unit: item.unit))
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                if !item.text.isEmpty { Text(item.text).font(.footnote).foregroundStyle(.secondary) }
                field
            }
            .onAppear { text = item.value?.string ?? "" }
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
                .font(.footnote.monospacedDigit())
                .multilineTextAlignment(.trailing)
                .keyboardType(.numbersAndPunctuation)
                .submitLabel(.done)
                .focused($focused)
                .frame(width: 64)
                .padding(.vertical, 4)
                .padding(.horizontal, 7)
                .background(.fill.tertiary, in: .rect(cornerRadius: 7))
                .onSubmit(commit)
                .onChange(of: focused) { if !focused { commit() } }
            if let unit = control.unit, !unit.isEmpty {
                Text(unit).font(.footnote).foregroundStyle(.secondary)
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
            shell.act(ref, .input, color.hexString)
        }), supportsOpacity: false) {
            Text(title.isEmpty ? "Custom color" : title)
        }
    }
}

/// A web button. Its role decides how it reads: a primary action, a link-like
/// action, a destructive one, or a row that opens another page.
struct ButtonRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem

    var body: some View {
        switch item.role {
        case "primary":
            Button { shell.act(item.ref) } label: {
                Label(item.text, systemImage: Symbols.icon(item.icon) ?? "checkmark")
                    .labelStyle(.titleOnly)
                    .frame(maxWidth: .infinity)
                    .fontWeight(.semibold)
            }
            .buttonStyle(.glassProminent)
            .disabled(item.isDisabled)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
        case "navigate", "group", "option":
            Button { shell.act(item.ref) } label: {
                HStack {
                    RowLabel(title: item.text, detail: item.detail)
                        .foregroundStyle(.primary)
                    Spacer()
                    if item.role != "option" {
                        Image(systemName: item.role == "group" ? "chevron.up.chevron.down" : "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(item.isDisabled)
        default:
            Button(role: item.role == "destructive" ? .destructive : nil) { shell.act(item.ref) } label: {
                HStack(spacing: 10) {
                    if let symbol = Symbols.icon(item.icon) {
                        Image(systemName: symbol).frame(width: 20)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.text)
                        if let detail = item.detail, !detail.isEmpty {
                            Text(detail).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                    if item.pressed == true {
                        Image(systemName: "checkmark").font(.caption.weight(.bold))
                    } else if item.expanded != nil {
                        Image(systemName: "chevron.down")
                            .font(.caption.weight(.semibold))
                            .rotationEffect(.degrees(item.expanded == true ? 180 : 0))
                            .foregroundStyle(.tertiary)
                    }
                }
                .contentShape(.rect)
            }
            .disabled(item.isDisabled)
            .accessibilityLabel(item.accessibility ?? item.text)
        }
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
                    Image(systemName: "arrow.up.forward").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
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
                RowLabel(title: item.text, detail: item.detail)
                Spacer(minLength: 8)
                if let value = item.value?.string, !value.isEmpty {
                    Text(value).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                }
            }
        case "pair":
            LabeledContent(item.text, value: item.value?.string ?? "")
        case "warning":
            Label { content } icon: { Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange) }
                .font(.footnote)
        case "success":
            Label { content } icon: { Image(systemName: "checkmark.circle").foregroundStyle(.green) }
                .font(.footnote)
        case "status":
            Label { content } icon: { Image(systemName: "info.circle").foregroundStyle(.secondary) }
                .font(.footnote)
        case "hint":
            content.font(.caption).foregroundStyle(.secondary)
        default:
            content.font(.footnote)
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
    let src: String
    var contentMode: ContentMode = .fill

    var body: some View {
        if src.hasPrefix("data:") {
            if let image = DataImageCache.shared.image(for: src) {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else {
                Color.secondary.opacity(0.15)
            }
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
