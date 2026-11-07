import SwiftUI

/// Export image's area selection (snapshot.js "Select area"): a proposed
/// rectangle over the map that can be moved and resized from its corners,
/// with the output size and Save or Cancel. It covers the whole screen, so
/// its points are the map's own CSS pixels.
struct SnapshotSelection: View {
    @Environment(ShellModel.self) private var shell
    @State private var rect: CGRect = .zero
    @State private var start: CGRect?

    private static let minimum: CGFloat = 44
    private static let handle: CGFloat = 28

    var body: some View {
        GeometryReader { geometry in
            let bounds = CGRect(origin: .zero, size: geometry.size)
            ZStack(alignment: .topLeading) {
                // Dims everything the image leaves out.
                Path { path in
                    path.addRect(bounds)
                    path.addRect(rect)
                }
                .fill(.black.opacity(0.4), style: FillStyle(eoFill: true))
                .contentShape(Rectangle())
                // The map stays still while the area is chosen.
                .gesture(DragGesture(minimumDistance: 0))

                Rectangle()
                    .strokeBorder(.white, lineWidth: 2)
                    .background(Color.white.opacity(0.001))
                    .frame(width: rect.width, height: rect.height)
                    .offset(x: rect.minX, y: rect.minY)
                    .gesture(drag(in: bounds) { r, t in r.offsetBy(dx: t.width, dy: t.height) })
                    .accessibilityLabel("Selected area")

                ForEach(Corner.allCases, id: \.self) { corner in
                    Circle()
                        .fill(.white)
                        .shadow(radius: 2)
                        .frame(width: 18, height: 18)
                        .frame(width: Self.handle, height: Self.handle)
                        .contentShape(Rectangle())
                        .position(corner.point(of: rect))
                        .gesture(drag(in: bounds) { r, t in corner.resize(r, by: t, minimum: Self.minimum) })
                        .accessibilityHidden(true)
                }

                bar(bounds: bounds)
            }
            .onAppear {
                if rect == .zero {
                    rect = bounds.insetBy(dx: bounds.width * 0.12, dy: bounds.height * 0.22)
                }
            }
        }
        .ignoresSafeArea()
    }

    /// A drag that changes the rectangle from where it began, kept on screen.
    private func drag(in bounds: CGRect, _ change: @escaping (CGRect, CGSize) -> CGRect) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                let from = start ?? rect
                start = from
                rect = Self.clamp(change(from, value.translation), to: bounds)
            }
            .onEnded { _ in start = nil }
    }

    private static func clamp(_ r: CGRect, to bounds: CGRect) -> CGRect {
        let width = min(max(r.width, minimum), bounds.width)
        let height = min(max(r.height, minimum), bounds.height)
        let x = min(max(r.minX, bounds.minX), bounds.maxX - width)
        let y = min(max(r.minY, bounds.minY), bounds.maxY - height)
        return CGRect(x: x, y: y, width: width, height: height)
    }

    private var scale: Double { shell.map.exportScale }

    private func bar(bounds: CGRect) -> some View {
        let width = Int((rect.width * scale).rounded()), height = Int((rect.height * scale).rounded())
        return VStack {
            Spacer()
            HStack(spacing: 12) {
                Button("Cancel") { shell.send("snapshotSelectCancel", [:]) }
                    .buttonStyle(.glass)
                Spacer(minLength: 0)
                Text("\(width.formatted()) × \(height.formatted()) px")
                    .portalFont(.footnote, digits: true)
                    .foregroundStyle(.white)
                Spacer(minLength: 0)
                Button("Save") {
                    shell.send("snapshotArea", ["x0": rect.minX, "y0": rect.minY, "x1": rect.maxX, "y1": rect.maxY])
                }
                .buttonStyle(.glassProminent)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 34)
        }
        .frame(width: bounds.width, height: bounds.height)
    }

    private enum Corner: CaseIterable {
        case topLeft, topRight, bottomLeft, bottomRight

        func point(of r: CGRect) -> CGPoint {
            switch self {
            case .topLeft: CGPoint(x: r.minX, y: r.minY)
            case .topRight: CGPoint(x: r.maxX, y: r.minY)
            case .bottomLeft: CGPoint(x: r.minX, y: r.maxY)
            case .bottomRight: CGPoint(x: r.maxX, y: r.maxY)
            }
        }

        /// Moves this corner by `t`, keeping the opposite one fixed.
        func resize(_ r: CGRect, by t: CGSize, minimum: CGFloat) -> CGRect {
            var (x0, y0, x1, y1) = (r.minX, r.minY, r.maxX, r.maxY)
            switch self {
            case .topLeft: x0 = min(x0 + t.width, x1 - minimum); y0 = min(y0 + t.height, y1 - minimum)
            case .topRight: x1 = max(x1 + t.width, x0 + minimum); y0 = min(y0 + t.height, y1 - minimum)
            case .bottomLeft: x0 = min(x0 + t.width, x1 - minimum); y1 = max(y1 + t.height, y0 + minimum)
            case .bottomRight: x1 = max(x1 + t.width, x0 + minimum); y1 = max(y1 + t.height, y0 + minimum)
            }
            return CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
        }
    }
}
