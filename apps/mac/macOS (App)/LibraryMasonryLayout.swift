import SwiftUI

/// Measures each card at its column width before placing it in the shortest column.
/// System view spacing supplies the gutter, so sizing never depends on stale frames.
struct LibraryMasonryLayout: Layout {
    let columns: Int

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrangement(width: proposal.width ?? 650, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let layout = arrangement(width: bounds.width, subviews: subviews)
        for (index, view) in subviews.enumerated() {
            let frame = layout.frames[index]
            view.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                       anchor: .topLeading, proposal: ProposedViewSize(frame.size))
        }
    }

    private func arrangement(width: CGFloat, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        let count = max(1, columns)
        let horizontalGap = subviews.indices.dropFirst().map {
            subviews[$0 - 1].spacing.distance(to: subviews[$0].spacing, along: .horizontal)
        }.max() ?? 0
        let columnWidth = max(0, (width - CGFloat(count - 1) * horizontalGap) / CGFloat(count))
        var heights = Array(repeating: CGFloat.zero, count: count)
        var previous = Array<Int?>(repeating: nil, count: count)
        var frames: [CGRect] = []
        for (index, view) in subviews.enumerated() {
            let column = heights.indices.min { heights[$0] < heights[$1] } ?? 0
            if let prior = previous[column] {
                heights[column] += subviews[prior].spacing.distance(to: view.spacing, along: .vertical)
            }
            let size = view.sizeThatFits(ProposedViewSize(width: columnWidth, height: nil))
            frames.append(CGRect(x: CGFloat(column) * (columnWidth + horizontalGap), y: heights[column],
                                 width: columnWidth, height: size.height))
            heights[column] += size.height
            previous[column] = index
        }
        return (CGSize(width: width, height: heights.max() ?? 0), frames)
    }
}
