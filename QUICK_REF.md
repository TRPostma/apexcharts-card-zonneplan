# Quick Reference: Three New Features

## 1. Overscroll/Pan Beyond Data

**Enable horizontal panning beyond data boundaries**

```yaml
interaction:
  drag_pan: true
  overscroll:
    mode: "soft"  # or "infinite" or "none"
    factor: 1.5   # (only for "soft" mode)
```

**Modes:**
- `none` - Strict data boundary (original)
- `soft` - Allow ±factor × window beyond data (default: 1.5)
- `infinite` - Unlimited panning

---

## 2. Per-Bar Color Thresholds

**Color individual bars based on value (no multiple series needed!)**

```yaml
series:
  - type: column
    color_thresholds:
      - lt: 20
        color: "#00a964"    # Green
      - lt: 30
        color: "#365651"    # Dark green
      - lt: 35
        color: "#ed5e18"    # Orange
      - color: "#c2410c"    # Red (fallback)
```

**Comparators:** `lt`, `lte`, `gt`, `gte`, or none (fallback)

---

## 3. Tooltip Template

**Compact, Plotly-like tooltip formatting**

```yaml
series:
  - tooltip_template: "{day} {h1}-{h2} : <b>{value:.1f}</b> {unit}"
```

**Variables:**
- `{value}` - numeric value
- `{value:.1f}` - formatted with 1 decimal
- `{unit}` - series unit
- `{day}` - weekday (Zo, Ma, Di, ...)
- `{h1}` - start hour (HH:00)
- `{h2}` - end hour (HH:00)
- `{x}` - timestamp ms

**Precisions:** `.0f`, `.1f`, `.2f`, etc.

---

## Complete Example

```yaml
type: custom:apexcharts-card
series:
  - entity: sensor.electricity_price
    type: column
    unit: "€/kWh"
    color_thresholds:
      - lt: 20
        color: "#00a964"
      - lt: 30
        color: "#365651"
      - lt: 35
        color: "#ed5e18"
      - color: "#c2410c"
    tooltip_template: "{day} {h1}-{h2} : <b>{value:.1f}</b> {unit}"
    data_generator: |
      return [/* your forecast data */];
graph_span: 7d
interaction:
  drag_pan: true
  persist_view: true
  persist_view_storage: localStorage
  reset_on_doubleclick: true
  overscroll:
    mode: soft
    factor: 1.5
```

---

## Testing

**Local test server:**
```bash
cd /Users/timpostma/Documents/custom-apexcharts/apexcharts-card
python3 -m http.server 8000
# Open: http://localhost:8000/test-three-features.html
```

**Try these actions:**
1. ✅ Drag left/right to pan (works beyond data boundaries!)
2. ✅ Hover over bars to see custom tooltips
3. ✅ Notice bars colored by value thresholds
4. ✅ Mouse wheel does nothing (no zoom/scroll)
5. ✅ Double-click to reset viewport
6. ✅ Refresh page - viewport restored from localStorage

---

## Files Changed

- ✅ `src/types-config.ts` - Config types
- ✅ `src/apexcharts-card.ts` - Core logic
- ✅ `src/apex-layouts.ts` - Tooltip formatter
- ✅ `test-three-features.html` - Test page
- ✅ `THREE_FEATURES_SUMMARY.md` - Full docs

**Build:** `npm run build` ✅ Success!
