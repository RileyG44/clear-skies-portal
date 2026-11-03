import SwiftUI

/// The markup tools as a task-shaped pane in the shared toolbar sheet
/// (CR-009). The tools, undo and redo stay above the scrolling settings, so
/// the actions used most never scroll away at the medium height. Colour,
/// shape and exact-size choices open in place, beside the control that asked
/// for them. Every control acts on the web markup toolbar's own element; see
/// markupItems in native-shell.js.
struct MarkupPanelContent: View {
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    let panel: ShellPanel
    @State private var discard: MarkupDiscard?

    private func first(_ kind: String) -> ShellItem? { panel.items.first { $0.kind == kind } }

    var body: some View {
        let tools = first("markupTools")
        let gallery = tools?.items ?? []
        let finish = first("markupFinish")
        let draftPoints = finish?.id == "finish" ? Int(finish?.value?.number ?? 0) : 0
        let draft = MarkupDraftGuard(points: draftPoints) { action, keepsWithPan, perform in
            discard = MarkupDiscard(action: action, points: draftPoints, keepsWithPan: keepsWithPan, perform: perform)
        }
        // At accessibility text sizes the tools are too tall to stay pinned
        // above the settings; they scroll with them instead of being squeezed.
        let pinned = !typeSize.isAccessibilitySize
        let controls = VStack(alignment: .leading, spacing: 8) {
            if let tools { MarkupToolBar(item: tools, draft: draft) }
            MarkupCommandRow(history: first("markupHistory"), finish: finish, draft: draft)
        }
        VStack(spacing: 0) {
            if pinned {
                controls
                    .padding(.horizontal, MenuMetrics.pageInset)
                    .padding(.top, 2)
                    .padding(.bottom, 6)
            }
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if !pinned { controls.id("markup:tools") }
                        if !gallery.isEmpty { MarkupShapeGallery(groups: gallery, draft: draft).id("markup:gallery") }
                        if let selection = first("markupSelection") { MarkupSelectionCard(item: selection) }
                        if let style = first("group") { MarkupStyleSection(item: style, scroll: proxy) }
                        if let marks = first("markupMarks"), !(marks.options ?? []).isEmpty { MarkupMarksSection(item: marks, draft: draft) }
                        if let layer = first("markupLayer") { MarkupLayerSection(item: layer, draft: draft) }
                    }
                    .padding(.horizontal, MenuMetrics.pageInset)
                    .padding(.top, 2)
                    .padding(.bottom, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .animation(reducedMotion ? nil : .snappy(duration: 0.25), value: gallery.isEmpty)
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollDismissesKeyboard(.interactively)
                .scrollEdgeEffectStyle(.soft, for: .top)
                .modifier(SheetScrollTracking())
                .scrollEdgeEffectStyle(.soft, for: .bottom)
                .onChange(of: gallery.isEmpty) {
                    // The gallery comes into view; once a shape is chosen,
                    // tools that scroll with the pane come back into view.
                    withAnimation(reducedMotion ? nil : .snappy) {
                        if !gallery.isEmpty { proxy.scrollTo("markup:gallery", anchor: .top) }
                        else if !pinned { proxy.scrollTo("markup:tools", anchor: .top) }
                    }
                }
            }
        }
        .background { MarkupBacking() }
        .onSheetGlass()
        .confirmationDialog("Discard the unfinished shape?", isPresented: Binding(get: { discard != nil }, set: { if !$0 { discard = nil } }),
                            titleVisibility: .visible, presenting: discard) { request in
            Button("Discard shape", role: .destructive) { request.perform() }
            Button("Keep drawing", role: .cancel) {}
        } message: { request in
            Text("\(request.action) removes its \(request.points) points." + (request.keepsWithPan ? " Pan keeps the shape, so you can move the map and add more." : ""))
        }
    }
}

/// One rule for every way of ending an unfinished freeform shape: another
/// tool, shape or layer, a listed mark, or Cancel. Each asks first.
struct MarkupDraftGuard {
    var points = 0
    var ask: (_ action: String, _ keepsWithPan: Bool, _ perform: @escaping () -> Void) -> Void = { _, _, perform in perform() }

    /// Runs `perform` now, or after confirmation when it would end a shape
    /// of at least `minimum` points.
    func protect(_ action: String, minimum: Int = 2, keepsWithPan: Bool = true, perform: @escaping () -> Void) {
        if points >= minimum { ask(action, keepsWithPan, perform) } else { perform() }
    }
}

struct MarkupDiscard: Identifiable {
    let id = UUID()
    let action: String
    let points: Int
    let keepsWithPan: Bool
    let perform: () -> Void
}

/// A calm neutral layer under the pane, so marks and imagery behind the
/// sheet's glass do not tint the controls or the colours being chosen.
struct MarkupBacking: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        Rectangle()
            .fill(scheme == .dark ? Color(white: 0.08).opacity(reduceTransparency ? 1 : 0.78)
                                  : Color(white: 0.97).opacity(reduceTransparency ? 1 : 0.8))
            .ignoresSafeArea()
            .allowsHitTesting(false)
    }
}

/// A markup card: nearly opaque, so colour judgements are not made through
/// the map, and fully opaque with Reduce Transparency.
struct MarkupCard: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, MenuMetrics.rowInset)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(scheme == .dark ? Color(white: 0.15).opacity(reduceTransparency ? 1 : 0.9)
                                        : Color.white.opacity(reduceTransparency ? 1 : 0.9), in: .rect(cornerRadius: 20))
    }
}

extension View {
    func markupCard() -> some View { modifier(MarkupCard()) }
}

/// A section heading and its scope on one line ("Pen style · For new marks").
struct MarkupHeading: View {
    let title: String
    var detail: String?

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title).fontWeight(.semibold)
                if let detail, !detail.isEmpty {
                    Text("·").accessibilityHidden(true)
                    Text(detail).fontWeight(.regular)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).fontWeight(.semibold)
                if let detail, !detail.isEmpty { Text(detail).fontWeight(.regular) }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .portalFont(.footnote)
        .foregroundStyle(MenuSecondary())
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// Tool, shape and action glyphs, and the names VoiceOver reads for them.
enum MarkupSymbols {
    static func tool(_ tool: String, shape: ShellValue?) -> String {
        switch tool {
        case "select": "cursorarrow"
        case "pan": "hand.raised"
        case "pen": "pencil"
        case "highlight": "highlighter"
        case "eraser": "eraser"
        case "shape": Self.shape(shape?.string)
        case "text": "textformat"
        case "pin": "mappin"
        default: "circle"
        }
    }

    static func toolName(_ tool: String, fallback: String) -> String {
        switch tool {
        case "select": "Select, move and resize"
        case "pan": "Pan the map"
        case "highlight": "Highlighter"
        default: fallback
        }
    }

    static func shape(_ id: String?) -> String {
        switch id {
        case "line": "line.diagonal"
        case "arrow": "arrow.up.right"
        case "arrow2": "arrow.up.left.and.arrow.down.right"
        case "rect": "rectangle"
        case "roundrect": "app"
        case "ellipse": "oval"
        case "triangle": "triangle"
        case "rtriangle": "righttriangle"
        case "diamond": "diamond"
        case "pentagon": "pentagon"
        case "hexagon": "hexagon"
        case "octagon": "octagon"
        case "star": "star"
        case "star4": "sparkle"
        case "blockarrow": "arrowshape.right"
        case "heart": "heart"
        case "lightning": "bolt"
        case "freeform": "point.3.connected.trianglepath.dotted"
        default: "square.on.circle"
        }
    }

    static func shapeName(_ id: String?) -> String {
        switch id {
        case "line": "Line"
        case "arrow": "Arrow"
        case "arrow2": "Double arrow"
        case "rect": "Rectangle"
        case "roundrect": "Rounded rectangle"
        case "ellipse": "Oval"
        case "triangle": "Triangle"
        case "rtriangle": "Right triangle"
        case "diamond": "Diamond"
        case "pentagon": "Pentagon"
        case "hexagon": "Hexagon"
        case "octagon": "Octagon"
        case "star": "Star"
        case "star4": "Four-point star"
        case "blockarrow": "Block arrow"
        case "heart": "Heart"
        case "lightning": "Lightning"
        case "freeform": "Freeform"
        default: ""
        }
    }

    static func action(_ id: String?) -> (title: String, symbol: String) {
        switch id {
        case "edit-text": ("Edit text", "character.cursor.ibeam")
        case "points": ("Edit points", "pencil.and.outline")
        case "duplicate": ("Duplicate", "plus.square.on.square")
        case "delete": ("Delete", "trash")
        default: ("", "circle")
        }
    }
}

/// All eight tools at once, in the web's order, wrapping into more rows
/// rather than shrinking labels or scrolling tools out of sight. Switching
/// away from an unfinished freeform shape asks first, except to Pan.
struct MarkupToolBar: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @ScaledMetric(relativeTo: .body) private var glyph: CGFloat = 17
    let item: ShellItem
    /// Most tool changes end an unfinished freeform shape; they ask first.
    var draft = MarkupDraftGuard()
    @State private var pending: String?
    @State private var failed: String?
    @State private var width: CGFloat = 0
    @State private var labelledWidth: CGFloat = 0

    private enum Style { case row, grid, menu }

    var body: some View {
        let options = item.options ?? []
        let selected = pending ?? options.first { $0.selected == true }?.value
        // One labelled row when it fits whole; two rows of named tiles on
        // narrower phones; a single tool menu at accessibility sizes, so the
        // tools never fill the pane and every tool keeps its name.
        let style: Style = typeSize.isAccessibilitySize ? .menu : width == 0 || labelledWidth <= width ? .row : .grid
        VStack(alignment: .leading, spacing: 6) {
            Group {
                switch style {
                case .row: row(options, selected: selected)
                case .grid: grid(options, selected: selected)
                case .menu: menu(options, selected: selected)
                }
            }
            .frame(maxWidth: .infinity)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .background {
                row(options, selected: selected)
                    .fixedSize()
                    .hidden()
                    .accessibilityHidden(true)
                    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { labelledWidth = $0 }
            }
            if let failed { MarkupNotice(text: failed) }
        }
        .animation(reducedMotion ? nil : .snappy(duration: 0.2), value: failed)
        .sensoryFeedback(.selection, trigger: selected)
        .onChange(of: item.options) { pending = nil }
        // A press the web did not take (a stale control) must not leave the
        // tile showing a tool that is not in use, and should say so.
        .task(id: pending) {
            guard let wanted = pending, await markupConfirmationExpired() else { return }
            pending = nil
            if options.first(where: { $0.value == wanted })?.selected != true {
                failed = "The tool didn't change. Try again."
                do { try await Task.sleep(for: .seconds(3)) } catch { return }
                failed = nil
            }
        }
    }

    private func row(_ options: [ItemOption], selected: String?) -> some View {
        HStack(spacing: 4) {
            ForEach(options) { option in tile(option, on: option.value == selected, compact: false) }
        }
    }

    /// Two rows of named tiles, icon beside label, each 44 points tall.
    private func grid(_ options: [ItemOption], selected: String?) -> some View {
        let half = (options.count + 1) / 2
        return Grid(horizontalSpacing: 4, verticalSpacing: 4) {
            ForEach([Array(options.prefix(half)), Array(options.dropFirst(half))], id: \.self) { row in
                GridRow { ForEach(row) { option in tile(option, on: option.value == selected, compact: true) } }
            }
        }
    }

    private func menu(_ options: [ItemOption], selected: String?) -> some View {
        let current = options.first { $0.value == selected }
        return Menu {
            ForEach(options) { option in
                Button { press(option) } label: {
                    Label(option.label, systemImage: option.value == selected ? "checkmark" : MarkupSymbols.tool(option.value ?? "", shape: item.value))
                }
                .disabled(option.disabled ?? false)
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: MarkupSymbols.tool(selected ?? "", shape: item.value))
                Text("Tool: \(current?.label ?? "None")").fontWeight(.semibold)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down").portalFont(.footnote, weight: .semibold)
            }
            .foregroundStyle(PortalPrimary())
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .background(.fill.tertiary, in: .rect(cornerRadius: 14))
            .contentShape(.rect(cornerRadius: 14))
        }
        .menuOrder(.fixed)
        .buttonStyle(.plain)
        .accessibilityLabel("Tool")
        .accessibilityValue(current.map { MarkupSymbols.toolName($0.value ?? "", fallback: $0.label) } ?? "")
        .accessibilityHint("Chooses what a touch on the map does")
    }

    private func press(_ option: ItemOption) {
        let tool = option.value ?? ""
        failed = nil
        if tool == "pan" || tool == "shape" { choose(option) }
        else { draft.protect("Switching to \(option.label)") { choose(option) } }
    }

    private func choose(_ option: ItemOption) {
        pending = option.value
        shell.act(option.ref)
    }

    private func tile(_ option: ItemOption, on: Bool, compact: Bool) -> some View {
        let tool = option.value ?? ""
        let shapes = tool == "shape"
        let glyphs = HStack(spacing: 2) {
            Image(systemName: MarkupSymbols.tool(tool, shape: item.value))
                .font(.system(size: glyph, weight: on ? .semibold : .regular))
            // Shapes opens a gallery: the tile says so, not only VoiceOver.
            if shapes {
                Image(systemName: item.expanded == true ? "chevron.up" : "chevron.down")
                    .font(.system(size: glyph * 0.45, weight: .bold))
                    .accessibilityHidden(true)
            }
        }
        let label = Text(option.label)
            .portalFont(compact ? .footnote : .caption2, weight: on ? .semibold : .regular)
            .lineLimit(1)
            .fixedSize()
        return Button { press(option) } label: {
            Group {
                if compact {
                    HStack(spacing: 6) { glyphs; label }.padding(.horizontal, 6)
                } else {
                    VStack(spacing: 3) { glyphs.frame(minHeight: glyph + 5); label.padding(.horizontal, 4) }
                }
            }
            .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(PortalPrimary()))
            .frame(minWidth: 44, maxWidth: .infinity, minHeight: compact ? 44 : 52)
            .background(on ? AnyShapeStyle(.tint.opacity(0.16)) : AnyShapeStyle(.fill.tertiary), in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.clear), lineWidth: 1))
            .contentShape(.rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(option.disabled ?? false)
        .accessibilityLabel(MarkupSymbols.toolName(tool, fallback: option.label))
        .accessibilityValue(shapes ? MarkupSymbols.shapeName(item.value?.string) : "")
        .accessibilityHint(shapes ? (item.expanded == true ? "Hides the shape choices" : "Shows the shape choices") : "")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// What a touch on the map does now, with undo and redo always in reach. A
/// freeform shape in progress has its own controls here: Finish once it has
/// three points, take back the last point, or cancel it.
struct MarkupCommandRow: View {
    @Environment(ShellModel.self) private var shell
    let history: ShellItem?
    let finish: ShellItem?
    var draft = MarkupDraftGuard()

    var body: some View {
        Group {
            if let finish, finish.id == "finish" {
                VStack(alignment: .leading, spacing: 6) {
                    // Every draft action named where it fits; icons only as a last resort.
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) {
                            finishButton(finish)
                            Spacer(minLength: 0)
                            draftButtons(finish, labelled: true)
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            finishButton(finish)
                            draftButtons(finish, labelled: true)
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 8) { finishButton(finish); draftButtons(finish, labelled: true, only: ["resume-shape"]) }
                            draftButtons(finish, labelled: true, only: ["undo-point", "cancel-shape"])
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            finishButton(finish)
                            draftButtons(finish, labelled: false)
                        }
                    }
                    hint
                }
            } else {
                HStack(spacing: 10) {
                    hint.frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 8) {
                        ForEach(ItemRows.keyed(history?.buttons ?? [], prefix: "markup-history"), id: \.0) { _, button in
                            let redo = button.id == "redo"
                            circle(redo ? "arrow.uturn.forward" : "arrow.uturn.backward", label: redo ? "Redo" : "Undo", button: button)
                        }
                    }
                }
                .frame(minHeight: 44)
            }
        }
        // Each tapped point changes the count and, at three, makes Finish
        // available: say so to VoiceOver, which cannot see the button change.
        .onChange(of: finish?.value) {
            if finish?.id == "finish", let text = history?.title { UIAccessibility.post(notification: .announcement, argument: text) }
        }
    }

    private func finishButton(_ finish: ShellItem) -> some View {
        Button { shell.act(finish.ref) } label: {
            Label("Finish shape", systemImage: "checkmark").fontWeight(.semibold)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .disabled(finish.isDisabled)
        .accessibilityHint(finish.isDisabled ? "A shape needs at least three points" : "Closes the shape with the points placed so far")
    }

    private func draftButtons(_ finish: ShellItem, labelled: Bool, only: Set<String>? = nil) -> some View {
        let buttons = (finish.buttons ?? []).filter { only?.contains($0.id ?? "") ?? true }
        return HStack(spacing: 8) {
            ForEach(ItemRows.keyed(buttons, prefix: "markup-draft"), id: \.0) { _, button in
                let cancel = button.id == "cancel-shape"
                let (title, symbol, spoken): (String, String, String) = switch button.id {
                case "resume-shape": ("Add points", "plus", "Add points")
                case "cancel-shape": ("Cancel", "xmark", "Cancel shape")
                default: ("Undo point", "arrow.uturn.backward", "Undo last point")
                }
                // Cancelling a substantial shape asks first, like every other way of ending it.
                let press: () -> Void = {
                    if cancel { draft.protect("Cancelling", minimum: 3, keepsWithPan: false) { shell.act(button.ref) } }
                    else { shell.act(button.ref) }
                }
                if labelled || button.id == "resume-shape" {
                    Button(role: cancel ? .destructive : nil, action: press) {
                        Label(title, systemImage: symbol).fontWeight(.medium).fixedSize()
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .disabled(button.isDisabled)
                    .accessibilityLabel(spoken)
                } else {
                    circle(symbol, label: spoken, button: button, action: press)
                }
            }
        }
    }

    private var hint: some View {
        Text(history?.text ?? "")
            .portalFont(.footnote)
            .foregroundStyle(MenuSecondary())
            .fixedSize(horizontal: false, vertical: true)
    }

    /// A round action; an unavailable one recedes rather than keeping its
    /// glass. The glyph follows Dynamic Type and the circle grows around it.
    private func circle(_ symbol: String, label: String, button: ShellItem, action: (() -> Void)? = nil) -> some View {
        Button { if let action { action() } else { shell.act(button.ref) } } label: {
            Image(systemName: symbol)
                .portalFont(.body, weight: .medium)
                .foregroundStyle(button.isDisabled ? AnyShapeStyle(.tertiary) : AnyShapeStyle(PortalPrimary()))
                .padding(10)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .background { if button.isDisabled { Circle().strokeBorder(.quaternary, lineWidth: 1) } }
        .modifier(EnabledGlass(enabled: !button.isDisabled))
        .disabled(button.isDisabled)
        .accessibilityLabel(label)
    }
}

/// Glass on available round actions only.
private struct EnabledGlass: ViewModifier {
    let enabled: Bool
    func body(content: Content) -> some View {
        if enabled { content.menuGlass(in: .circle) } else { content }
    }
}

/// Shapes as pictures, opened from the Shapes tool, in the web's two groups.
struct MarkupShapeGallery: View {
    @Environment(ShellModel.self) private var shell
    @ScaledMetric(relativeTo: .body) private var glyph: CGFloat = 20
    let groups: [ShellItem]
    var draft = MarkupDraftGuard()
    @State private var pending: String?
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            MarkupHeading(title: "Choose a shape")
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
                    let options = group.options ?? []
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(group.text).fontWeight(.semibold)
                            if let chosen = options.first(where: { isOn($0) })?.label {
                                Text("· \(chosen)").foregroundStyle(PortalPrimary())
                            }
                        }
                        .portalFont(.footnote)
                        .foregroundStyle(MenuSecondary())
                        .padding(.top, 4)
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.isHeader)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 50), spacing: 8)], spacing: 8) {
                            ForEach(options) { option in shape(option, on: isOn(option)) }
                        }
                    }
                }
            }
            .markupCard()
            if failed { MarkupNotice(text: "The shape didn't change. Try again.") }
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
        .onChange(of: groups) { pending = nil; failed = false }
        .task(id: pending) {
            guard let wanted = pending, await markupConfirmationExpired() else { return }
            pending = nil
            failed = groups.flatMap { $0.options ?? [] }.first { $0.value == wanted }?.selected != true
        }
    }

    private func choose(_ option: ItemOption) {
        pending = option.value
        shell.act(option.ref)
    }

    /// Choosing the shape already in use resumes it; only a change ends a draft.
    private func press(_ option: ItemOption) {
        failed = false
        if option.selected == true { choose(option) }
        else { draft.protect("Choosing \(option.label)", keepsWithPan: false) { choose(option) } }
    }

    private func isOn(_ option: ItemOption) -> Bool {
        pending.map { $0 == option.value } ?? (option.selected == true)
    }

    private func shape(_ option: ItemOption, on: Bool) -> some View {
        Button { press(option) } label: {
            Image(systemName: MarkupSymbols.shape(option.value))
                .font(.system(size: glyph, weight: on ? .semibold : .regular))
                .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(PortalPrimary()))
                .frame(maxWidth: .infinity, minHeight: max(48, glyph * 2.4))
                .background(on ? AnyShapeStyle(.tint.opacity(0.16)) : AnyShapeStyle(.fill.tertiary), in: .rect(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.clear), lineWidth: 1))
                .contentShape(.rect(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The selected mark and what can be done with it, above the style it uses.
struct MarkupSelectionCard: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem

    var body: some View {
        let buttons = ItemRows.keyed(item.buttons ?? [], prefix: "markup-selection")
        VStack(alignment: .leading, spacing: 6) {
            // The heading and Show on map share a line while both fit whole.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    MarkupHeading(title: "Selected \(item.text.lowercased())").fixedSize()
                    Spacer(minLength: 8)
                    showOnMap.fixedSize()
                }
                VStack(alignment: .leading, spacing: 0) {
                    MarkupHeading(title: "Selected \(item.text.lowercased())").fixedSize(horizontal: false, vertical: true)
                    showOnMap.fixedSize(horizontal: false, vertical: true)
                }
            }
            // Actions in one row when their names fit whole; otherwise one per row.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { ForEach(buttons, id: \.0) { _, button in action(button) } }
                VStack(spacing: 8) { ForEach(buttons, id: \.0) { _, button in action(button) } }
            }
        }
    }

    /// Configuring hides much of the map: one tap brings the selected mark
    /// back into view above the pane.
    private var showOnMap: some View {
        Button { shell.revealSelectedMark() } label: {
            Label("Show on map", systemImage: "scope").portalFont(.footnote, weight: .medium)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.tint)
        .frame(minHeight: 44)
        .contentShape(.rect)
        .accessibilityHint("Lowers the tools and moves the map to show the selected mark")
    }

    private func action(_ button: ShellItem) -> some View {
        let (title, symbol) = MarkupSymbols.action(button.id)
        let destructive = button.id == "delete", on = button.pressed == true
        return Button(role: destructive ? .destructive : nil) { shell.act(button.ref) } label: {
            Label(title.isEmpty ? button.text : title, systemImage: symbol)
                .portalFont(.subheadline, weight: .medium)
                .labelStyle(.titleAndIcon)
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(destructive ? AnyShapeStyle(.red) : on ? AnyShapeStyle(.tint) : AnyShapeStyle(PortalPrimary()))
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(on ? AnyShapeStyle(.tint.opacity(0.16)) : AnyShapeStyle(.fill.tertiary), in: .rect(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.clear), lineWidth: 1))
                .contentShape(.rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(button.isDisabled)
        .accessibilityLabel(title.isEmpty ? button.text : title)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The style the tool draws with, or the selected mark's: one compact row
/// per setting, each with its label and value once.
struct MarkupStyleSection: View {
    let item: ShellItem
    let scroll: ScrollViewProxy

    /// Keys that survive the web rebuilding its toolbar (and so its refs),
    /// keeping an open exact-size field and the palette's family in place,
    /// but only for one owner: a change of layer, tool or mark resets them.
    static func key(_ row: ShellItem, owner: String?) -> String { "\(owner ?? "")|\(row.kind):\(row.id ?? row.text)" }

    var body: some View {
        let rows = (item.items ?? []).map { (Self.key($0, owner: item.id), $0) }
        VStack(alignment: .leading, spacing: 8) {
            MarkupHeading(title: item.text, detail: item.detail)
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(rows.enumerated()), id: \.element.0) { index, entry in
                    if index > 0 { Divider().opacity(0.5) }
                    let key = entry.0, row = entry.1
                    switch row.kind {
                    case "markupColor": MarkupColorRow(item: row, scroll: scroll, scrollID: key).id(key)
                    case "markupSize": MarkupSizeRow(item: row, owner: item.id).id(key)
                    case "slider": SliderRow(item: row, inline: true, tint: markupTrack).frame(minHeight: 44)
                    default: ItemView(item: row, key: key)
                    }
                }
            }
            .markupCard()
        }
    }
}

/// A colour setting as its swatch. Its choices open beneath it, and the
/// row says when a fill is none or follows the outline.
struct MarkupColorRow: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    let item: ShellItem
    let scroll: ScrollViewProxy
    let scrollID: String

    private var fill: Bool { item.id == "fill" }
    private var title: String { fill ? "Fill" : item.text.replacingOccurrences(of: " (no outline)", with: "") }
    /// "None", "Same as outline", a palette name, or nothing for a custom colour.
    private var valueText: String? {
        switch item.value?.string {
        case "none": "None"
        case "auto": "Same as outline"
        default: MarkupPalette.name(hex: item.color)
        }
    }

    var body: some View {
        let open = item.expanded == true
        VStack(alignment: .leading, spacing: 10) {
            Button { shell.act(item.ref) } label: {
                // The value moves under the title rather than truncating.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) {
                        Text(title).foregroundStyle(PortalPrimary()).fixedSize()
                        Spacer(minLength: 8)
                        summary(open)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(title).foregroundStyle(PortalPrimary()).fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 10) {
                            summary(open)
                            Spacer(minLength: 0)
                        }
                    }
                }
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(title)
            .accessibilityValue(valueText ?? item.color ?? "")
            .accessibilityHint(open ? "Hides the colours" : "Shows the colours")
            if open {
                if fill {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { mode("none", "No fill"); mode("auto", "Same as outline") }
                        VStack(spacing: 8) { mode("none", "No fill"); mode("auto", "Same as outline") }
                    }
                }
                MarkupPalette(chip: item, options: item.options ?? [], memory: scrollID)
                if let custom = item.custom {
                    ColorPicker(selection: Binding(get: { Color(hex: custom.value?.string) ?? .red }, set: { color in
                        shell.act(custom.ref, .commit, color.hexString)
                    }), supportsOpacity: false) {
                        Text(custom.title ?? "Custom colour").foregroundStyle(PortalPrimary())
                    }
                    .frame(minHeight: 44)
                }
            }
        }
        .padding(.vertical, 2)
        .animation(reducedMotion ? nil : .snappy(duration: 0.22), value: open)
        .onChange(of: open) {
            // An opened palette is brought into view, even from the medium height.
            if open { withAnimation(reducedMotion ? nil : .snappy) { scroll.scrollTo(scrollID, anchor: UnitPoint(x: 0.5, y: 0.06)) } }
        }
    }

    /// The colour in use: its name or mode, its swatch, and the disclosure.
    private func summary(_ open: Bool) -> some View {
        HStack(spacing: 10) {
            if let valueText {
                Text(valueText).portalFont(.footnote).foregroundStyle(MenuSecondary()).fixedSize()
            }
            if let color = Color(hex: item.color) {
                Circle().fill(color)
                    .overlay(Circle().strokeBorder(.primary.opacity(0.2), lineWidth: 0.5))
                    .frame(width: 26, height: 26)
            } else {
                Image(systemName: "circle.slash").font(.system(size: 22)).foregroundStyle(MenuSecondary())
            }
            Image(systemName: "chevron.down")
                .portalFont(.caption, weight: .semibold)
                .foregroundStyle(.tertiary)
                .rotationEffect(.degrees(open ? 180 : 0))
        }
    }

    /// Fill's two special cases, as the web's own buttons (data-pick).
    private func mode(_ pick: String, _ label: String) -> some View {
        let on = item.value?.string == pick
        return Button { shell.act(item.ref, .pick, pick) } label: {
            HStack(spacing: 6) {
                if on { Image(systemName: "checkmark").portalFont(.caption, weight: .bold) }
                Text(label).portalFont(.footnote, weight: .medium).fixedSize()
            }
            .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(PortalPrimary()))
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(on ? AnyShapeStyle(.tint.opacity(0.16)) : AnyShapeStyle(.fill.tertiary), in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The web's palette as ten colour families, then the five shades of the
/// family shown, every target 44 points. Families browse; a shade applies
/// and closes the palette. VoiceOver reads names, not hex codes.
struct MarkupPalette: View {
    @Environment(ShellModel.self) private var shell
    let chip: ShellItem
    let options: [ItemOption]
    /// The colour setting and its owner: a family browsed there opens again
    /// there, after a shade closes the palette.
    var memory = ""
    @MainActor private static var families: [String: Int] = [:]
    @State private var family: Int?
    @State private var pending: String?
    @State private var failed = false

    private static let hues = ["red", "orange", "yellow", "green", "blue", "teal", "purple", "pink", "brown", "grey"]
    private static let shades = ["Pale", "Light", "", "Dark", "Deep"]
    private static let greys = ["White", "Light grey", "Grey", "Dark grey", "Black"]
    /// The web's palette order, hue by hue (COLOR_GRID in markup.js).
    private static let palette = ["#ffb3ae", "#ff7a70", "#ff3b30", "#d70015", "#8e0b0b", "#ffd2a1", "#ffb35c", "#ff9500", "#c96a00", "#7a3e00",
                                  "#fff2a8", "#ffe066", "#ffcc00", "#c99a00", "#7a5c00", "#b7f0c4", "#6fdc8c", "#34c759", "#248a3d", "#14532d",
                                  "#a8d4ff", "#5eb0ff", "#0a84ff", "#0055c4", "#003170", "#a6f0ec", "#4fdcd4", "#00c7be", "#00918a", "#00524e",
                                  "#e3c4f7", "#cf8ef0", "#af52de", "#8a2bb8", "#521571", "#ffc2d6", "#ff8fb1", "#ff2d55", "#c2002e", "#70001c",
                                  "#e8d2b8", "#c9a77c", "#a2845e", "#7a5c3a", "#4a3520", "#ffffff", "#d1d1d6", "#8e8e93", "#3a3a3c", "#000000"]

    /// "Light blue" for a palette colour; nil for any other.
    static func name(hex: String?) -> String? {
        guard let hex, let index = palette.firstIndex(of: hex.lowercased()) else { return nil }
        let hue = index / 5, shade = index % 5
        if hues[hue] == "grey" { return greys[shade] }
        return shades[shade].isEmpty ? hues[hue].capitalized : "\(shades[shade]) \(hues[hue])"
    }

    private var applied: Int? {
        options.firstIndex { option in pending.map { $0 == option.value } ?? (option.selected == true) }
    }

    var body: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 5)
        Group {
            if options.count == 50 {
                // Families only browse; a shade is what is applied. The
                // family of the colour in use opens with its shades shown.
                let shown = family ?? applied.map { $0 / 5 }
                VStack(alignment: .leading, spacing: 8) {
                    caption(shown == nil ? "Choose a colour family" : "Colour family")
                    LazyVGrid(columns: columns, spacing: 8) {
                        ForEach(0..<10, id: \.self) { index in familyChip(index, on: shown == index) }
                    }
                    if failed { MarkupNotice(text: "The colour didn't change. Try again.") }
                    if let shown {
                        caption(shown == 9 ? "Greys · tap one to use it" : "Shades of \(Self.hues[shown]) · tap one to use it")
                            .padding(.top, 4)
                        LazyVGrid(columns: columns, spacing: 8) {
                            ForEach(0..<5, id: \.self) { shade in
                                let index = shown * 5 + shade
                                swatch(options[index], applied: applied == index)
                            }
                        }
                    }
                }
            } else {
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(options.indices, id: \.self) { index in swatch(options[index], applied: applied == index) }
                }
            }
        }
        .onChange(of: options) { pending = nil; failed = false }
        .onAppear { if family == nil { family = Self.families[memory] } }
        .task(id: pending) {
            guard let wanted = pending, await markupConfirmationExpired() else { return }
            pending = nil
            failed = options.first(where: { $0.value == wanted })?.selected != true
        }
    }

    private func caption(_ text: String) -> some View {
        Text(text).portalFont(.caption).foregroundStyle(MenuSecondary()).accessibilityAddTraits(.isHeader)
    }

    /// A family, as a tab rather than a colour to use: a small dot inside a
    /// 44-point target, ringed when its shades are the ones showing.
    private func familyChip(_ index: Int, on: Bool) -> some View {
        Button {
            family = index
            Self.families[memory] = index
        } label: {
            Circle()
                .fill(Color(hex: options[index * 5 + 2].color) ?? .clear)
                .overlay(Circle().strokeBorder(.primary.opacity(0.18), lineWidth: 0.5))
                .frame(width: 22, height: 22)
                .padding(4)
                .overlay(Circle().strokeBorder(on ? AnyShapeStyle(PortalPrimary()) : AnyShapeStyle(.clear), lineWidth: 2))
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(on ? AnyShapeStyle(.fill.tertiary) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 10))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(index == 9 ? "Greys" : Self.hues[index].capitalized)
        .accessibilityHint("Shows its shades")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    /// A colour to use: pressing it applies it through the web's own swatch.
    private func swatch(_ option: ItemOption, applied: Bool) -> some View {
        Button {
            pending = option.value
            shell.act(chip.ref, .pick, option.value ?? "")
        } label: {
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(hex: option.color) ?? .clear)
                .frame(maxWidth: .infinity, minHeight: 44, maxHeight: 44)
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.primary.opacity(0.18), lineWidth: 0.5))
                .overlay {
                    if applied {
                        RoundedRectangle(cornerRadius: 13).strokeBorder(PortalPrimary(), lineWidth: 2.5).padding(-4)
                        Image(systemName: "checkmark")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Self.light(option.color) ? Color.black : Color.white)
                    }
                }
                .padding(.horizontal, 2)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Self.name(hex: option.color) ?? option.label)
        .accessibilityAddTraits(applied ? .isSelected : [])
    }

    /// Whether a colour is light enough to need a dark checkmark.
    private static func light(_ hex: String?) -> Bool {
        guard let hex, hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else { return false }
        let r = Double((value >> 16) & 0xff), g = Double((value >> 8) & 0xff), b = Double(value & 0xff)
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6
    }
}

/// A ground size: its slider, and its value, which opens an exact field in
/// the row. A typed number goes through the web's own field and checks; a
/// rejected one keeps that field open here with the web's message. The
/// field belongs to the mark it was opened for and closes if that changes.
struct MarkupSizeRow: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dynamicTypeSize) private var typeSize
    let item: ShellItem
    /// The layer, tool and mark this size belongs to (markupOwner).
    var owner: String?
    @State private var editorWidth: CGFloat = 0
    /// Bumped when the field closes, so a reply to an older submission is ignored.
    @State private var generation = 0
    @State private var editing = false
    @State private var submitting = false
    @State private var text = ""
    @State private var problem: String?
    @FocusState private var focused: Bool

    private var key: String { String((item.id ?? "").split(separator: ":").first ?? "") }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if item.ref != nil {
                SliderRow(item: { var slider = item; slider.detail = nil; return slider }(), trailing: AnyView(valueButton), inline: true, tint: markupTrack)
                    .frame(minHeight: 44)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack {
                        Text(item.text)
                        Spacer(minLength: 8)
                        valueButton
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.text)
                        valueButton
                    }
                }
                .frame(minHeight: 44)
            }
            if editing { editor }
            if editing, let problem {
                Label(problem, systemImage: "exclamationmark.triangle")
                    .portalFont(.caption)
                    .foregroundStyle(markupWarning)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        // A value the web rejected outside this field (it is still open with
        // its message): show it here, ready to correct.
        .onAppear(perform: adoptRejection)
        .onChange(of: item.expanded) { adoptRejection() }
        .onDisappear { generation += 1 }
    }

    private var valueButton: some View {
        Button(action: begin) {
            HStack(spacing: 5) {
                Text(item.display ?? "").portalFont(.footnote, digits: true).lineLimit(1)
                Image(systemName: "pencil").portalFont(.caption2, weight: .semibold).foregroundStyle(MenuSecondary())
            }
            .foregroundStyle(PortalPrimary())
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.fill.tertiary, in: .capsule)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .fixedSize()
        .accessibilityLabel("\(item.text), \(item.display ?? "")")
        .accessibilityHint("Type an exact size in feet")
    }

    /// The field, then Set and Cancel; below it when the row is narrow.
    private var editor: some View {
        let stacked = typeSize.isAccessibilitySize || (editorWidth > 0 && editorWidth < 280)
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            HStack(spacing: 4) {
                TextField("Feet", text: $text)
                    .keyboardType(.numbersAndPunctuation)
                    .submitLabel(.done)
                    .focused($focused)
                    .onSubmit(submit)
                    .onChange(of: text) { problem = nil }
                    .accessibilityLabel("\(item.text) in feet")
                Text("ft").foregroundStyle(MenuSecondary())
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(.fill.tertiary, in: .capsule)
            HStack(spacing: 8) {
                Button(action: submit) {
                    if submitting { ProgressView() } else { Text("Set").fontWeight(.semibold) }
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .disabled(submitting)
                Button(action: cancel) {
                    Image(systemName: "xmark").fontWeight(.semibold).frame(width: 44, height: 44).contentShape(.circle)
                }
                .buttonStyle(.plain)
                .foregroundStyle(MenuSecondary())
                .accessibilityLabel("Cancel")
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { editorWidth = $0 }
    }

    private func adoptRejection() {
        guard item.expanded == true, let detail = item.detail, !editing, !submitting else { return }
        text = item.entry?.value?.string ?? ""
        editing = true
        reject(detail)
    }

    private func begin() {
        text = Self.format(item.edit?.value?.number)
        problem = nil
        editing = true
        focused = true
    }

    /// The field stays open, with its keyboard, until the web accepts the
    /// value; each rejection says why, to VoiceOver too.
    private func submit() {
        guard let edit = item.edit, !submitting else { return }
        guard let value = Self.parse(text) else {
            reject("Enter a number of feet, such as \(Self.format(2.5)).")
            return
        }
        submitting = true
        let session = generation
        Task {
            let result = await shell.enterValue(edit.ref, Self.invariant(value), key: key, owner: owner ?? "")
            // Cancelled, closed or replaced meanwhile: this reply is not for it.
            guard session == generation, editing else { return }
            submitting = false
            if result.accepted { close() } else { reject(result.message.isEmpty ? "That size could not be set. Try again." : result.message) }
        }
    }

    private func reject(_ message: String) {
        problem = message
        focused = true
        UIAccessibility.post(notification: .announcement, argument: message)
    }

    private func cancel() {
        // Escape in the web's own field discards it when a rejected value left it open.
        if item.expanded == true, let entry = item.entry { shell.act(entry.ref, .key, "Escape") }
        close()
    }

    private func close() {
        generation += 1
        submitting = false
        editing = false
        focused = false
        problem = nil
    }

    /// A number as the web reads it: "2.5", never "2,5" or "1,000".
    static func invariant(_ value: Double) -> String {
        let text = String(value)
        return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
    }

    /// A number as this phone writes it, for the field: "2.5" or "2,5".
    static func format(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "" }
        return value.formatted(.number.grouping(.never).precision(.fractionLength(0...4)))
    }

    /// A typed number of feet, read strictly in this phone's locale: its own
    /// decimal mark, its own grouping mark only in groups of three, and a
    /// lone point as a decimal point (the keyboard always offers one).
    /// Anything else, such as "1 2", or "2,5" where a comma groups thousands,
    /// is refused rather than guessed.
    static func parse(_ text: String, locale: Locale = .current) -> Double? {
        var typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        for unit in ["feet", "ft"] where typed.lowercased().hasSuffix(unit) {
            typed = String(typed.dropLast(unit.count)).trimmingCharacters(in: .whitespaces)
        }
        let decimal = locale.decimalSeparator ?? "."
        var grouping = locale.groupingSeparator ?? ","
        // A space that groups thousands comes in several widths.
        let spaces: Set<Character> = [" ", "\u{00a0}", "\u{202f}"]
        if grouping.count == 1, let mark = grouping.first, spaces.contains(mark) {
            typed = String(typed.map { spaces.contains($0) ? "\u{00a0}" : $0 })
            grouping = "\u{00a0}"
        }
        let finite = { (value: Double?) in value.flatMap { $0.isFinite ? $0 : nil } }
        if typed.range(of: #"^-?\d+(\.\d+)?$"#, options: .regularExpression) != nil {
            // "1.234" where a point groups thousands could mean either; ask.
            if grouping == ".", typed.range(of: #"^-?\d{1,3}(\.\d{3})+$"#, options: .regularExpression) != nil { return nil }
            return finite(Double(typed))
        }
        let g = NSRegularExpression.escapedPattern(for: grouping), d = NSRegularExpression.escapedPattern(for: decimal)
        guard typed.range(of: "^-?(\\d+|\\d{1,3}(\(g)\\d{3})+)(\(d)\\d+)?$", options: .regularExpression) != nil else { return nil }
        return finite(Double(typed.replacingOccurrences(of: grouping, with: "").replacingOccurrences(of: decimal, with: ".")))
    }
}

/// The layer being drawn on: switch to another, or edit its name and
/// description in place.
struct MarkupLayerSection: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dynamicTypeSize) private var typeSize
    let item: ShellItem
    /// Changing layers ends an unfinished freeform shape; it asks first.
    var draft = MarkupDraftGuard()
    @State private var pending: String?
    @State private var expanded = false
    @State private var failed = false

    var body: some View {
        let editingDetails = !(item.items ?? []).isEmpty
        VStack(alignment: .leading, spacing: 8) {
            // The layer's name stays in view; its description and actions
            // open on request, since they are used less than the style above.
            Button {
                expanded.toggle()
            } label: {
                HStack(spacing: 8) {
                    MarkupHeading(title: "Layer", detail: item.text)
                    Spacer(minLength: 8)
                    if !editingDetails {
                        Image(systemName: "chevron.down")
                            .portalFont(.caption, weight: .semibold)
                            .foregroundStyle(MenuSecondary())
                            .rotationEffect(.degrees(expanded ? 180 : 0))
                    }
                }
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(editingDetails)
            .accessibilityLabel("Layer, \(item.text)")
            .accessibilityValue(expanded || editingDetails ? "Expanded" : "Collapsed")
            .accessibilityHint("Shows the layer's description, and switching and editing it")
            if expanded || editingDetails {
            VStack(alignment: .leading, spacing: 12) {
                if let fields = item.items, !fields.isEmpty {
                    ForEach(ItemRows.keyed(fields, prefix: "markup-layer"), id: \.0) { _, field in
                        FieldRow(item: field, liveInput: true).textFieldStyle(.roundedBorder)
                    }
                    HStack(spacing: 10) {
                        ForEach(ItemRows.keyed(item.buttons ?? [], prefix: "markup-layer-actions"), id: \.0) { _, button in
                            let save = button.id == "save-layer-details"
                            Button { shell.act(button.ref) } label: {
                                Text(save ? "Save" : "Cancel").fontWeight(save ? .semibold : .medium).frame(maxWidth: .infinity)
                            }
                            .buttonStyle(save ? AnyPrimitiveButtonStyle(.glassProminent) : AnyPrimitiveButtonStyle(.glass))
                            .buttonBorderShape(.capsule)
                            .controlSize(.large)
                        }
                    }
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Circle().fill(Color(hex: item.color) ?? .accentColor).frame(width: 10, height: 10)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.text).fontWeight(.semibold).foregroundStyle(PortalPrimary())
                            Text(item.detail ?? "No description")
                                .portalFont(.caption)
                                .foregroundStyle(MenuSecondary())
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) { layerActions }
                        VStack(spacing: 10) { layerActions }
                    }
                }
            }
            .markupCard()
            }
            if failed { MarkupNotice(text: "The layer didn't change. Try again.") }
        }
        .onChange(of: item.value) { pending = nil; failed = false }
        .task(id: pending) {
            guard let wanted = pending, await markupConfirmationExpired() else { return }
            pending = nil
            failed = item.value?.string != wanted
        }
    }

    @ViewBuilder private var layerActions: some View {
        if let options = item.options, options.count > 1 { switcher(options) }
        if let edit = item.edit {
            Button { shell.act(edit.ref) } label: {
                Label("Edit details", systemImage: "pencil").fixedSize().frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .accessibilityHint("Edit this layer's name and description")
        }
    }

    private func switcher(_ options: [ItemOption]) -> some View {
        let selection = Binding(get: { pending ?? item.value?.string ?? "" }, set: { value in
            guard value != item.value?.string else { return }
            let name = options.first { ($0.value ?? $0.label) == value }?.label ?? "another layer"
            draft.protect("Drawing on \(name)", keepsWithPan: false) { select(value) }
        })
        return Menu {
            Picker("Draw on", selection: selection) {
                ForEach(options) { option in Text(option.label).tag(option.value ?? option.label) }
            }
            .pickerStyle(.inline)
        } label: {
            Label("Switch layer", systemImage: "square.stack.3d.up").fixedSize().frame(maxWidth: .infinity)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .accessibilityHint("Draw on another markup layer")
    }

    private func select(_ value: String) {
        pending = value
        shell.act(item.ref, .select, value)
    }
}

/// A button style chosen at run time.
struct AnyPrimitiveButtonStyle: PrimitiveButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: PrimitiveButtonStyle>(_ style: S) { make = { AnyView(style.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}

/// Markup drawing with its tools hidden, in place of the search bar: what a
/// map touch does now, a way back to the tools, and Done to stop drawing.
struct MarkupActiveCapsule: View {
    @Environment(ShellModel.self) private var shell
    let status: MarkupStatus

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                summary
                Spacer(minLength: 4)
                actions
            }
            VStack(alignment: .leading, spacing: 8) {
                summary
                HStack(spacing: 10) { actions }
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .frame(minHeight: 56)
        .menuGlass(in: .rect(cornerRadius: 28))
        .accessibilityElement(children: .contain)
    }

    private var summary: some View {
        HStack(spacing: 10) {
            Image(systemName: MarkupSymbols.tool(status.tool, shape: nil))
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                // What a touch on the map does now.
                Text(status.mode ?? "\(status.title) active")
                    .portalFont(.subheadline, weight: .semibold)
                    .foregroundStyle(PortalPrimary())
                    .fixedSize(horizontal: false, vertical: true)
                if let layer = status.layer {
                    Text(layer).portalFont(.caption).foregroundStyle(MenuSecondary()).lineLimit(1)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var actions: some View {
        Button { shell.showMarkupTools() } label: {
            Text("Show tools").fontWeight(.semibold).fixedSize()
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        if let done = status.done {
            Button { shell.act(done) } label: {
                Text("Done").fontWeight(.medium).fixedSize()
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .accessibilityHint("Stop drawing on this layer")
        }
    }
}

/// The layer's marks as a list: a way to choose one without a precise tap on
/// the map, and VoiceOver's route to every mark. Choosing one selects it
/// (switching to Select) and brings it into view above the pane.
struct MarkupMarksSection: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    /// Selecting a mark ends an unfinished freeform shape; it asks first.
    var draft = MarkupDraftGuard()
    #if DEBUG
    // `-cspDebugMarksExpanded YES` opens the list for visual verification.
    @State private var expanded = UserDefaults.standard.bool(forKey: "cspDebugMarksExpanded")
    #else
    @State private var expanded = false
    #endif
    @State private var failed = false

    var body: some View {
        let options = item.options ?? []
        let total = Int(item.value?.number ?? Double(options.count))
        VStack(alignment: .leading, spacing: 8) {
            Button {
                expanded.toggle()
            } label: {
                HStack {
                    MarkupHeading(title: item.text, detail: "\(total)")
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.down")
                        .portalFont(.caption, weight: .semibold)
                        .foregroundStyle(MenuSecondary())
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(item.text), \(total)")
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            .accessibilityHint("Lists every mark so one can be selected without tapping the map")
            if expanded {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(options.enumerated()), id: \.offset) { index, option in
                        if index > 0 { Divider().opacity(0.5) }
                        row(option)
                    }
                    // Every mark stays reachable: older ones load in pages.
                    if let more = item.edit {
                        Divider().opacity(0.5)
                        Button { shell.act(more.ref) } label: {
                            Label(more.title ?? "Show older marks", systemImage: "clock.arrow.circlepath")
                                .foregroundStyle(.tint)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .markupCard()
            }
            if failed { MarkupNotice(text: "That mark couldn't be selected. Try again.") }
        }
        .onChange(of: item.options) { failed = false }
    }

    /// A mark by its place in drawing order, its kind or shape, any text and
    /// its colour, so two rectangles can be told apart.
    private func row(_ option: ItemOption) -> some View {
        let colour = MarkupPalette.name(hex: option.color)
        return Button {
            failed = false
            draft.protect("Selecting \(option.label)", keepsWithPan: false) {
                Task { failed = !(await shell.selectMark(option.ref ?? "", fid: option.value ?? "")) }
            }
        } label: {
            HStack(spacing: 12) {
                Text(option.order.map { "\($0)" } ?? "")
                    .portalFont(.caption, weight: .semibold, digits: true)
                    .foregroundStyle(MenuSecondary())
                    .frame(minWidth: 22, alignment: .trailing)
                Image(systemName: Self.symbol(option))
                    .foregroundStyle(Color(hex: option.color) ?? .secondary)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.label).foregroundStyle(PortalPrimary()).fixedSize(horizontal: false, vertical: true)
                    if let colour { Text(colour).portalFont(.caption).foregroundStyle(MenuSecondary()) }
                }
                Spacer(minLength: 8)
                if option.selected == true { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([option.order.map { "Mark \($0)" }, option.label, colour].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(option.selected == true ? [.isButton, .isSelected] : .isButton)
        .accessibilityHint("Selects this mark and shows it on the map")
    }

    private static func symbol(_ option: ItemOption) -> String {
        switch option.kind {
        case "shape", "area", "rect", "circle": option.shape.map { MarkupSymbols.shape($0) } ?? "square.on.circle"
        case "pen": "pencil"
        case "highlight": "highlighter"
        case "line": "line.diagonal"
        case "arrow": "arrow.up.right"
        case "arrow2": "arrow.up.left.and.arrow.down.right"
        case "text": "textformat"
        case "pin": "mappin"
        default: "square.on.circle"
        }
    }
}

/// A short note that an action did not take, shown where it was tried and
/// read by VoiceOver, then cleared.
struct MarkupNotice: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "exclamationmark.circle")
            .portalFont(.caption)
            .foregroundStyle(markupWarning)
            .fixedSize(horizontal: false, vertical: true)
            .transition(.opacity)
            .onAppear { UIAccessibility.post(notification: .announcement, argument: text) }
    }
}

/// Waits briefly for the web to confirm an optimistic choice. Cancellation
/// (a newer choice) returns false, so it never clears that newer choice.
func markupConfirmationExpired() async -> Bool {
    do { try await Task.sleep(for: .seconds(1.5)) } catch { return false }
    return true
}

/// A slider's filled track in the markup pane, when the person has not chosen
/// a control colour: neutral, so it is not read as the mark's colour.
let markupTrack = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.72) : UIColor(white: 0.22, alpha: 0.8) })

/// Warning text needs contrast on the light cards as well as the dark ones.
let markupWarning = Color(uiColor: UIColor { traits in
    traits.userInterfaceStyle == .dark ? UIColor(red: 1, green: 0.69, blue: 0.38, alpha: 1)
                                      : UIColor(red: 0.60, green: 0.25, blue: 0, alpha: 1)
})
