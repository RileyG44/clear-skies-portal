import SwiftUI

/// The bottom sheet: search at the top, then the selected place and every
/// tool page, as the web panel lists them. Pages push in a navigation stack.
struct ToolsSheet: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        @Bindable var shell = shell
        NavigationStack(path: $shell.path) {
            HomeView()
                .navigationDestination(for: String.self) { route in
                    RoutePageView(route: route)
                }
        }
        .sheetStyle()
        .onChange(of: shell.path) { shell.pathChanged() }
    }
}

struct HomeView: View {
    @Environment(ShellModel.self) private var shell
    @FocusState private var searchFocused: Bool

    var body: some View {
        @Bindable var shell = shell
        List {
            if shell.query.trimmingCharacters(in: .whitespaces).isEmpty {
                if !shell.search.label.isEmpty { LocationSection() }
                if let message = shell.status.message, message.kind == "general", !message.text.isEmpty {
                    Section {
                        Label {
                            Text(message.text).font(.footnote)
                        } icon: {
                            Image(systemName: message.error == true ? "exclamationmark.triangle" : "info.circle")
                                .foregroundStyle(message.error == true ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                        }
                    }
                }
                ForEach(Array(shell.groups.enumerated()), id: \.offset) { _, group in
                    Section {
                        ForEach(group.routes) { route in
                            NavigationLink(value: route.key) {
                                RouteRow(route: route, count: shell.counts[route.key])
                            }
                        }
                    } header: {
                        if !group.label.isEmpty { SectionTitle(text: group.label) }
                    }
                }
            } else {
                SuggestionSections(focus: $searchFocused)
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .scrollContentBackground(.hidden)
        .onSheetGlass()
        .scrollDismissesKeyboard(.immediately)
        .safeAreaInset(edge: .top, spacing: 0) {
            SearchBar(focused: $searchFocused)
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 6)
        }
        .toolbar(.hidden, for: .navigationBar)
        .onChange(of: searchFocused) {
            if searchFocused, shell.detent != .expanded { shell.detent = .expanded }
        }
        .onChange(of: shell.query) { shell.queryChanged() }
    }
}

struct SearchBar: View {
    @Environment(ShellModel.self) private var shell
    var focused: FocusState<Bool>.Binding

    var body: some View {
        @Bindable var shell = shell
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
                TextField("Search places, layers…", text: $shell.query)
                    .focused(focused)
                    .submitLabel(.search)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit { shell.submit() }
                if !shell.query.isEmpty {
                    Button { shell.query = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search text")
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(.fill.tertiary, in: .capsule)
            if focused.wrappedValue {
                Button(role: .close) {
                    shell.query = ""
                    focused.wrappedValue = false
                }
                .buttonStyle(.glass)
                .transition(.scale.combined(with: .opacity))
            } else {
                Button { shell.locate() } label: {
                    Image(systemName: "location")
                        .font(.footnote.weight(.semibold))
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.glass)
                .tint(.primary)
                .accessibilityLabel("Use my current location")
            }
        }
        .animation(.snappy, value: focused.wrappedValue)
    }
}

struct RouteRow: View {
    let route: RouteInfo
    let count: String?

    var body: some View {
        HStack(spacing: 12) {
            RouteGlyph(key: route.key)
            Text(route.title)
            Spacer(minLength: 8)
            if let count, !count.isEmpty {
                Text(count)
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText())
            }
        }
    }
}

/// A page's symbol, in the row's own quiet color.
struct RouteGlyph: View {
    let key: String

    var body: some View {
        // Fitted to one box: symbols differ in width (mountain.2 is wide),
        // and the titles beside them should start in one column.
        Image(systemName: Symbols.route(key))
            .resizable()
            .scaledToFit()
            .frame(width: 18, height: 16)
            .frame(width: 22)
            .foregroundStyle(.secondary)
            .accessibilityHidden(true)
    }
}

/// The selected place: its label and coordinates, copy, and the same links
/// out that the web offers.
struct LocationSection: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.openURL) private var openURL

    var body: some View {
        let search = shell.search
        Section {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Image(systemName: "mappin.and.ellipse").foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(search.label).fontWeight(.semibold).lineLimit(2)
                        if let lat = search.lat, let lng = search.lng {
                            Text(Self.coordinates(lat: lat, lng: lng))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                    Spacer(minLength: 0)
                    if search.canClear {
                        Button { shell.clearLocation() } label: {
                            Image(systemName: "xmark.circle.fill")
                                .symbolRenderingMode(.hierarchical)
                                .font(.body)
                        }
                        .buttonStyle(.borderless)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Clear the selected location")
                    }
                }
                HStack(spacing: 6) {
                    if search.canCopy {
                        Button { shell.copyCoordinates() } label: { Label("Copy", systemImage: "doc.on.doc") }
                    }
                    if let url = URL(string: search.mapsURL), !search.mapsURL.isEmpty {
                        Button { openURL(url) } label: { Label("Maps", systemImage: "map") }
                    }
                    if let url = URL(string: search.earthURL), !search.earthURL.isEmpty {
                        Button { openURL(url) } label: { Label("Earth", systemImage: "globe") }
                    }
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .tint(.primary)
                .font(.footnote)
                .lineLimit(1)
                .fixedSize()
            }
            .padding(.vertical, 2)
        }
    }

    /// Five decimals, about a metre: the precision the web shows and copies.
    static func coordinates(lat: Double, lng: Double) -> String {
        let latText = String(format: "%.5f° %@", abs(lat), lat < 0 ? "S" : "N")
        let lngText = String(format: "%.5f° %@", abs(lng), lng < 0 ? "W" : "E")
        return "\(latText) · \(lngText)"
    }
}

/// While typing: matching pages, places from the web's geocoder, and the two
/// ways the web field searches text.
struct SuggestionSections: View {
    @Environment(ShellModel.self) private var shell
    var focus: FocusState<Bool>.Binding

    var body: some View {
        let text = shell.query.trimmingCharacters(in: .whitespaces)
        if !shell.routeMatches.isEmpty {
            Section {
                ForEach(shell.routeMatches) { match in
                    Button {
                        shell.query = ""
                        shell.clearSuggestions()
                        focus.wrappedValue = false
                        shell.show(route: match.route)
                    } label: {
                        HStack(spacing: 12) {
                            RouteGlyph(key: match.route)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(shell.title(for: match.route)).foregroundStyle(.primary)
                                Text(match.keyword.capitalized).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } header: {
                SectionTitle(text: "Tools")
            }
        }
        Section {
            ForEach(shell.suggestions) { place in
                Button {
                    focus.wrappedValue = false
                    shell.pick(place)
                } label: { PlaceRowLabel(place: place) }
            }
            if shell.searching && shell.suggestions.isEmpty {
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small)
                    Text("Searching places…").foregroundStyle(.secondary)
                }
            }
            if let note = shell.suggestionNote {
                Text(note).font(.footnote).foregroundStyle(.secondary)
            }
            Button {
                focus.wrappedValue = false
                shell.submit()
            } label: {
                Label { Text("Search “\(text)”").foregroundStyle(.primary) } icon: {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                }
            }
            Button {
                focus.wrappedValue = false
                shell.searchMapCenter()
            } label: {
                Label { Text("Search at the map centre").foregroundStyle(.primary) } icon: {
                    Image(systemName: "scope").foregroundStyle(.secondary)
                }
            }
        } header: {
            SectionTitle(text: "Places")
        }
    }
}

struct RoutePageView: View {
    @Environment(ShellModel.self) private var shell
    let route: String

    var body: some View {
        Group {
            if let page = shell.page, page.route == route {
                ItemList(items: page.items, description: page.description, route: route)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    .onSheetGlass()
            }
        }
        .navigationTitle(shell.title(for: route))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(shell.title(for: route)).font(.subheadline.weight(.semibold))
            }
        }
    }
}

/// A map tool's pop-up (Export, Layers, the engine, the displayed scene),
/// drawn from the web pop-up that stays its source of truth.
struct PanelSheet: View {
    @Environment(ShellModel.self) private var shell
    let id: String

    var body: some View {
        let panel = shell.panel?.id == id ? shell.panel : nil
        NavigationStack {
            Group {
                if let panel {
                    ItemList(items: panel.items)
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                        .onSheetGlass()
                }
            }
            .navigationTitle(panel?.title ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 2) {
                        Text(panel?.title ?? "").font(.subheadline.weight(.semibold))
                        if let state = panel?.state, !state.isEmpty {
                            Text(state)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .close) { shell.activeSheet = nil }
                }
            }
        }
        .sheetStyle()
    }
}
