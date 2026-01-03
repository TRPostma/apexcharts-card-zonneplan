# ApexCharts Card – Zonneplan Fork

This fork extends [apexcharts-card by @RomRider](https://github.com/RomRider/apexcharts-card) with features for exploring energy tariff forecasts—especially Netherlands electricity prices via Zonneplan. The goal is to help users quickly spot cheap/expensive hours, explore forecasts by dragging, and remember their view across page reloads.

![Zonneplan tariff chart preview](https://i.imgur.com/qiT6rbG.png)

## Required integration
- [Zonneplan One](https://github.com/fsaris/home-assistant-zonneplan-one) – provides `sensor.zonneplan_current_electricity_tariff` with forecast data.

## Integration steps
1) Install this forked `apexcharts-card.js` (HACS custom repo or manual copy to `/config/www`).
2) Add Lovelace resource: `/local/apexcharts-card.js` as `type: module`.
3) Install Zonneplan One integration and ensure the tariff sensor is available.
4) Paste one of the examples below into a Manual card and adjust entity IDs/colors.

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

## Feature Documentation

### Drag-to-Pan + Viewport Persistence
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

---

### Per-Bar Color Thresholds
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

---

### Tooltip Template
Compact, formatted tooltips with placeholders.

```yaml
tooltip_template: "{day} {h1}-{h2}: <b>{value:.1f}</b> {unit}"
```

**Placeholders:**
- `{value}`, `{value:.1f}`, `{value:.2f}` – numeric value with precision
- `{unit}` – series unit (e.g., "ct/kWh")
- `{day}` – date label (e.g., "2026-01-03")
- `{h1}`, `{h2}` – hour range (e.g., "14-15")
- `{x}` – raw x-axis value

**Use case:** Show tariff hour-by-hour clearly: "2026-01-03 14-15: **23.5** ct/kWh".

---

### Y-Axis Minimum Padding
Add headroom below the computed minimum value.

```yaml
yaxis:
  - min: auto
    min_padding: 1  # add 1 unit of padding below min
```

**Note:** Ignored if `min` is explicitly set (not `auto`).

**Use case:** Prevent bars from touching the bottom edge when minimum values are small.

---

### Per-Series Header Color
Override the header text color for individual series.

```yaml
series:
  - entity: sensor.zonneplan_current_electricity_tariff
    show:
      in_header: true
      header_color: "#00a964"  # force green, even if colorize_states is on
```

**Use case:** Highlight key series (e.g., cheapest hour in green, most expensive in red).

## Upstream documentation
For all standard options and comprehensive usage, see the original project: https://github.com/RomRider/apexcharts-card

## License

This project is licensed under the MIT License.

Based on the original ApexCharts Card by Jérôme Wiedemann.