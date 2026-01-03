# ApexCharts Card – Zonneplan Electricity Prices (Home Assistant)

This repository is a custom fork of [apexcharts-card by @RomRider](https://github.com/RomRider/apexcharts-card) for Home Assistant, focused on visualizing Zonneplan electricity prices and dynamic energy tariffs for Home Assistant users in the Netherlands. It adds interactive
features such as drag-to-pan, viewport persistence, per-bar price color thresholds, and compact
hour-based tooltips—making it easier to identify cheap and expensive hours at a glance.

> This project is an independent fork and is not affiliated with Zonneplan or the upstream ApexCharts Card project.

**All original apexcharts-card functionality is 100% preserved.** You can use this fork exactly as you would the upstream version—new features are optional and only enabled when explicitly configured.

> **Mobile-friendly advantage:** Unlike Plotly-based Zonneplan charts, ApexCharts' touch interactions and tooltips work reliably on mobile devices—no hover-state limitations.

![Home Assistant Zonneplan electricity price chart using ApexCharts Card](https://i.imgur.com/qiT6rbG.png)

## Table of Contents

- [Use cases](#use-cases)
- [Status / Known limitations](#status--known-limitations)
- [Installation](#installation)
- [Required integration](#required-integration)
- [Setup](#setup)
- [Examples](#examples)
- [Fork-only features](#fork-only-features)
- [Feature Documentation](#feature-documentation)
  - [Drag-to-Pan + Viewport Persistence](#drag-to-pan--viewport-persistence)
  - [Per-Bar Color Thresholds](#per-bar-color-thresholds)
  - [Tooltip Template](#tooltip-template)
  - [Y-Axis Minimum Padding](#y-axis-minimum-padding)
  - [Per-Series Header Color](#per-series-header-color)
- [Compatibility](#compatibility)
- [Upstream documentation](#upstream-documentation)
- [License](#license)

## Use cases

- Visualize Zonneplan electricity prices per hour in Home Assistant
- Identify the cheapest and most expensive tariff windows
- Explore 24–48h energy price forecasts interactively
- Optimize appliance usage based on dynamic electricity pricing

## Installation

**Download:** Get `apexcharts-card.js` from the [Releases page](../../releases/latest) or build from source with `npm run build` (output in `dist/apexcharts-card.js`).

### Option A — HACS (recommended)

1. HACS → Frontend → ⋮ → Custom repositories  
2. Add: `https://github.com/<you>/<repo>`  
3. Category: **Lovelace**  
4. Install → Restart Home Assistant  
5. Add resource: `/hacsfiles/<repo-name>/apexcharts-card.js` (type: module)

### Option B — Manual

1. Copy `apexcharts-card.js` to `/config/www/` (so it becomes `/local/apexcharts-card.js`)
2. Add Lovelace resource: `/local/apexcharts-card.js` (type: module)
3. Restart Home Assistant (or reload resources)

## Required integration

- [Zonneplan One](https://github.com/fsaris/home-assistant-zonneplan-one) – provides `sensor.zonneplan_current_electricity_tariff` with forecast data.

## Setup

1) Install Zonneplan One and confirm the tariff sensor exists.  
2) Paste one of the examples below into a Manual card and adjust entity IDs/colors.


## Examples

### Zonneplan electricity forecast (48h)
```yaml
type: custom:apexcharts-card
graph_span: 48h
span:
  start: day
cache: false
stacked: false
now:
  show: true
  label: Nu
header:
  show: true
  title: Elektriciteitsprijzen
  show_states: true
  colorize_states: true
apex_config:
  chart:
    height: 250
series:
  - entity: sensor.zonneplan_current_electricity_tariff
    type: column
    name: Prognose
    unit: ct/kWh
    float_precision: 1
    show:
      in_chart: true
      in_header: false
    color_thresholds:
      - lt: 20
        color: "#00a3a9"
      - lt: 27
        color: "#00a964"
      - color: "#ed5e18"
    tooltip_template: "{day} {h1}-{h2}: <b>{value:.1f}</b> {unit}"
    data_generator: |
      const forecast = entity.attributes.forecast || [];
      return forecast.map((r) => [new Date(r.datetime).getTime(), (r.electricity_price / 10000000) * 100]);
  - entity: sensor.zonneplan_current_electricity_tariff
    name: Huidige prijs
    unit: ct/kWh
    float_precision: 1
    show:
      in_chart: false
      in_header: true
    transform: return x * 100;
  - entity: sensor.zonneplan_current_electricity_tariff
    name: Goedkoopste uur
    unit: ct/kWh
    float_precision: 1
    show:
      in_chart: false
      in_header: true
      header_color: "#00a3a9"
    data_generator: |
      const forecast = entity.attributes.forecast || [];
      if (forecast.length === 0) return [[Date.now(), 0]];
      let minItem = forecast[0];
      forecast.forEach((r) => {
        if ((r.electricity_price / 10000000) * 100 < (minItem.electricity_price / 10000000) * 100) {
          minItem = r;
        }
      });
      return [[Date.now(), (minItem.electricity_price / 10000000) * 100]];
    attribute: last_updated
  - entity: sensor.zonneplan_current_electricity_tariff
    name: Duurste uur
    unit: ct/kWh
    float_precision: 1
    show:
      in_chart: false
      in_header: true
      header_color: "#ed5e18"
    data_generator: |
      const forecast = entity.attributes.forecast || [];
      if (forecast.length === 0) return [[Date.now(), 0]];
      let maxItem = forecast[0];
      forecast.forEach((r) => {
        if ((r.electricity_price / 10000000) * 100 > (maxItem.electricity_price / 10000000) * 100) {
          maxItem = r;
        }
      });
      return [[Date.now(), (maxItem.electricity_price / 10000000) * 100]];
yaxis:
  - id: main
    min: auto
    min_padding: 1
```

### Minimal drag-pan + overscroll (scroll freely through the chart)
```yaml
type: custom:apexcharts-card
graph_span: 24h
series:
  - entity: sensor.zonneplan_current_electricity_tariff
    type: column
    data_generator: |
      const forecast = entity.attributes.forecast || [];
      return forecast.map((r) => [new Date(r.datetime).getTime(), (r.electricity_price / 10000000) * 100]);
interaction:
  drag_pan: true
  persist_view: true
  persist_view_storage: localStorage
  reset_on_doubleclick: true
  overscroll:
    mode: soft
    factor: 1.5
```

### Simple thresholds + tooltip template
```yaml
type: custom:apexcharts-card
graph_span: 24h
series:
  - entity: sensor.zonneplan_current_electricity_tariff
    type: column
    unit: ct/kWh
    color_thresholds:
      - lt: 15
        color: "#00a964"
      - lt: 25
        color: "#f59e0b"
      - color: "#ef4444"
    tooltip_template: "{day} {h1}-{h2}: <b>{value:.1f}</b> {unit}"
    data_generator: |
      const forecast = entity.attributes.forecast || [];
      return forecast.map((r) => [new Date(r.datetime).getTime(), (r.electricity_price / 10000000) * 100]);
yaxis:
  - min: auto
    min_padding: 0.5
```

---

## Fork-only features

The following configuration options are added by this fork and are not available in upstream apexcharts-card:

- `interaction.drag_pan`
- `interaction.persist_view`
- `interaction.persist_view_storage`
- `interaction.reset_on_doubleclick`
- `interaction.view_id`
- `interaction.overscroll.*`
- `series.color_thresholds`
- `series.tooltip_template`
- `yaxis.min_padding`
- `series.show.header_color`


## Feature Documentation

<details>
<summary><h3>Drag-to-Pan + Viewport Persistence</h3></summary>

Drag horizontally to scroll through forecasts. Optionally remember scroll position across page reloads.

```yaml
interaction:
  drag_pan: true
  persist_view: true
  persist_view_storage: localStorage  # or "memory" (default)
  reset_on_doubleclick: true          # double-click resets to default view
  view_id: "my-chart"                 # optional: stable storage key
  overscroll:
    mode: soft                         # or "none" (strict) / "infinite" (unlimited)
    factor: 1.5                        # soft mode: allows ±1.5× window beyond data
```

**Use case:** Zonneplan forecasts often span 48h; drag to explore cheapest/expensive hours.

</details>

---

<details>
<summary><h3>Per-Bar Color Thresholds</h3></summary>

Color individual bars based on their value, without needing multiple series.

```yaml
series:
  - entity: sensor.zonneplan_current_electricity_tariff
    type: column
    color_thresholds:
      - lt: 20
        color: "#00a964"    # ≤20 ct/kWh: green (cheap)
      - lt: 30
        color: "#f59e0b"    # 20–30: amber
      - color: "#ef4444"    # >30: red (expensive)
```

**Comparators:** `lt` (less than) | `lte` | `gt` | `gte` | none (fallback color).

**Use case:** Quickly spot cheap/expensive tariff windows in a single column.

</details>

---

<details>
<summary><h3>Tooltip Template</h3></summary>

Compact, formatted tooltips with placeholders.

```yaml
series:
  - entity: sensor.zonneplan_current_electricity_tariff
    tooltip_template: "{day} {h1}-{h2}: <b>{value:.1f}</b> {unit}"
```

**Available Placeholders**

| Placeholder | Description | Example Output |
|------------|-------------|----------------|
| `{value}` | Raw numeric value | `23.456` |
| `{value:.1f}` | Value with 1 decimal | `23.5` |
| `{value:.2f}` | Value with 2 decimals | `23.46` |
| `{unit}` | Series unit | `ct/kWh`, `W`, `kWh` |
| `{day}` | Weekday (short) | `Ma`, `Di`, `Wo` |
| `{h1}` | Hour start | `14:00` |
| `{h2}` | Hour end | `15:00` |
| `{time}` | Full time (HH:MM:SS) | `14:23:45` |
| `{x}` | Raw x-axis timestamp | `1704294225000` |

**Example Tooltip Templates**

Energy tariff (hour range):
```yaml
tooltip_template: "{day} {h1}-{h2}: <b>{value:.1f}</b> {unit}"
# Output: "Ma 14:00-15:00: 23.5 ct/kWh"
```

Solar power (precise time):
```yaml
tooltip_template: "Today {time}: <b>{value:.1f}</b> {unit}"
# Output: "Today 14:23:45: 3.2 kW"
```

Simple value display:
```yaml
tooltip_template: "<b>{value:.2f}</b> {unit}"
# Output: "23.46 ct/kWh"
```

**Use case:** Show tariff hour-by-hour clearly or display solar production with precise timestamps.

</details>

---

<details>
<summary><h3>Y-Axis Minimum Padding</h3></summary>

Add headroom below the computed minimum value.

```yaml
yaxis:
  - min: auto
    min_padding: 1  # add 1 unit of padding below min
```

**Note:** Ignored if `min` is explicitly set (not `auto`).

**Use case:** Prevent bars from touching the bottom edge when minimum values are small.

</details>

---

<details>
<summary><h3>Per-Series Header Color</h3></summary>

Override the header text color for individual series.

```yaml
series:
  - entity: sensor.zonneplan_current_electricity_tariff
    show:
      in_chart: false
      in_header: true
      header_color: "#00a964"  # force green, even if colorize_states is on
```

**Use case:** Highlight key series (e.g., cheapest hour in green, most expensive in red).

</details>


## Status / Known limitations

This is a personal fork that targets a specific Zonneplan use case. While it is working for day-to-day usage, some parts may still be rough around the edges and you may encounter minor issues.

### ~~Vertical bar stacking issue~~ (FIXED)
**Status:** Fixed in current version via state-tracked configuration updates.

Previously, bars would render stacked vertically in preview mode and occasionally on page load due to a race condition in chart config synchronization. The fix tracks the `stacked` configuration state and only re-applies it during data updates when it actually changes.

### Mobile tooltip lag (stale values)
On mobile devices, when rapidly tapping between bars, the tooltip may show a stale value from the previously selected bar instead of updating to the current selection.

**Workarounds:** 
- Tap deliberately with brief pauses between selections to allow the tooltip to update
- Tap elsewhere on the dashboard to dismiss the tooltip, then tap the new bar (forces full refresh)

**Technical details:** This appears to be an ApexCharts internal behavior where the tooltip callback isn't invoked on rapid successive touch events—it gets debounced or cached. Attempted fixes:
- `followCursor: false` – reduces cursor tracking overhead
- `hideDelay` / `showDelay` adjustments – no improvement
- Custom tooltip refresh hooks – limited by ApexCharts API

The issue is under investigation. If you find a solution or workaround, please open an issue or PR.

## Compatibility

This fork is based on upstream apexcharts-card and will likely not track upstream changes immediately. If you update Home Assistant or ApexCharts Card-related dependencies and something breaks, please open an issue on this repository (not upstream) and include your YAML and browser console logs.

Fork base: upstream apexcharts-card @ 6d3f1e9

## Upstream documentation
For all standard options and comprehensive usage, see the original project: https://github.com/RomRider/apexcharts-card

## License

This project is licensed under the MIT License.

Based on the original ApexCharts Card by Jérôme Wiedemann.
