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
                                .foregroundStyle(message.error == true ? AnyShapeStyle(.orange) : AnyShapeStyle(MenuSecondary()))
                        }
                        .listRowBackground(SheetRowBackground())
                    }
                }
                ForEach(Array(shell.groups.enumerated()), id: \.offset) { _, group in
                    Section {
                        ForEach(group.routes) { route in
                            NavigationLink(value: route.key) {
                                RouteRow(route: route, count: shell.counts[route.key])
                            }
                            .listRowBackground(SheetRowBackground())
                            .listRowInsets(MenuMetrics.rowInsets)
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
        .contentMargins(.horizontal, MenuMetrics.pageInset, for: .scrollContent)
        .listSectionSpacing(MenuMetrics.sectionSpacing)
        .scrollContentBackground(.hidden)
        .contentMargins(.bottom, 8, for: .scrollContent)
        .onSheetGlass()
        .modifier(SheetScrollTracking())
        .scrollDismissesKeyboard(.immediately)
        .scrollEdgeEffectHidden(for: .top)
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                Wordmark()
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .padding(.horizontal, 16)

                VStack(spacing: 10) {
                    SearchBar(focused: $searchFocused)
                    if shell.query.isEmpty, shell.search.canCopy { CoordinateActions() }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
            // Title, search and coordinate actions share one material surface.
            // A separate navigation-bar material creates a visible seam on
            // device, even when it uses the same material as the search area.
            .background {
                GeometryReader { geometry in
                    // Extend only the material, keeping the list in place.
                    // Center the fade in the gap before the first section.
                    Rectangle().fill(.ultraThinMaterial)
                        .frame(height: geometry.size.height + 8)
                        .mask {
                            VStack(spacing: 0) {
                                Color.black
                                LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                                    .frame(height: 12)
                            }
                        }
                        .preference(key: SheetHeaderHeightKey.self, value: geometry.size.height + 8)
                }
                .allowsHitTesting(false)
            }
            .zIndex(1)
        }
        .navigationTitle("ClearSkies")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarVisibility(.hidden, for: .navigationBar)
        .onChange(of: searchFocused) {
            if searchFocused, shell.detent != .expanded { shell.detent = .expanded }
        }
        .onAppear {
            if shell.searchRequested { searchFocused = true; shell.searchRequested = false }
        }
        .onChange(of: shell.query) { shell.queryChanged() }
    }
}

/// The app's name atop the menu, in the rounded script of Riley's app icons.
/// Pacifico ships in the bundle; it scales with Dynamic Type from 22 points.
struct Wordmark: View {
    var body: some View {
        Text("ClearSkies")
            .font(.custom("Pacifico-Regular", size: 22, relativeTo: .title3))
            .foregroundStyle(PortalPrimary())
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .accessibilityLabel("Clear Skies")
            .accessibilityAddTraits(.isHeader)
    }
}

struct SearchBar: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.portalAppearance) private var appearance
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @FocusState.Binding var focused: Bool

    var body: some View {
        @Bindable var shell = shell
        // A selected map location is displayed in the field even when query
        // is empty, and keeps Go available after the keyboard is dismissed.
        let showsGo = focused || shell.canLoadImagery
        GlassEffectContainer(spacing: 8) {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .portalFont(.footnote, weight: .medium)
                    .foregroundStyle(MenuSecondary())
                TextField("Search places or layers", text: $shell.query,
                          prompt: Text(shell.search.label.isEmpty ? "Search places, layers…" : shell.search.label)
                            .foregroundStyle(MenuSecondary()))
                    .accessibilityLabel("Search places or layers")
                    .focused($focused)
                    .tint(Color(hex: appearance.fontColor) ?? .primary)
                    .submitLabel(.search)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit { shell.submit(); focused = false }
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
            .menuGlass(in: .capsule)
            Button {
                if showsGo {
                    focused = false
                    shell.loadImagery()
                } else {
                    shell.locate()
                }
            } label: {
                Image(systemName: showsGo ? "arrow.right" : "location")
                    .contentTransition(reducedMotion ? .identity : .symbolEffect(.replace))
                    .portalFont(.footnote, weight: showsGo ? .bold : .semibold)
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .menuGlass(in: .circle)
            .disabled(showsGo && !shell.canLoadImagery)
            .opacity(showsGo && !shell.canLoadImagery ? 0.4 : 1)
            .accessibilityLabel(showsGo ? "Search for satellite imagery" : "Use my current location")
            .accessibilityHint(showsGo
                ? "Loads satellite imagery for the place in the search field, or for the place selected on the map"
                : "Move the map to your current location")
            Button {
                if focused {
                    focused = false
                } else {
                    shell.activeSheet = nil
                }
            } label: {
                Image(systemName: focused ? "keyboard.chevron.compact.down" : "chevron.down")
                    .contentTransition(reducedMotion ? .identity : .symbolEffect(.replace))
                    .portalFont(.footnote, weight: .semibold)
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .menuGlass(in: .circle)
            .accessibilityLabel(focused ? "Dismiss keyboard" : "Close menu")
            .accessibilityHint(focused ? "Hide the keyboard and keep your search text" : "Return to the map")
        }
        }
        .animation(reducedMotion ? nil : .snappy, value: focused)
        .animation(reducedMotion ? nil : .snappy, value: showsGo)
    }
}

struct RouteRow: View {
    let route: RouteInfo
    let count: String?

    var body: some View {
        HStack(spacing: 12) {
            RouteGlyph(key: route.key)
            VStack(alignment: .leading, spacing: MenuMetrics.labelSpacing) {
                Text(route.title).fontWeight(.medium)
                Text(route.description)
                    .portalFont(.caption)
                    .foregroundStyle(MenuSecondary())
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if let count, !count.isEmpty {
                Text(count)
                    .portalFont(.footnote, digits: true)
                    .foregroundStyle(MenuSecondary())
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
            .foregroundStyle(MenuSecondary())
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
        GlassEffectContainer(spacing: 8) {
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
    }

    private func action(_ title: String, _ symbol: String) -> some View {
        Image(systemName: symbol)
            .portalFont(.callout, weight: .medium)
            .frame(maxWidth: .infinity, minHeight: 44)
            .menuGlass(in: .capsule)
            .contentShape(.capsule)
            .accessibilityLabel(title)
    }
}

/// One visible way back to the map at every sheet height and navigation depth.
/// Interactive swipe-to-dismiss remains available without a crowded grabber.
struct CloseSheetButton: View {
    @Environment(ShellModel.self) private var shell
    var label = "Close menu"
    var hint = "Return to the map"

    var body: some View {
        Button { shell.activeSheet = nil } label: {
            Image(systemName: "chevron.down").fontWeight(.semibold)
                // The navigation bar adds its standard padding and 44-point target.
                .frame(width: 28, height: 28)
        }
        .accessibilityLabel(label)
        .accessibilityHint(hint)
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
                                Text(match.keyword.capitalized).portalFont(.caption).foregroundStyle(MenuSecondary())
                            }
                        }
                    }
                    .listRowBackground(SheetRowBackground())
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
                    Text("Searching places…").foregroundStyle(MenuSecondary())
                }
            }
            if let note = shell.suggestionNote {
                Text(note).portalFont(.footnote).foregroundStyle(MenuSecondary())
            }
            Button {
                focus.wrappedValue = false
                shell.submit()
            } label: {
                Label { Text("Search “\(text)”").foregroundStyle(PortalPrimary()) } icon: {
                    Image(systemName: "magnifyingglass").foregroundStyle(MenuSecondary())
                }
            }
            Button {
                focus.wrappedValue = false
                shell.searchMapCenter()
            } label: {
                Label { Text("Search at the map centre").foregroundStyle(PortalPrimary()) } icon: {
                    Image(systemName: "scope").foregroundStyle(MenuSecondary())
                }
            }
        } header: {
            SectionTitle(text: "Places")
        }
        .listRowBackground(SheetRowBackground())
    }
}

struct RoutePageView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.colorScheme) private var scheme
    let route: String

    var body: some View {
        Group {
            if let page = shell.page, page.route == route {
                if route == "export" {
                    ToolbarPanelContent(panel: ShellPanel(id: "export", title: page.title, state: nil, items: page.items))
                } else {
                    ItemList(items: page.items, description: page.description, route: route)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    .onSheetGlass()
            }
        }
        .navigationTitle(shell.title(for: route))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarVisibility(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(shell.title(for: route)).portalFont(.subheadline, weight: .semibold)
                    .foregroundStyle(Color(hex: shell.appearance.fontColor) ?? (scheme == .dark ? .white : .black))
            }
            ToolbarItem(placement: .topBarTrailing) { CloseSheetButton() }
        }
    }
}

/// A map tool's native panel. The web controls remain its source of truth;
/// toolbar panels get their own layout rather than desktop-shaped form rows.
struct PanelSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.colorScheme) private var scheme
    let id: String

    var body: some View {
        let panel = shell.panel?.id == id ? shell.panel : nil
        NavigationStack {
            Group {
                if let panel, panel.id == "mkBar" {
                    MarkupPanelContent(panel: panel)
                } else if let panel {
                    ToolbarPanelContent(panel: panel)
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
                            .foregroundStyle(Color(hex: shell.appearance.fontColor) ?? (scheme == .dark ? .white : .black))
                        if let state = panel?.state, !state.isEmpty {
                            Text(state)
                                .portalFont(.caption2)
                                .foregroundStyle((scheme == .dark ? Color.white : Color.black).opacity(0.75))
                                .lineLimit(1)
                        }
                    }
                }
                // Markup separates the two ways out: Done ends drawing, while
                // hiding the tools leaves the pen active on the map.
                if id == "mkBar", let done = panel?.items.first(where: { $0.kind == "markupFinish" && $0.id == "done" }) {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Done") { shell.act(done.ref) }
                            .fontWeight(.semibold)
                            .accessibilityHint("Stop drawing on this layer")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if id == "mkBar" {
                        // Hiding is not stopping: say so on the button itself.
                        Button { shell.activeSheet = nil } label: {
                            HStack(spacing: 4) {
                                Text("Hide").fontWeight(.medium)
                                Image(systemName: "chevron.down").fontWeight(.semibold)
                            }
                            .padding(.horizontal, 4)
                        }
                        .accessibilityLabel("Hide markup tools")
                        .accessibilityHint("Keep drawing on the map. The bar at the bottom of the map shows the tools again.")
                    } else {
                        CloseSheetButton()
                    }
                }
            }
        }
        .sheetStyle()
    }
}
