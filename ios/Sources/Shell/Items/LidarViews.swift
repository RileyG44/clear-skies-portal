import SwiftUI

/// Native views for the LiDAR studio (lidar-studio.js). Each one drives the
/// studio's own controls; the colors, previews and gradients are the ones the
/// web computed.

/// The terrain mode chooser: hillshade, multi-directional, tint, relative
/// elevation, slope, aspect, exposure and contours.
struct ChoicesRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    @State private var pending: String?
    @State private var position = ScrollPosition(idType: String.self)

    var body: some View {
        let options = item.options ?? []
        let selected = pending ?? options.first(where: { $0.selected == true })?.id
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(options) { option in
                    let on = option.id == selected
                    Button {
                        pending = option.id
                        shell.act(option.ref)
                    } label: {
                        VStack(spacing: 5) {
                            Image(systemName: Symbols.terrainStyle(title: option.label, icon: option.icon))
                                .font(.system(size: 16))
                                .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                                .frame(height: 20)
                            Text(option.label.replacingOccurrences(of: "Contours — ", with: "Contours\n"))
                                .portalFont(.caption2, weight: on ? .semibold : .regular)
                                .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(PortalPrimary()))
                                .multilineTextAlignment(.center)
                                .lineLimit(2)
                                .minimumScaleFactor(0.85)
                                .frame(height: 26, alignment: .top)
                        }
                        .frame(width: 70, height: 62)
                        .background(on ? AnyShapeStyle(.tint.opacity(0.12)) : AnyShapeStyle(.fill.quaternary), in: .rect(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.clear), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(option.disabled ?? item.isDisabled)
                    .accessibilityLabel(option.label)
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .id(option.id)
                }
            }
            .padding(.vertical, 4)
            .scrollTargetLayout()
        }
        .scrollClipDisabled()
        // Only this row scrolls to the selected style; a ScrollViewReader
        // would also scroll the page beneath it.
        .scrollPosition($position, anchor: .center)
        .onAppear { if let selected { position.scrollTo(id: selected, anchor: .center) } }
        .sensoryFeedback(.selection, trigger: selected)
        .onChange(of: item.options) { pending = nil }
    }
}

/// Complete presets, each previewed with the web's own rendering of a sample
/// terrain. Saved presets can be deleted from their context menu.
struct LooksRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(item.options ?? []) { look in
                    let on = look.selected == true
                    Button { shell.act(look.ref) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Group {
                                if let src = look.src { ShellImage(src: src) } else { Color.secondary.opacity(0.15) }
                            }
                            .frame(width: 100, height: 64)
                            .clipShape(.rect(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary.opacity(0.08)), lineWidth: on ? 2 : 0.5))
                            Text(look.label)
                                .portalFont(.caption2, weight: on ? .semibold : .regular)
                                .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                                .lineLimit(1)
                                .frame(width: 100, alignment: .leading)
                        }
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        if let remove = look.remove {
                            Button(role: .destructive) { shell.act(remove) } label: { Label("Delete Preset", systemImage: "trash") }
                        }
                    }
                    .accessibilityLabel(look.label)
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .accessibilityActions {
                        if let remove = look.remove {
                            Button("Delete Preset") { shell.act(remove) }
                        }
                    }
                }
            }
            .padding(.vertical, 4)
        }
        .scrollClipDisabled()
    }
}

/// Palette chips for a terrain layer.
struct PalettesRow: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(item.options ?? []) { palette in
                    let on = palette.selected == true
                    Button { shell.act(palette.ref) } label: {
                        VStack(spacing: 4) {
                            GradientBar(stops: palette.stops)
                                .frame(width: 76, height: 16)
                                .overlay(Capsule().strokeBorder(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary.opacity(0.12)), lineWidth: on ? 2 : 0.5))
                            Text(palette.label)
                                .portalFont(.caption2, weight: on ? .semibold : .regular)
                                .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(palette.label)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(.vertical, 4)
        }
        .scrollClipDisabled()
    }
}

struct GradientBar: View {
    let stops: [GradientStop]?

    var body: some View {
        Capsule()
            .fill(LinearGradient(gradient: Gradient(stops: stops ?? []), startPoint: .leading, endPoint: .trailing))
            .background(Checkerboard().clipShape(.capsule))
    }
}

/// Under transparent palette stops, as the web draws it.
struct Checkerboard: View {
    var body: some View {
        Canvas { context, size in
            let cell: CGFloat = 5
            for row in 0..<Int(size.height / cell + 1) {
                for column in 0..<Int(size.width / cell + 1) where (row + column).isMultiple(of: 2) {
                    context.fill(Path(CGRect(x: CGFloat(column) * cell, y: CGFloat(row) * cell, width: cell, height: cell)), with: .color(.gray.opacity(0.35)))
                }
            }
        }
        .background(.white)
    }
}

/// One layer of the terrain stack: visibility, its palette, and its summary.
struct LidarLayerLabel: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem

    var body: some View {
        HStack(spacing: 10) {
            Button { shell.act(item.eye) } label: {
                Image(systemName: item.visible == false ? "eye.slash" : "eye")
                    .portalFont(.footnote)
                    .foregroundStyle(item.visible == false ? AnyShapeStyle(.tertiary) : AnyShapeStyle(.secondary))
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(item.visible == false ? "Show \(item.text)" : "Hide \(item.text)")
            GradientBar(stops: item.stops).frame(width: 30, height: 12)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.text).fontWeight(.medium)
                if let detail = item.detail { Text(detail).portalFont(.caption).foregroundStyle(.secondary) }
            }
            .opacity(item.visible == false ? 0.55 : 1)
        }
    }
}

/// The palette's color stops: tap the bar to add a color where it is tapped,
/// tap a stop to select it, drag it to move it.
struct RampEditor: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    @State private var dragging: String?
    @State private var dragAt: Double = 0
    @State private var lastMove = Date.distantPast

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            GeometryReader { geometry in
                let width = geometry.size.width
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(LinearGradient(gradient: Gradient(stops: displayStops), startPoint: .leading, endPoint: .trailing))
                        .background(Checkerboard().clipShape(.rect(cornerRadius: 6)))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.primary.opacity(0.12), lineWidth: 0.5))
                        .frame(height: 26)
                        .contentShape(.rect)
                        .onTapGesture { location in
                            shell.act(item.ref, .rampAdd, max(0, min(1, location.x / max(1, width))))
                        }
                    ForEach(item.handles ?? []) { handle in
                        let at = dragging == handle.ref ? dragAt : handle.at
                        Circle()
                            .fill(Color(hex: handle.color) ?? .black)
                            .overlay(Circle().strokeBorder(.white, lineWidth: handle.selected ? 2.5 : 1.5))
                            .shadow(color: .black.opacity(0.3), radius: 1.5, y: 0.5)
                            .frame(width: handle.selected ? 22 : 17, height: handle.selected ? 22 : 17)
                            .frame(width: 44, height: 44)
                            .contentShape(.rect)
                            .position(x: at * width, y: 22)
                            .gesture(
                                DragGesture(minimumDistance: 0)
                                    .onChanged { value in
                                        if dragging != handle.ref {
                                            dragging = handle.ref
                                            shell.act(handle.ref, .focus)
                                        }
                                        dragAt = max(0, min(1, value.location.x / max(1, width)))
                                        if Date().timeIntervalSince(lastMove) > 0.12 {
                                            lastMove = Date()
                                            shell.act(handle.ref, .rampMove, dragAt)
                                        }
                                    }
                                    .onEnded { _ in
                                        shell.act(handle.ref, .rampMove, dragAt)
                                        dragging = nil
                                    }
                            )
                            .accessibilityLabel("Color stop")
                            .accessibilityValue("\(Int((handle.at * 100).rounded())) percent")
                            .accessibilityAdjustableAction { direction in
                                let next = max(0, min(1, handle.at + (direction == .increment ? 0.01 : -0.01)))
                                shell.act(handle.ref, .focus)
                                shell.act(handle.ref, .rampMove, next)
                            }
                    }
                }
            }
            .frame(height: 44)
            HStack(spacing: 12) {
                if let well = item.well {
                    ColorPicker(selection: Binding(get: { Color(hex: well.value?.string) ?? .black }, set: { picked in
                        shell.act(well.ref, .input, picked.hexString)
                    }), supportsOpacity: false) { Text("Selected color") }
                    .fixedSize()
                }
                if let position = item.position {
                    Text(position).portalFont(.footnote, digits: true).foregroundStyle(.secondary)
                }
                Spacer()
                if let remove = item.remove {
                    Button(role: .destructive) { shell.act(remove.ref) } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless)
                        .disabled(remove.disabled ?? false)
                        .accessibilityLabel("Delete selected color")
                }
            }
            Text("Tap the bar to add a color. Drag a stop to move it.")
                .portalFont(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private var displayStops: [GradientStop] {
        guard let dragging, let handles = item.handles else { return item.stops ?? [] }
        return handles.map { handle in
            GradientStop(color: handle.color, opacity: 1, at: handle.ref == dragging ? dragAt : handle.at)
        }.sorted { $0.at < $1.at }
    }
}

/// Sun azimuth and altitude as one dial seen from above: north up, the
/// horizon at the rim and the zenith at the center. Both values go to the
/// web's own sliders, which relight 2D and 3D terrain.
struct SunDial: View {
    @Environment(ShellModel.self) private var shell
    let item: ShellItem
    @State private var local: (azimuth: Double, altitude: Double)?
    @State private var lastSent = Date.distantPast

    var body: some View {
        let azimuthSpec = item.azimuth, altitudeSpec = item.altitude
        let azimuth = local?.azimuth ?? azimuthSpec?.value?.number ?? 315
        let altitude = local?.altitude ?? altitudeSpec?.value?.number ?? 45
        let minAltitude = altitudeSpec?.min?.number ?? 5
        let maxAltitude = altitudeSpec?.max?.number ?? 90
        VStack(spacing: 10) {
            GeometryReader { geometry in
                let size = min(geometry.size.width, geometry.size.height)
                let radius = size / 2 - 16
                let center = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)
                let reach = (90 - altitude) / 90 * radius
                let angle = Angle.degrees(azimuth - 90).radians
                let sun = CGPoint(x: center.x + cos(angle) * reach, y: center.y + sin(angle) * reach)
                ZStack {
                    Circle()
                        .fill(.fill.quaternary)
                        .overlay(Circle().strokeBorder(.primary.opacity(0.15), lineWidth: 0.5))
                        .frame(width: radius * 2, height: radius * 2)
                    ForEach([30.0, 60.0], id: \.self) { ring in
                        Circle().strokeBorder(.primary.opacity(0.07), style: StrokeStyle(lineWidth: 1, dash: [3, 4]))
                            .frame(width: (90 - ring) / 90 * radius * 2, height: (90 - ring) / 90 * radius * 2)
                    }
                    ForEach(0..<24, id: \.self) { tick in
                        Capsule()
                            .fill(.primary.opacity(tick.isMultiple(of: 6) ? 0.45 : 0.18))
                            .frame(width: tick.isMultiple(of: 6) ? 2 : 1, height: tick.isMultiple(of: 6) ? 9 : 5)
                            .offset(y: -radius + 6)
                            .rotationEffect(.degrees(Double(tick) * 15))
                    }
                    ForEach(Array(["N", "E", "S", "W"].enumerated()), id: \.offset) { index, letter in
                        let theta = Angle.degrees(Double(index) * 90 - 90).radians
                        Text(letter)
                            .portalFont(.caption2, weight: letter == "N" ? .bold : .medium)
                            .foregroundStyle(letter == "N" ? AnyShapeStyle(PortalPrimary()) : AnyShapeStyle(.secondary))
                            .position(x: center.x + cos(theta) * (radius + 10), y: center.y + sin(theta) * (radius + 10))
                    }
                    Path { path in
                        path.move(to: sun)
                        path.addLine(to: center)
                    }
                    .stroke(.tint.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                    Circle().fill(.primary.opacity(0.25)).frame(width: 4, height: 4).position(center)
                    Image(systemName: "sun.max.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(.tint)
                        .padding(5)
                        .background(.background, in: .circle)
                        .shadow(color: .black.opacity(0.15), radius: 2, y: 1)
                        .position(sun)
                }
                .contentShape(.rect)
                // Ahead of the sheet's scrolling, so a drag that starts on
                // the dial always moves the sun.
                .highPriorityGesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            let dx = value.location.x - center.x, dy = value.location.y - center.y
                            var nextAzimuth = (atan2(dy, dx) * 180 / .pi + 90).truncatingRemainder(dividingBy: 360)
                            if nextAzimuth < 0 { nextAzimuth += 360 }
                            nextAzimuth = min(359, nextAzimuth.rounded())
                            let distance = min(radius, hypot(dx, dy))
                            let nextAltitude = max(minAltitude, min(maxAltitude, (90 - distance / radius * 90).rounded()))
                            local = (nextAzimuth, nextAltitude)
                            if Date().timeIntervalSince(lastSent) >= 1.0 / 30 {
                                lastSent = Date()
                                shell.act(azimuthSpec?.ref, .input, nextAzimuth)
                                shell.act(altitudeSpec?.ref, .input, nextAltitude)
                            }
                        }
                        .onEnded { _ in
                            if let local {
                                shell.act(azimuthSpec?.ref, .commit, local.azimuth)
                                shell.act(altitudeSpec?.ref, .commit, local.altitude)
                            }
                            local = nil
                        }
                )
            }
            .frame(height: 200)
            HStack {
                readout(title: "Azimuth", value: azimuthSpec?.display ?? "\(Int(azimuth))°", detail: compass(azimuth))
                Divider().frame(height: 26)
                readout(title: "Altitude", value: altitudeSpec?.display ?? "\(Int(altitude))°", detail: altitude >= 60 ? "High sun" : altitude <= 20 ? "Low, raking light" : "Mid sun")
            }
        }
        .padding(.vertical, 6)
        .sensoryFeedback(.selection, trigger: Int(azimuth / 45))
        .accessibilityRepresentation {
            VStack {
                Slider(value: Binding(get: { azimuth }, set: { shell.act(azimuthSpec?.ref, .commit, $0) }), in: 0...359, step: 1) {
                    Text("Sun azimuth")
                }
                .accessibilityValue("\(Int(azimuth)) degrees \(compass(azimuth))")
                Slider(value: Binding(get: { altitude }, set: { shell.act(altitudeSpec?.ref, .commit, $0) }), in: minAltitude...maxAltitude, step: 1) {
                    Text("Sun altitude")
                }
                .accessibilityValue("\(Int(altitude)) degrees")
            }
        }
    }

    private func readout(title: String, value: String, detail: String) -> some View {
        VStack(spacing: 1) {
            Text(title).portalFont(.caption2).foregroundStyle(.secondary).textCase(.uppercase)
            Text(value).portalFont(.subheadline, weight: .medium, digits: true).contentTransition(.numericText())
            Text(detail).portalFont(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func compass(_ degrees: Double) -> String {
        let names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
        return names[Int(((degrees / 22.5).rounded())).quotientAndRemainder(dividingBy: 16).remainder]
    }
}
