# Release Notes – v2.3.2-custom_zonneplan

## What's New

### Fixed
- **Vertical stacking bug** ✓: Charts no longer render with bars stacked vertically. Fixed by detecting stacked configuration changes and fully rebuilding the chart instance to clear ApexCharts internal render state corruption. Verified through extensive testing (40+ reloads with cache clears).

### Features (from previous releases)
- **Per-bar color thresholds**: Color individual column bars based on value thresholds without multiple series
- **Tooltip templates**: Custom tooltip formatting with placeholders (`{day}`, `{h1}-{h2}`, `{value:.1f}`, `{unit}`, `{time}`)
- **Drag-to-pan + viewport persistence**: Scroll through forecasts with optional localStorage-based view memory
- **Overscroll modes**: Soft/infinite panning beyond data boundaries
- **Y-axis minimum padding**: Add headroom below computed minimum
- **Per-series header colors**: Force specific header text colors for individual series

## Known Issues

### Mobile tooltip lag
When rapidly tapping between bars on mobile, the tooltip may show stale values from the previous selection. This is an ApexCharts internal limitation where the tooltip callback isn't invoked on rapid successive touch events.

**Workarounds:**
- Tap with brief pauses between selections
- Tap elsewhere to dismiss tooltip, then tap the desired bar

## Installation

Download `apexcharts-card.js` from the [Releases page](../../releases) or build from source with `npm run build` (output in `dist/`).

See [README.md](README.md) for full installation instructions.
