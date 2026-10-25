import SwiftUI

/// The bottom sheet: search and coordinate shortcuts above every
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
                if let message = shell.status.message, message.kind == "general", !message.text.isEmpty {
                    Section {
                        Label {
                            Text(message.text).portalFont(.footnote)
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
            VStack(spacing: 10) {
                SearchBar(focused: $searchFocused)
                if shell.query.isEmpty, shell.search.canCopy { CoordinateActions() }
            }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 12)
        }
        .navigationTitle("Explore")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { CloseSheetButton() }
        }
        .onChange(of: searchFocused) {
            if searchFocused, shell.detent != .expanded { shell.detent = .expanded }
        }
        .onAppear {
            if shell.searchRequested { searchFocused = true; shell.searchRequested = false }
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
                    .portalFont(.footnote, weight: .medium)
                    .foregroundStyle(.secondary)
                TextField("Search places or layers", text: $shell.query,
                          prompt: Text(shell.search.label.isEmpty ? "Search places, layers…" : shell.search.label)
                            .foregroundStyle(.secondary))
                    .focused(focused)
                    .submitLabel(.search)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit { shell.submit(); focused.wrappedValue = false }
                if !shell.query.isEmpty || shell.search.canClear {
                    Button { shell.clearLocation() } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear the search and selected location")
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(.fill.tertiary, in: .capsule)
            if focused.wrappedValue {
                Button {
                    focused.wrappedValue = false
                } label: { Image(systemName: "keyboard.chevron.compact.down").frame(width: 28, height: 28) }
                .buttonStyle(.glass)
                .accessibilityLabel("Dismiss keyboard")
                .transition(.scale.combined(with: .opacity))
            } else {
                Button { shell.locate() } label: {
                    Image(systemName: "location")
                        .portalFont(.footnote, weight: .semibold)
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
                    .portalFont(.footnote, digits: true)
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

/// The web's three compact shortcuts, immediately under the search field.
/// Selected-location text belongs in the field, rather than a separate card.
struct CoordinateActions: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.openURL) private var openURL

    var body: some View {
        let search = shell.search
        HStack(spacing: 8) {
            Button { shell.copyCoordinates() } label: { action("Copy coordinates", "doc.on.doc") }
                .disabled(!search.canCopy)
            Button { if let url = URL(string: search.mapsURL) { openURL(url) } } label: {
                action("Open coordinates in Google Maps", "map")
            }
            .disabled(search.mapsURL.isEmpty)
            Button { if let url = URL(string: search.earthURL) { openURL(url) } } label: {
                action("Open coordinates in Google Earth", "globe")
            }
            .disabled(search.earthURL.isEmpty)
        }
        .buttonStyle(.plain)
    }

    private func action(_ title: String, _ symbol: String) -> some View {
        Image(systemName: symbol)
            .portalFont(.callout, weight: .medium)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(.fill.tertiary, in: .capsule)
            .contentShape(.capsule)
            .accessibilityLabel(title)
    }
}

/// One visible way back to the map at every sheet height and navigation depth.
/// Interactive swipe-to-dismiss remains available without a crowded grabber.
struct CloseSheetButton: View {
    @Environment(ShellModel.self) private var shell
    var body: some View {
        Button { shell.activeSheet = nil } label: {
            Image(systemName: "chevron.down").fontWeight(.semibold)
                .frame(minWidth: 28, minHeight: 28)
        }
        .accessibilityLabel("Close menu")
        .accessibilityHint("Return to the map")
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
                                Text(shell.title(for: match.route)).foregroundStyle(PortalPrimary())
                                Text(match.keyword.capitalized).portalFont(.caption).foregroundStyle(.secondary)
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
                Text(note).portalFont(.footnote).foregroundStyle(.secondary)
            }
            Button {
                focus.wrappedValue = false
                shell.submit()
            } label: {
                Label { Text("Search “\(text)”").foregroundStyle(PortalPrimary()) } icon: {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                }
            }
            Button {
                focus.wrappedValue = false
                shell.searchMapCenter()
            } label: {
                Label { Text("Search at the map centre").foregroundStyle(PortalPrimary()) } icon: {
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
                Text(shell.title(for: route)).portalFont(.subheadline, weight: .semibold)
            }
            ToolbarItem(placement: .topBarTrailing) { CloseSheetButton() }
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
                        Text(panel?.title ?? "").portalFont(.subheadline, weight: .semibold)
                        if let state = panel?.state, !state.isEmpty {
                            Text(state)
                                .portalFont(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    CloseSheetButton()
                }
            }
        }
        .sheetStyle()
    }
}
