import SwiftUI

/// A described web page or pop-up as a native inset-grouped list. The web's
/// sections (<details>) are kept open behind the app and drawn as the list's
/// own sections, grouped by task where the page has a layout (PageLayout).
/// Panes and LiDAR layers stay rows that open and close the web's element.
struct ItemList: View {
    let items: [ShellItem]
    var description: String?
    var route: String?

    var body: some View {
        let sections = PageLayout.sections(items, route: route)
        ScrollViewReader { proxy in
        List {
            if let description, !description.isEmpty {
                // A plain row rather than a header: header vibrancy on the
                // glass sheet washes the text out.
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 2, leading: 4, bottom: 2, trailing: 4))
                    .listSectionSeparator(.hidden)
            }
            ForEach(sections) { section in
                Section {
                    ItemRows(items: section.items, prefix: section.id)
                } header: {
                    if let title = section.title { SectionTitle(text: title, detail: section.detail) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .scrollContentBackground(.hidden)
        .onSheetGlass()
        .scrollDismissesKeyboard(.interactively)
        #if DEBUG
        .task {
            // ShellModel.openDebugPage: scroll to `-cspDebugSection <title>`.
            guard let title = UserDefaults.standard.string(forKey: "cspDebugSection"),
                  let target = sections.first(where: { $0.title?.localizedCaseInsensitiveContains(title) == true }) else { return }
            try? await Task.sleep(for: .milliseconds(400))
            proxy.scrollTo(target.id, anchor: .top)
        }
        #endif
        }
    }
}

struct PageSection: Identifiable {
    var id: String
    var title: String?
    var detail: String?
    var items: [ShellItem] = []
}

/// How the app groups a page. Every web section becomes a section of the
/// list instead of a row that opens. A layout gathers related web sections
/// into one, named by element id or title, and orders them by task; the
/// first keeps its own title unless the part names one, and the rest follow
/// under subheadings. A web section no layout names keeps a section of its
/// own, in the web's order, so nothing a page shows is ever left out.
enum PageLayout {
    struct Part {
        var title: String?
        let names: [String]
    }

    static func parts(for route: String?) -> [Part] {
        switch route {
        case "terrain": [
            Part(names: ["#terLidar"]),
            Part(names: ["Looks"]),
            Part(names: ["#terAppearance", "Terrain effects"]),
            Part(names: ["#terLighting"]),
            Part(names: ["Data source & overall opacity", "#terrainSourceDetails"]),
            Part(title: "Downloads", names: ["WA DNR downloads", "#terrainDownloadBox"])
        ]
        case "elevation": [
            Part(names: ["Reference & color range", "Spectrum opacity"]),
            Part(names: ["#elevPaletteBox"]),
            Part(names: ["#elevBandsBox"])
        ]
        default: []
        }
    }

    /// One web section's rows, before they are placed.
    struct Block {
        var id: String
        var names: [String] = []
        var title: String?
        var detail: String?
        var items: [ShellItem] = []
    }

    static func sections(_ items: [ShellItem], route: String?) -> [PageSection] {
        let parts = parts(for: route)
        let named = Set(parts.flatMap(\.names))

        // Headers and panes split loose rows; web sections become blocks.
        var blocks: [Block] = []
        var loose = Block(id: "s0")
        func flush() {
            if !loose.items.isEmpty { blocks.append(loose) }
            loose = Block(id: "s\(blocks.count + 1)")
        }
        for item in items {
            switch item.kind {
            case "header":
                flush()
                loose = Block(id: "h:\(item.text)", title: item.text, detail: item.detail)
            case "group" where item.pane != true:
                flush()
                blocks += self.blocks(of: item, named: named)
            case "group":
                // A pane is a card of its own, under its header if it has one.
                if !(loose.items.isEmpty && loose.title != nil) { flush() }
                loose.items.append(item)
                flush()
            default:
                loose.items.append(item)
            }
        }
        flush()

        // Parts take the place of the first block they gather.
        var result: [PageSection] = []
        var placedParts = false
        for block in blocks {
            if parts.contains(where: { part in part.names.contains(where: block.names.contains) }) {
                guard !placedParts else { continue }
                placedParts = true
                result += parts.compactMap { section(for: $0, from: blocks) }
            } else if !block.items.isEmpty {
                result.append(PageSection(id: block.id, title: block.title, detail: block.detail, items: block.items))
            }
        }
        var used = Set<String>()
        return result.map { section in
            var section = section
            while used.contains(section.id) { section.id += "'" }
            used.insert(section.id)
            return section
        }
    }

    /// A web section as a block, then any section inside it that a layout
    /// names as blocks of their own. Other inner sections stay in place and
    /// draw under subheadings (InlineGroup).
    static func blocks(of group: ShellItem, named: Set<String>) -> [Block] {
        var block = Block(id: "g:\(group.title ?? group.ref ?? "")", names: [group.ref, group.title].compactMap { $0 },
                          title: group.title, detail: group.detail)
        var children = group.items ?? []
        // A heading that opens a section repeats its title; keep what it adds.
        if let first = children.first, first.kind == "header" {
            if let detail = first.detail, !detail.isEmpty { block.detail = detail }
            children.removeFirst()
        }
        var inner: [Block] = [], closing: [ShellItem] = []
        for child in children {
            if child.kind == "group", child.pane != true, named.contains(child.ref ?? "") || named.contains(child.text) {
                inner += blocks(of: child, named: named)
            } else if child.kind == "button", child.role == "link" {
                closing.append(child) // Resets and saves end their section.
            } else {
                block.items.append(child)
            }
        }
        block.items += closing
        return [block] + inner
    }

    static func section(for part: Part, from blocks: [Block]) -> PageSection? {
        let members = part.names.compactMap { name in blocks.first { $0.names.contains(name) } }.filter { !$0.items.isEmpty }
        guard let first = members.first else { return nil }
        var items: [ShellItem] = []
        for (index, member) in members.enumerated() {
            let redundant = member.items.count == 1 && member.items[0].title == member.title
            if (index > 0 || part.title != nil) && !redundant {
                items.append(ShellItem(kind: "subheader", title: member.title, detail: member.detail))
            }
            items += member.items
        }
        return PageSection(id: "part:\(part.title ?? first.id)", title: part.title ?? first.title,
                           detail: part.title == nil ? first.detail : nil, items: items)
    }
}

/// Rows with identities that survive page updates: a control's ref when it
/// has one, otherwise its kind and title.
struct ItemRows: View {
    let items: [ShellItem]
    let prefix: String

    var body: some View {
        ForEach(Self.keyed(items, prefix: prefix), id: \.0) { key, item in
            ItemView(item: item, key: key)
        }
    }

    static func keyed(_ items: [ShellItem], prefix: String) -> [(String, ShellItem)] {
        var seen = Set<String>()
        return items.enumerated().map { index, item in
            var key = item.ref.map { "\(item.kind):\($0)" } ?? "\(prefix)/\(item.kind)/\(item.title ?? "")"
            if seen.contains(key) { key += "#\(index)" }
            seen.insert(key)
            return (key, item)
        }
    }
}

struct ItemView: View {
    let item: ShellItem
    let key: String

    var body: some View {
        switch item.kind {
        case "toggle": ToggleRow(item: item)
        case "slider": SliderRow(item: item)
        case "picker": PickerRow(item: item)
        case "segmented": SegmentedRow(item: item)
        case "choices": ChoicesRow(item: item)
        case "swatches": SwatchesRow(item: item)
        case "color": ColorRow(ref: item.ref, title: item.text, value: item.value?.string)
        case "field": FieldRow(item: item)
        case "button": ButtonRow(item: item)
        case "link": LinkRow(item: item)
        case "layer": LayerCard(item: item)
        case "scene": SceneRow(item: item)
        case "scenesearch": SceneSearchRow(item: item)
        case "looks": LooksRow(item: item)
        case "palettes": PalettesRow(item: item)
        case "ramp": RampEditor(item: item)
        case "sun": SunDial(item: item)
        case "progress": ProgressRow(item: item)
        case "image":
            if let src = item.src {
                ShellImage(src: src, contentMode: .fit)
                    .frame(maxWidth: .infinity)
                    .aspectRatio(item.aspect ?? 3, contentMode: .fit)
                    .clipShape(.rect(cornerRadius: 8))
            }
        case "header":
            SectionTitle(text: item.text, detail: item.detail)
                .padding(.top, 4)
        case "subheader":
            SubheaderRow(title: item.text, detail: item.detail)
        case "gradient":
            GradientRow(item: item)
        case "group" where item.pane != true:
            InlineGroup(item: item, key: key)
        case "group", "lidarLayer":
            GroupRow(item: item, key: key)
        default:
            TextRow(item: item)
        }
    }
}

/// A web section inside another: its rows under a subheading, always shown.
struct InlineGroup: View {
    let item: ShellItem
    let key: String

    var body: some View {
        if !item.text.isEmpty { SubheaderRow(title: item.text, detail: item.detail) }
        AnyView(ItemRows(items: item.items ?? [], prefix: key))
    }
}

/// A smaller heading inside a section, for a web section gathered under
/// another one.
struct SubheaderRow: View {
    let title: String
    var detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(title).fontWeight(.semibold)
            if let detail, !detail.isEmpty {
                Text(detail).foregroundStyle(.tertiary)
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.top, 4)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A color scale the web draws (the elevation spectrum), with its labels.
struct GradientRow: View {
    let item: ShellItem

    var body: some View {
        VStack(spacing: 4) {
            Capsule()
                .fill(LinearGradient(gradient: Gradient(stops: item.stops ?? []), startPoint: .leading, endPoint: .trailing))
                .overlay(Capsule().strokeBorder(.primary.opacity(0.12), lineWidth: 0.5))
                .frame(height: 10)
            if let labels = item.labels, labels.count > 1 {
                HStack(spacing: 0) {
                    ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                        Text(label).frame(maxWidth: .infinity,
                                          alignment: index == 0 ? .leading : index == labels.count - 1 ? .trailing : .center)
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// A web pane or LiDAR layer: its label always, its rows when open. Opening
/// shows at once; the web's own element follows.
struct GroupRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    let key: String
    @State private var pending: Bool?

    var body: some View {
        let open = pending ?? item.open ?? false
        DisclosureGroup(isExpanded: Binding(get: { open }, set: { value in
            withAnimation(.snappy) { pending = value }
            shell.act(item.ref, item.kind == "lidarLayer" ? .click : .open, value)
        })) {
            if open {
                if let items = item.items, !items.isEmpty {
                    AnyView(ItemRows(items: items, prefix: key))
                } else if pending == true {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
        } label: {
            if item.kind == "lidarLayer" {
                LidarLayerLabel(item: item)
            } else {
                HStack(spacing: 10) {
                    if let stops = item.stops { GradientBar(stops: stops).frame(width: 30, height: 12) }
                    Text(item.text).fontWeight(.medium)
                    Spacer(minLength: 8)
                    if let detail = item.detail, !detail.isEmpty {
                        Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
        }
        .onChange(of: item.open) { pending = nil }
    }
}

/// The Satellite page's scene search. It searches through the same bridge
/// calls as the web field: places as suggestions, text, or the map centre.
struct SceneSearchRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    @State private var text = ""
    @State private var places: [PlaceSuggestion] = []
    @State private var task: Task<Void, Never>?
    @State private var note: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.footnote.weight(.medium)).foregroundStyle(.secondary)
                TextField(item.placeholder ?? "Place or coordinates", text: $text)
                    .focused($focused)
                    .submitLabel(.search)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit { submit() }
                    .onChange(of: text) { suggest() }
                Button { shell.searchMapCenter(); text = "" } label: {
                    Image(systemName: "scope").foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Search scenes at the map centre")
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(.fill.tertiary, in: .capsule)
            if let note { Text(note).font(.footnote).foregroundStyle(.secondary) }
            ForEach(places) { place in
                Button {
                    shell.pick(place)
                    text = ""
                    places = []
                    focused = false
                } label: {
                    PlaceRowLabel(place: place)
                }
                .buttonStyle(.plain)
            }
        }
        .onAppear { if text.isEmpty { text = item.value?.string ?? "" } }
    }

    private func suggest() {
        task?.cancel()
        note = nil
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard focused, query.count >= 3 else { places = []; return }
        task = Task {
            try? await Task.sleep(for: .milliseconds(260))
            guard !Task.isCancelled else { return }
            do {
                let found = try await shell.fetchPlaces(query)
                guard !Task.isCancelled else { return }
                places = found
                note = found.isEmpty ? "No matching suggestions. Search to use this text." : nil
            } catch {
                guard !Task.isCancelled else { return }
                places = []
                note = "Place search is unavailable. You can still paste coordinates."
            }
        }
    }

    private func submit() {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        task?.cancel()
        places = []
        shell.searchText(query)
    }
}

struct PlaceRowLabel: View {
    let place: PlaceSuggestion

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "mappin.and.ellipse")
                .foregroundStyle(.secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(place.primary).foregroundStyle(.primary)
                if !place.secondary.isEmpty {
                    Text(place.secondary).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if !place.kind.isEmpty {
                Text(place.kind.capitalized).font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .contentShape(.rect)
    }
}

/// A quiet section title: small, secondary, and set in capitals so it reads
/// as a label rather than content.
struct SectionTitle: View {
    let text: String
    var detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text).textCase(.uppercase).tracking(0.3)
            Spacer(minLength: 8)
            if let detail, !detail.isEmpty { Text(detail).monospacedDigit().textCase(nil) }
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
    }
}

/// The sheet's compact type: rows at subheadline, details a step or two
/// below, as text styles so Dynamic Type still scales them.
struct SheetStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.subheadline)
            .environment(\.defaultMinListRowHeight, 40)
    }
}

extension View {
    /// A page in the sheet's navigation stack: transparent, so the sheet's
    /// glass shows through at every height.
    func onSheetGlass() -> some View {
        containerBackground(.clear, for: .navigation)
    }
}

extension View {
    func sheetStyle() -> some View { modifier(SheetStyle()) }
}
