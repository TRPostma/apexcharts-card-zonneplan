import 'array-flat-polyfill';
import { LitElement, html, TemplateResult, PropertyValues, CSSResultGroup } from 'lit';
import { property, customElement, eventOptions } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { ClassInfo, classMap } from 'lit/directives/class-map.js';
import {
  ChartCardConfig,
  ChartCardSeriesConfig,
  ChartCardYAxis,
  EntityCachePoints,
  EntityEntryCache,
  HistoryPoint,
  minmax_type,
} from './types';
import { handleAction, HomeAssistant } from 'custom-card-helpers';
import localForage from 'localforage';
import * as pjson from '../package.json';
import {
  computeColor,
  computeColors,
  computeName,
  computeTextColor,
  computeUom,
  decompress,
  formatApexDate,
  getLang,
  getPercentFromValue,
  interpolateColor,
  is12Hour,
  log,
  mergeConfigTemplates,
  mergeDeep,
  mergeDeepConfig,
  myFormatNumber,
  offsetData,
  prettyPrintTime,
  truncateFloat,
  validateInterval,
  validateOffset,
  getLovelace,
  isUsingServerTimezone,
  computeTimezoneDiffWithLocal,
} from './utils';
import ApexCharts from 'apexcharts';
import { Ripple } from '@material/mwc-ripple';
import { stylesApex } from './styles';
import { HassEntity } from 'home-assistant-js-websocket';
import { getBrushLayoutConfig, getLayoutConfig } from './apex-layouts';
import GraphEntry from './graphEntry';
import { createCheckers } from 'ts-interface-checker';
import {
  ActionsConfig,
  ChartCardColorThreshold,
  ChartCardExternalConfig,
  ChartCardSeriesExternalConfig,
} from './types-config';
import exportedTypeSuite from './types-config-ti';
import {
  DEFAULT_AREA_OPACITY,
  DEFAULT_FILL_RAW,
  DEFAULT_FLOAT_PRECISION,
  DEFAULT_SHOW_IN_CHART,
  DEFAULT_SHOW_IN_HEADER,
  DEFAULT_SHOW_IN_LEGEND,
  DEFAULT_SHOW_LEGEND_VALUE,
  DEFAULT_SHOW_NAME_IN_HEADER,
  DEFAULT_SHOW_NULL_IN_HEADER,
  DEFAULT_SHOW_ZERO_IN_HEADER,
  DEFAULT_SHOW_OFFSET_IN_NAME,
  DEFAULT_UPDATE_DELAY,
  moment,
  NO_VALUE,
  PLAIN_COLOR_TYPES,
  TIMESERIES_TYPES,
} from './const';
import {
  DEFAULT_COLORS,
  DEFAULT_DURATION,
  DEFAULT_FUNC,
  DEFAULT_GROUP_BY_FILL,
  DEFAULT_GRAPH_SPAN,
  DEFAULT_SERIE_TYPE,
  HOUR_24,
} from './const';
import parse from 'parse-duration';
import tinycolor from '@ctrl/tinycolor';
import { actionHandler } from './action-handler-directive';
import { OverrideFrontendLocaleData } from './types-ha';

/* eslint no-console: 0 */
console.info(
  `%c APEXCHARTS-CARD %c v${pjson.version} `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ApexCharts = ApexCharts;

localForage.config({
  name: 'apexchart-card',
  version: 1.0,
  storeName: 'entity_history_cache',
  description: 'ApexCharts-card uses caching for the entity history',
});

localForage
  .iterate((data, key) => {
    const value: EntityEntryCache = key.endsWith('-raw') ? data : decompress(data);
    if (value.card_version !== pjson.version) {
      localForage.removeItem(key);
    }
    const start = new Date();
    start.setTime(start.getTime() - value.span);
    if (new Date(value.last_fetched) < start) {
      localForage.removeItem(key);
    }
  })
  .catch((err) => {
    console.warn('Purging has errored: ', err);
  });

@customElement('apexcharts-card')
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class ChartsCard extends LitElement {
  private _hass?: HomeAssistant;

  private _apexChart?: ApexCharts;

  private _apexBrush?: ApexCharts;

  private _loaded = false;

  @property({ type: Boolean }) private _updating = false;

  private _graphs: (GraphEntry | undefined)[] | undefined;

  @property({ attribute: false }) private _config?: ChartCardConfig;

  private _entities: HassEntity[] = [];

  private _interval?: number;

  private _intervalTimeout?: NodeJS.Timeout;

  private _colors: string[] = [];

  private _brushColors: string[] = [];

  private _headerColors: string[] = [];

  private _graphSpan: number = HOUR_24;

  private _offset = 0;

  @property({ attribute: false }) private _headerState: (number | null)[] = [];

  @property({ attribute: false }) private _headerStateExtra: string[] = [];

  @property({ attribute: false }) private _maxPrice: number | null = null;

  private _dataLoaded = false;

  private _seriesOffset: number[] = [];

  private _seriesTimeDelta: number[] = [];

  private _updateDelay: number = DEFAULT_UPDATE_DELAY;

  private _brushInit = false;

  private _brushSelectionSpan = 0;

  private _yAxisConfig?: ChartCardYAxis[];

  private _serverTimeOffset = 0;

  @property({ attribute: false }) _lastUpdated: Date = new Date();

  @property({ type: Boolean }) private _warning = false;

  // Drag-pan and viewport persistence state
  private _dragState: { active: boolean; startX: number; startMin: number; startMax: number; plotWidthPx: number } | null = null;

  private _viewState: { min: number; max: number } | null = null;

  private _defaultView: { min: number; max: number } | null = null;

  private _restoringView = false;

  private _restoreQueued = false;

  private _storageKey = '';

  private _pointerListenersAttached = false;

  private _rafId: number | null = null;

  public connectedCallback() {
    super.connectedCallback();
    if (this._config && this._hass && !this._loaded) {
      this._initialLoad();
    } else if (this._config && this._hass && this._apexChart && !this._config.update_interval) {
      window.requestAnimationFrame(() => {
        this._updateOnInterval();
      });
    }
    if (this._config?.update_interval) {
      window.requestAnimationFrame(() => {
        this._updateOnInterval();
      });
      // Valid because setConfig has been done.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this._intervalTimeout = setInterval(() => this._updateOnInterval(), this._interval!);
    }
  }

  disconnectedCallback() {
    if (this._intervalTimeout) {
      clearInterval(this._intervalTimeout);
    }
    // Clean up drag-pan RAF
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    // Clean up state
    this._dragState = null;
    this._restoreQueued = false;
    this._updating = false;
    super.disconnectedCallback();
  }

  private _updateOnInterval(): void {
    if (!this._updating && this._hass) {
      this._updating = true;
      this._updateData();
    }
  }

  protected updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    if (this._config && this._hass && this.isConnected && !this._loaded) {
      this._initialLoad();
    }
  }

  private _firstDataLoad() {
    if (this._updating || this._dataLoaded || !this._apexChart || !this._config || !this._hass) return;
    this._dataLoaded = true;
    this._updating = true;
    this._updateData().then(() => {
      if (this._config?.experimental?.hidden_by_default) {
        this._config.series_in_graph.forEach((serie, index) => {
          if (serie.show.hidden_by_default) {
            const name = computeName(index, this._config?.series_in_graph, this._entities);
            this._apexChart?.hideSeries(name);
          }
        });
      }
    });
  }

  public set hass(hass: HomeAssistant) {
    this._hass = hass;
    if (!this._config || !this._graphs || !hass) return;

    this._graphs.map((graph) => {
      if (graph) graph.hass = hass;
    });

    let updated = false;
    let rawHeaderStatesUpdated = false;
    this._config.series.forEach((serie, index) => {
      const entityState = (hass && hass.states[serie.entity]) || undefined;
      if (!entityState) {
        this._entities[index] = entityState;
      } else if (entityState && this._entities[index] !== entityState) {
        this._entities[index] = entityState;
        updated = true;
        if (this._graphs && this._graphs[index]) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          this._graphs[index]!.hass = this._hass!;
        }
        if (serie.show.in_header === 'raw') {
          this._headerState[index] = truncateFloat(
            serie.attribute ? entityState.attributes[serie.attribute] : entityState.state,
            serie.float_precision,
          ) as number;
          rawHeaderStatesUpdated = true;
        }
      }
    });
    if (rawHeaderStatesUpdated) {
      this._headerState = [...this._headerState];
    }
    if (this._config.series.some((_, index) => this._entities[index] === undefined)) {
      this._warning = true;
      return;
    } else if (this._warning) {
      this._warning = false;
      this._reset();
    }
    if (updated) {
      this._entities = [...this._entities];
      if (!this._updating && !this._config.update_interval) {
        if (!this._dataLoaded) {
          this._firstDataLoad();
        } else {
          this._updating = true;
          // give time to HA's recorder component to write the data in the history
          setTimeout(() => {
            this._updateData();
          }, this._updateDelay);
        }
      }
    }
  }

  private _reset() {
    if (this._apexChart) {
      this._apexChart.destroy();
      this._apexChart = undefined;
      this._loaded = false;
      this._dataLoaded = false;
      this._updating = false;
      this._serverTimeOffset = 0;
      if (this._apexBrush) {
        this._apexBrush.destroy();
        this._apexBrush = undefined;
        this._brushInit = false;
      }
    }
    if (this._config && this._hass && !this._loaded) {
      this._initialLoad();
    }
  }

  public setConfig(config: ChartCardExternalConfig) {
    let configDup: ChartCardExternalConfig = JSON.parse(JSON.stringify(config));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((configDup as any).entities) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      configDup.series = (configDup as any).entities;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (configDup as any).entities;
    }
    configDup = configDup as ChartCardExternalConfig;
    if (configDup.config_templates) {
      configDup.config_templates =
        configDup.config_templates && Array.isArray(configDup.config_templates)
          ? configDup.config_templates
          : [configDup.config_templates];
      configDup = mergeConfigTemplates(getLovelace(), configDup);
    }
    try {
      const { ChartCardExternalConfig } = createCheckers(exportedTypeSuite);
      if (!configDup.experimental?.disable_config_validation) {
        ChartCardExternalConfig.strictCheck(configDup);
      }
      if (configDup.all_series_config) {
        configDup.series.forEach((serie, index) => {
          const allDup = JSON.parse(JSON.stringify(configDup.all_series_config));
          configDup.series[index] = mergeDeepConfig(allDup, serie);
        });
      }
      if (configDup.update_interval) {
        this._interval = validateInterval(configDup.update_interval, 'update_interval');
      }
      if (configDup.graph_span) {
        this._graphSpan = validateInterval(configDup.graph_span, 'graph_span');
      }
      if (configDup.span?.offset) {
        this._offset = validateOffset(configDup.span.offset, 'span.offset');
      }
      if (configDup.span?.end && configDup.span?.start) {
        throw new Error(`span: Only one of 'start' or 'end' is allowed.`);
      }
      if (configDup.brush?.selection_span) {
        this._brushSelectionSpan = validateInterval(configDup.brush.selection_span, 'brush.selection_span');
      }
      configDup.series.forEach((serie, index) => {
        if (serie.offset) {
          this._seriesOffset[index] = validateOffset(serie.offset, `series[${index}].offset`);
        }
        if (serie.time_delta) {
          this._seriesTimeDelta[index] = validateOffset(serie.time_delta, `series[${index}].time_delta`);
        }
      });
      if (configDup.update_delay) {
        this._updateDelay = validateInterval(configDup.update_delay, `update_delay`);
      }

      this._config = mergeDeep(
        {
          graph_span: DEFAULT_GRAPH_SPAN,
          cache: true,
          useCompress: false,
          show: { loading: true },
        },
        configDup,
      );

      const defColors = this._config?.color_list || DEFAULT_COLORS;
      if (this._config) {
        this._graphs = this._config.series.map((serie, index) => {
          serie.index = index;
          serie.ignore_history = !!(
            this._config?.chart_type &&
            ['donut', 'pie', 'radialBar'].includes(this._config?.chart_type) &&
            (!serie.group_by || serie.group_by?.func === 'raw') &&
            !serie.data_generator &&
            !serie.statistics &&
            !serie.offset
          );
          if (!this._headerColors[index]) {
            this._headerColors[index] = defColors[index % defColors.length];
          }
          if (serie.color) {
            this._headerColors[index] = serie.color;
          }
          serie.fill_raw = serie.fill_raw || DEFAULT_FILL_RAW;
          serie.extend_to = serie.extend_to !== undefined ? serie.extend_to : 'end';
          serie.type = this._config?.chart_type ? undefined : serie.type || DEFAULT_SERIE_TYPE;
          // Skip auto-bucketing if data_generator provides explicit data
          if (!serie.group_by) {
            if (serie.data_generator) {
              // data_generator provides pre-bucketed data, use 'raw' to prevent re-aggregation
              serie.group_by = { duration: '1h', func: 'raw', fill: DEFAULT_GROUP_BY_FILL };
            } else {
              serie.group_by = { duration: DEFAULT_DURATION, func: DEFAULT_FUNC, fill: DEFAULT_GROUP_BY_FILL };
            }
          } else {
            serie.group_by.duration = serie.group_by.duration || DEFAULT_DURATION;
            serie.group_by.func = serie.group_by.func || DEFAULT_FUNC;
            serie.group_by.fill = serie.group_by.fill || DEFAULT_GROUP_BY_FILL;
          }
          if (!serie.show) {
            serie.show = {
              in_legend: DEFAULT_SHOW_IN_LEGEND,
              legend_value: DEFAULT_SHOW_LEGEND_VALUE,
              in_header: DEFAULT_SHOW_IN_HEADER,
              in_chart: DEFAULT_SHOW_IN_CHART,
              name_in_header: DEFAULT_SHOW_NAME_IN_HEADER,
              null_in_header: DEFAULT_SHOW_NULL_IN_HEADER,
              zero_in_header: DEFAULT_SHOW_ZERO_IN_HEADER,
              offset_in_name: DEFAULT_SHOW_OFFSET_IN_NAME,
            };
          } else {
            serie.show.in_legend = serie.show.in_legend === undefined ? DEFAULT_SHOW_IN_LEGEND : serie.show.in_legend;
            serie.show.legend_value =
              serie.show.legend_value === undefined ? DEFAULT_SHOW_LEGEND_VALUE : serie.show.legend_value;
            serie.show.in_chart = serie.show.in_chart === undefined ? DEFAULT_SHOW_IN_CHART : serie.show.in_chart;
            serie.show.in_header =
              serie.show.in_header === undefined
                ? !serie.show.in_chart && serie.show.in_brush
                  ? false
                  : DEFAULT_SHOW_IN_HEADER
                : serie.show.in_header;
            serie.show.name_in_header =
              serie.show.name_in_header === undefined ? DEFAULT_SHOW_NAME_IN_HEADER : serie.show.name_in_header;
            serie.show.null_in_header =
              serie.show.null_in_header === undefined ? DEFAULT_SHOW_NULL_IN_HEADER : serie.show.null_in_header;
            serie.show.zero_in_header =
              serie.show.zero_in_header === undefined ? DEFAULT_SHOW_ZERO_IN_HEADER : serie.show.zero_in_header;
            serie.show.offset_in_name =
              serie.show.offset_in_name === undefined ? DEFAULT_SHOW_OFFSET_IN_NAME : serie.show.offset_in_name;
          }
          validateInterval(serie.group_by.duration, `series[${index}].group_by.duration`);
          if (serie.color_threshold && serie.color_threshold.length > 0) {
            const sorted: ChartCardColorThreshold[] = JSON.parse(JSON.stringify(serie.color_threshold));
            sorted.sort((a, b) => (a.value < b.value ? -1 : 1));
            serie.color_threshold = sorted;
          }

          if (serie.entity) {
            const editMode = getLovelace()?.editMode;
            // disable caching for editor
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const caching = editMode === true ? false : this._config!.cache;
            const graphEntry = new GraphEntry(
              index,
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              this._graphSpan!,
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              caching,
              serie,
              this._config?.span,
            );
            if (this._hass) graphEntry.hass = this._hass;
            return graphEntry;
          }
          return undefined;
        });
        this._config.series_in_graph = [];
        this._config.series_in_brush = [];
        this._config.series.forEach((serie, index) => {
          if (serie.show.in_chart) {
            this._colors.push(this._headerColors[index]);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this._config!.series_in_graph.push(serie);
          }
          if (this._config?.experimental?.brush && serie.show.in_brush) {
            this._brushColors.push(this._headerColors[index]);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this._config!.series_in_brush.push(serie);
          }
        });
        if (this._config.yaxis && this._config.yaxis.length > 1) {
          if (
            this._config.series_in_graph.some((serie) => {
              return !serie.yaxis_id;
            })
          ) {
            throw new Error(`Multiple yaxis detected: Some series are missing the 'yaxis_id' configuration.`);
          }
          if (
            this._config.yaxis.some((yaxis) => {
              return !yaxis.id;
            })
          ) {
            throw new Error(`Multiple yaxis detected: Some yaxis are missing an 'id'.`);
          }
        }
        if (this._config.yaxis) {
          const yAxisConfig = this._generateYAxisConfig(this._config);
          if (this._config.apex_config) {
            this._config.apex_config.yaxis = yAxisConfig;
          } else {
            this._config.apex_config = {
              yaxis: yAxisConfig,
            };
          }
          this._yAxisConfig?.forEach((yaxis) => {
            [yaxis.min, yaxis.min_type] = this._getTypeOfMinMax(yaxis.min);
            [yaxis.max, yaxis.max_type] = this._getTypeOfMinMax(yaxis.max);
          });
        }
        this._headerColors = this._headerColors.slice(0, this._config?.series.length);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new Error(`/// apexcharts-card version ${pjson.version} /// ${e.message}`);
    }
    // Full reset only happens in editor mode
    // this._reset();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _generateYAxisConfig(config: ChartCardConfig): ApexYAxis[] | undefined {
    if (!config.yaxis) return undefined;
    const burned: boolean[] = [];
    this._yAxisConfig = JSON.parse(JSON.stringify(config.yaxis));
    const yaxisConfig: ApexYAxis[] = config.series_in_graph.map((serie, serieIndex) => {
      let idx = -1;
      if (config.yaxis?.length !== 1) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        idx = config.yaxis!.findIndex((yaxis) => {
          return yaxis.id === serie.yaxis_id;
        });
      } else {
        idx = 0;
      }
      if (idx < 0) {
        throw new Error(`yaxis_id: ${serie.yaxis_id} doesn't exist.`);
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any
      let yAxisDup: any = JSON.parse(JSON.stringify(config.yaxis![idx]));
      delete yAxisDup.apex_config;
      delete yAxisDup.decimals;
      yAxisDup.decimalsInFloat =
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        config.yaxis![idx].decimals === undefined ? DEFAULT_FLOAT_PRECISION : config.yaxis![idx].decimals;
      if (this._yAxisConfig?.[idx].series_id) {
        this._yAxisConfig?.[idx].series_id?.push(serieIndex);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this._yAxisConfig![idx].series_id! = [serieIndex];
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (config.yaxis![idx].apex_config) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        yAxisDup = mergeDeep(yAxisDup, config.yaxis![idx].apex_config);
        delete yAxisDup.apex_config;
      }
      if (typeof yAxisDup.min !== 'number') delete yAxisDup.min;
      if (typeof yAxisDup.max !== 'number') delete yAxisDup.max;
      if (burned[idx]) {
        yAxisDup.show = false;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        yAxisDup.show = config.yaxis![idx].show === undefined ? true : config.yaxis![idx].show;
        burned[idx] = true;
      }
      return yAxisDup;
    });
    return yaxisConfig;
  }

  /**
   * Compute stable storage key for viewport persistence
   */
  private _computeStorageKey(): string {
    if (this._config?.interaction?.view_id) {
      return `apex_view::${this._config.interaction.view_id}`;
    }
    // Hash based on sorted entity IDs + graph_span + title
    const entityIds = this._config?.series.map((s) => s.entity).sort().join('|') || '';
    const graphSpan = this._config?.graph_span || '';
    const title = this._config?.header?.title || '';
    const key = `${entityIds}|${graphSpan}|${title}`;
    // Simple hash
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `apex_view::${Math.abs(hash).toString(36)}`;
  }

  /**
   * Extract data extent (min and max timestamps) from series
   */
  private _getDataExtent(): { min: number; max: number } | null {
    if (!this._graphs || this._graphs.length === 0) return null;

    let minTimestamp = Infinity;
    let maxTimestamp = -Infinity;
    let hasData = false;

    this._graphs.forEach((graph) => {
      if (!graph) return;
      const data = graph.history;
      if (data && data.length > 0) {
        hasData = true;
        data.forEach((point) => {
          const ts = point[0];
          if (ts < minTimestamp) minTimestamp = ts;
          if (ts > maxTimestamp) maxTimestamp = ts;
        });
      }
    });

    return hasData ? { min: minTimestamp, max: maxTimestamp } : null;
  }

  /**
   * Clamp a viewport range according to overscroll settings
   */
  private _clampViewport(min: number, max: number): { min: number; max: number } | null {
    const extent = this._getDataExtent();
    if (!extent) return null;

    const range = max - min;
    const minRange = (extent.max - extent.min) * 0.01; // At least 1% of data range

    if (range < minRange) {
      // Range too small, fall back to default
      return null;
    }

    // Get overscroll settings
    const overscrollMode = this._config?.interaction?.overscroll?.mode || 'soft';
    const overscrollFactor = this._config?.interaction?.overscroll?.factor || 1.5;
    
    if (overscrollMode === 'infinite') {
      // No clamping at all - allow infinite panning
      return { min, max };
    }
    
    if (overscrollMode === 'none') {
      // Strict clamping to data extent (original behavior)
      let clampedMin = Math.max(min, extent.min);
      let clampedMax = Math.min(max, extent.max);

      // If clamping inverted the range, adjust
      if (clampedMax <= clampedMin) {
        clampedMax = clampedMin + range;
      }

      // Ensure we don't exceed bounds
      if (clampedMax > extent.max) {
        const overflow = clampedMax - extent.max;
        clampedMax = extent.max;
        clampedMin = Math.max(clampedMin - overflow, extent.min);
      }
      if (clampedMin < extent.min) {
        const underflow = extent.min - clampedMin;
        clampedMin = extent.min;
        clampedMax = Math.min(clampedMax + underflow, extent.max);
      }

      return { min: clampedMin, max: clampedMax };
    }
    
    // mode === 'soft': allow overscroll by factor * windowRange
    const windowRange = range;
    const minLimit = extent.min - overscrollFactor * windowRange;
    const maxLimit = extent.max + overscrollFactor * windowRange;
    
    const clampedMin = Math.max(min, minLimit);
    const clampedMax = Math.min(max, maxLimit);
    
    // Ensure min < max
    if (clampedMax <= clampedMin) {
      return null;
    }
    
    return { min: clampedMin, max: clampedMax };
  }

  /**
   * Apply color thresholds to a single data point value
   */
  private _getThresholdColor(value: number | null, thresholds: any[]): string | undefined {
    if (value === null || value === undefined || !thresholds || thresholds.length === 0) {
      return undefined;
    }
    
    // Apply first matching threshold
    for (const threshold of thresholds) {
      if (threshold.lt !== undefined) {
        if (value < threshold.lt) {
          return threshold.color;
        }
      } else if (threshold.lte !== undefined) {
        if (value <= threshold.lte) {
          return threshold.color;
        }
      } else if (threshold.gt !== undefined) {
        if (value > threshold.gt) {
          return threshold.color;
        }
      } else if (threshold.gte !== undefined) {
        if (value >= threshold.gte) {
          return threshold.color;
        }
      } else {
        // Fallback threshold without comparator
        return threshold.color;
      }
    }
    
    return undefined;
  }

  /**
   * Transform series data to object form with fillColor for column charts
   */
  private _applyColorThresholds(data: EntityCachePoints, serieConfig: any): any[] {
    if (serieConfig.type !== 'column' || !serieConfig.color_thresholds) {
      // Return as-is for non-column series or when no thresholds defined
      return data.map(point => [point[0], point[1]]);
    }
    
    // Transform to object form with fillColor
    return data.map(point => {
      const [x, y] = point;
      const fillColor = this._getThresholdColor(y, serieConfig.color_thresholds);
      
      if (fillColor) {
        return { x, y, fillColor };
      } else {
        return { x, y };
      }
    });
  }

  /**
   * Load persisted viewport from storage
   */
  private async _loadViewState(): Promise<void> {
    if (!this._config?.interaction?.persist_view) return;

    const storageType = this._config.interaction.persist_view_storage || 'memory';
    if (storageType === 'localStorage') {
      try {
        const stored = localStorage.getItem(this._storageKey);
        if (stored) {
          this._viewState = JSON.parse(stored);
        }
      } catch (e) {
        console.warn('Failed to load view state from localStorage:', e);
      }
    }
    // For memory storage, _viewState is already null initially
  }

  /**
   * Save viewport to storage
   */
  private _saveViewState(): void {
    if (!this._config?.interaction?.persist_view || !this._viewState) return;

    const storageType = this._config.interaction.persist_view_storage || 'memory';
    if (storageType === 'localStorage') {
      try {
        localStorage.setItem(this._storageKey, JSON.stringify(this._viewState));
      } catch (e) {
        console.warn('Failed to save view state to localStorage:', e);
      }
    }
  }

  /**
   * Clear persisted viewport state (e.g., on double-click reset)
   */
  private _clearViewState(): void {
    this._viewState = null;
    const storageType = this._config?.interaction?.persist_view_storage || 'memory';
    if (storageType === 'localStorage') {
      try {
        localStorage.removeItem(this._storageKey);
      } catch (e) {
        console.warn('Failed to clear view state from localStorage:', e);
      }
    }
  }

  /**
   * Restore the current viewport (either persisted or default)
   */
  private _restoreViewport(): void {
    if (!this._apexChart || this._restoringView) return;

    this._restoringView = true;
    try {
      const viewToApply = this._viewState || this._defaultView;
      if (viewToApply) {
        this._apexChart.updateOptions(
          {
            xaxis: {
              min: viewToApply.min,
              max: viewToApply.max,
            },
          },
          false,
          false,
          false,
        );
      }
    } finally {
      this._restoringView = false;
    }
  }

  /**
   * Queue a viewport restore (coalesced to next animation frame)
   */
  private _queueViewRestore(): void {
    if (this._restoreQueued) return;
    this._restoreQueued = true;

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
    }

    this._rafId = window.requestAnimationFrame(() => {
      this._rafId = null;
      this._restoreQueued = false;
      this._restoreViewport();
    });
  }

  /**
   * Attach pointer event listeners for drag-pan
   */
  private _attachPointerListeners(): void {
    if (this._pointerListenersAttached || !this._apexChart) return;

    const container = this.shadowRoot?.querySelector('#graph') as HTMLElement;
    if (!container) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!this._config?.interaction?.drag_pan || e.button !== 0) return; // Left button only

      const container = this.shadowRoot?.querySelector('#graph') as HTMLElement;
      if (!container) return;

      // Get plot dimensions
      const rect = container.getBoundingClientRect();
      const plotWidthPx = rect.width;

      // Read current xaxis range
      let startMin = (this._apexChart as any).axes?.w?.globals?.minX;
      let startMax = (this._apexChart as any).axes?.w?.globals?.maxX;

      // Fallback: try to extract from current series data
      if (startMin === undefined || startMax === undefined) {
        const extent = this._getDataExtent();
        if (extent) {
          startMin = extent.min;
          startMax = extent.max;
        } else {
          return; // Can't determine range
        }
      }

      this._dragState = {
        active: true,
        startX: e.clientX,
        startMin,
        startMax,
        plotWidthPx,
      };

      (e.target as any).setPointerCapture(e.pointerId);
      container.style.touchAction = 'none';
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this._dragState?.active) return;

      if (this._rafId !== null) {
        cancelAnimationFrame(this._rafId);
      }

      this._rafId = window.requestAnimationFrame(() => {
        this._rafId = null;
        if (!this._dragState?.active) return;

        const deltaX = e.clientX - this._dragState.startX;
        const timePerPixel = (this._dragState.startMax - this._dragState.startMin) / this._dragState.plotWidthPx;
        const deltaTime = -deltaX * timePerPixel; // Negative because dragging right = panning left (earlier time)

        let newMin = this._dragState.startMin + deltaTime;
        let newMax = this._dragState.startMax + deltaTime;

        // Clamp to data extent
        const clamped = this._clampViewport(newMin, newMax);
        if (!clamped) {
          // Clamping failed, stop drag
          this._dragState.active = false;
          return;
        }

        newMin = clamped.min;
        newMax = clamped.max;

        this._apexChart?.updateOptions(
          {
            xaxis: {
              min: newMin,
              max: newMax,
            },
          },
          false,
          false,
          false,
        );
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this._dragState?.active) return;

      (e.target as any).releasePointerCapture(e.pointerId);

      const container = this.shadowRoot?.querySelector('#graph') as HTMLElement;
      if (container) {
        container.style.touchAction = '';
      }

      // Save final state
      const finalMin = (this._apexChart as any).axes?.w?.globals?.minX;
      const finalMax = (this._apexChart as any).axes?.w?.globals?.maxX;

      if (finalMin !== undefined && finalMax !== undefined) {
        this._viewState = { min: finalMin, max: finalMax };
        this._saveViewState();
      }

      this._dragState.active = false;
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (!this._dragState?.active) return;
      (e.target as any).releasePointerCapture(e.pointerId);
      const container = this.shadowRoot?.querySelector('#graph') as HTMLElement;
      if (container) {
        container.style.touchAction = '';
      }
      this._dragState.active = false;
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerCancel);

    this._pointerListenersAttached = true;
  }

  /**
   * Attach double-click listener for reset
   */
  private _attachDoubleClickListener(): void {
    if (!this._config?.interaction?.reset_on_doubleclick) return;

    const container = this.shadowRoot?.querySelector('#graph') as HTMLElement;
    if (!container) return;

    const onDoubleClick = () => {
      this._clearViewState();
      if (this._defaultView && this._apexChart) {
        this._apexChart.updateOptions(
          {
            xaxis: {
              min: this._defaultView.min,
              max: this._defaultView.max,
            },
          },
          false,
          false,
          false,
        );
      }
    };

    container.addEventListener('dblclick', onDoubleClick);
  }

  static get styles(): CSSResultGroup {
    return stylesApex;
  }

  protected render(): TemplateResult {
    if (!this._config || !this._hass) return html``;
    if (this._warning || this._config.series.some((_, index) => this._entities[index] === undefined)) {
      return this._renderWarnings();
    }

    const spinnerClass: ClassInfo = {
      'lds-ring': this._config.show?.loading && this._updating ? true : false,
    };
    const wrapperClasses: ClassInfo = {
      wrapper: true,
      'with-header': this._config.header?.show || true,
    };
    const haCardClasses: ClassInfo = {
      section: this._config.section_mode || false,
    };

    const standardHeaderTitle = this._config.header?.standard_format ? this._config.header?.title : undefined;

    return html`
      <ha-card header=${ifDefined(standardHeaderTitle)} class=${classMap(haCardClasses)}>
        <div id="spinner-wrapper">
          <div id="spinner" class=${classMap(spinnerClass)}>
            <div></div>
            <div></div>
            <div></div>
            <div></div>
          </div>
        </div>
        <div class=${classMap(wrapperClasses)}>
          ${this._config.header?.show && (this._config.header.show_states || !this._config.header.standard_format)
            ? this._renderHeader()
            : html``}
          <div id="graph-wrapper">
            <div id="graph"></div>
            ${this._config.series_in_brush.length ? html`<div id="brush"></div>` : ``}
          </div>
        </div>
        ${this._renderLastUpdated()} ${this._renderVersion()}
      </ha-card>
    `;
  }

  private _renderWarnings(): TemplateResult {
    return html`
      <ha-card class="warning">
        <hui-warning>
          <div style="font-weight: bold;">apexcharts-card</div>
          ${this._config?.series.map((_, index) =>
            !this._entities[index]
              ? html` <div>Entity not available: ${this._config?.series[index].entity}</div> `
              : html``,
          )}
        </hui-warning>
      </ha-card>
    `;
  }

  private _renderHeader(): TemplateResult {
    const classes: ClassInfo = {
      floating: this._config?.header?.floating || false,
    };
    return html`
      <div id="header" class=${classMap(classes)}>
        ${!this._config?.header?.standard_format && this._config?.header?.title ? this._renderTitle() : html``}
        ${this._config?.header?.show_states ? this._renderStates() : html``}
      </div>
    `;
  }

  private _renderTitle(): TemplateResult {
    const classes =
      this._config?.header?.disable_actions ||
      !this._config?.header?.title_actions ||
      (this._config?.header?.title_actions?.tap_action?.action === 'none' &&
        (!this._config?.header?.title_actions?.hold_action?.action ||
          this._config?.header?.title_actions?.hold_action?.action === 'none') &&
        (!this._config?.header?.title_actions?.double_tap_action?.action ||
          this._config?.header?.title_actions?.double_tap_action?.action === 'none'))
        ? 'disabled'
        : 'actions';

    return html`<div
      id="header__title"
      class="${classes}"
      @action=${(ev) => {
        this._handleTitleAction(ev);
      }}
      .actionHandler=${actionHandler({
        hasDoubleClick:
          this._config?.header?.title_actions?.double_tap_action?.action &&
          this._config?.header?.title_actions.double_tap_action.action !== 'none',
        hasHold:
          this._config?.header?.title_actions?.hold_action?.action &&
          this._config?.header?.title_actions?.hold_action.action !== 'none',
      })}
      @focus="${(ev) => {
        this.handleRippleFocus(ev, 'title');
      }}"
      @blur="${(ev) => {
        this.handleRippleBlur(ev, 'title');
      }}"
      @mousedown="${(ev) => {
        this.handleRippleActivate(ev, 'title');
      }}"
      @mouseup="${(ev) => {
        this.handleRippleDeactivate(ev, 'title');
      }}"
      @touchstart="${(ev) => {
        this.handleRippleActivate(ev, 'title');
      }}"
      @touchend="${(ev) => {
        this.handleRippleDeactivate(ev, 'title');
      }}"
      @touchcancel="${(ev) => {
        this.handleRippleDeactivate(ev, 'title');
      }}"
    >
      <span>${this._config?.header?.title}</span>
      <mwc-ripple unbounded id="ripple-title"></mwc-ripple>
    </div>`;
  }

  private _renderStates(): TemplateResult {
    return html`
      <div id="header__states">
        ${this._config?.series.map((serie, index) => {
          if (
            serie.show.in_header &&
            (serie.show.null_in_header || this._headerState?.[index] !== null) &&
            (serie.show.zero_in_header || this._headerState?.[index] !== 0)
          ) {
            return html`
              <div
                id="states__state"
                class="${this._config?.header?.disable_actions ||
                (serie.header_actions?.tap_action?.action === 'none' &&
                  (!serie.header_actions?.hold_action?.action ||
                    serie.header_actions?.hold_action?.action === 'none') &&
                  (!serie.header_actions?.double_tap_action?.action ||
                    serie.header_actions?.double_tap_action?.action === 'none'))
                  ? 'disabled'
                  : 'actions'}"
                @action=${(ev) => {
                  this._handleAction(ev, serie);
                }}
                .actionHandler=${actionHandler({
                  hasDoubleClick:
                    serie.header_actions?.double_tap_action?.action &&
                    serie.header_actions.double_tap_action.action !== 'none',
                  hasHold:
                    serie.header_actions?.hold_action?.action && serie.header_actions?.hold_action.action !== 'none',
                })}
                @focus="${(ev) => {
                  this.handleRippleFocus(ev, index);
                }}"
                @blur="${(ev) => {
                  this.handleRippleBlur(ev, index);
                }}"
                @mousedown="${(ev) => {
                  this.handleRippleActivate(ev, index);
                }}"
                @mouseup="${(ev) => {
                  this.handleRippleDeactivate(ev, index);
                }}"
                @touchstart="${(ev) => {
                  this.handleRippleActivate(ev, index);
                }}"
                @touchend="${(ev) => {
                  this.handleRippleDeactivate(ev, index);
                }}"
                @touchcancel="${(ev) => {
                  this.handleRippleDeactivate(ev, index);
                }}"
              >
                <div id="state__value">
                  <span id="state" style="${this._computeHeaderStateColor(serie, this._headerState?.[index])}"
                    >${this._headerState?.[index] === 0
                      ? 0
                      : serie.show.as_duration
                      ? prettyPrintTime(this._headerState?.[index], serie.show.as_duration)
                      : this._computeLastState(this._headerState?.[index], index) || NO_VALUE}</span
                  >
                  ${!serie.show.as_duration
                    ? html`<span id="uom">${computeUom(index, this._config?.series, this._entities)}</span>`
                    : ''}
                </div>
                ${serie.show.name_in_header
                  ? html`<div id="state__name">${this._headerStateExtra?.[index] || computeName(index, this._config?.series, this._entities)}</div>`
                  : ''}
                <mwc-ripple unbounded id="ripple-${index}"></mwc-ripple>
              </div>
            `;
          } else {
            return html``;
          }
        })}
      </div>
    `;
  }

  private _renderLastUpdated(): TemplateResult {
    if (this._config?.show?.last_updated) {
      return html` <div id="last_updated">${formatApexDate(this._config, this._hass, this._lastUpdated, true)}</div> `;
    }
    return html``;
  }

  private _renderVersion(): TemplateResult {
    if (this._config?.show?.version) {
      return html` <div id="version_info">apexcharts-card v${pjson.version}</div> `;
    }
    return html``;
  }

  private async _initialLoad() {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await this.updateComplete;
    if (isUsingServerTimezone(this._hass)) {
      this._serverTimeOffset = computeTimezoneDiffWithLocal(this._hass?.config.time_zone);
    }
    const graph = this.shadowRoot?.querySelector('#graph');
    const brush = this.shadowRoot?.querySelector('#brush');
    if (!this._apexChart && graph && this._config) {
      this._loaded = true;
      const layout = getLayoutConfig(this._config, this._hass, this._graphs);
      if (this._config.series_in_brush.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (layout as any).chart.id = Math.random().toString(36).substring(7);
      }
      this._apexChart = new ApexCharts(graph, layout);
      const promises: Promise<void>[] = [];
      promises.push(this._apexChart.render());
      if (this._config.series_in_brush.length && brush) {
        this._apexBrush = new ApexCharts(
          brush,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getBrushLayoutConfig(this._config, this._hass, (layout as any).chart.id),
        );
        promises.push(this._apexBrush.render());
      }
      await Promise.all(promises);

      // Initialize viewport persistence
      this._storageKey = this._computeStorageKey();
      
      // Capture the initial default view
      const currentMin = (this._apexChart as any).axes?.w?.globals?.minX;
      const currentMax = (this._apexChart as any).axes?.w?.globals?.maxX;
      if (currentMin !== undefined && currentMax !== undefined) {
        this._defaultView = { min: currentMin, max: currentMax };
      }

      // Load persisted viewport and queue restore
      await this._loadViewState();
      this._queueViewRestore();

      // Attach drag-pan event listeners
      this._attachPointerListeners();

      // Attach double-click reset listener
      this._attachDoubleClickListener();

      this._firstDataLoad();
    }
  }

  private async _updateData() {
    if (!this._config || !this._apexChart || !this._graphs) return;

    const { start, end } = this._getSpanDates();
    const now = new Date();
    this._lastUpdated = now;
    const editMode = getLovelace()?.editMode;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const caching = editMode === true ? false : this._config!.cache;
    try {
      const promise = this._graphs.map((graph, index) => {
        if (graph) graph.cache = caching;
        return graph?._updateHistory(
          this._seriesOffset[index] ? new Date(start.getTime() + this._seriesOffset[index]) : start,
          this._seriesOffset[index] ? new Date(end.getTime() + this._seriesOffset[index]) : end,
        );
      });
      await Promise.all(promise);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let graphData: any = { series: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const brushData: any = { series: [] };
      if (TIMESERIES_TYPES.includes(this._config.chart_type)) {
        this._graphs.forEach((graph, index) => {
          if (!graph) return [];
          const inHeader = this._config?.series[index].show.in_header;
          if (inHeader && inHeader !== 'raw') {
            if (inHeader === 'after_now' || inHeader === 'before_now') {
              // before_now / after_now
              this._headerState[index] = graph.nowValue(
                now.getTime() + (this._seriesOffset[index] ? this._seriesOffset[index] : 0),
                inHeader === 'before_now',
              );
            } else {
              // not raw
              this._headerState[index] = graph.lastState;
            }
            // Extract day/hour if this is a min/max series from data_generator
            const serieName = this._config?.series[index].name?.toLowerCase() || '';
            if (serieName.includes('goedkoopste')) {
              this._headerStateExtra[index] = this._extractDayHourFromForecast(index, 'min');
            } else if (serieName.includes('duurste')) {
              this._headerStateExtra[index] = this._extractDayHourFromForecast(index, 'max');
            } else {
              this._headerStateExtra[index] = '';
            }
          }
          if (!this._config?.series[index].show.in_chart && !this._config?.series[index].show.in_brush) {
            return;
          }
          if (graph.history.length === 0) {
            if (this._config?.series[index].show.in_chart) graphData.series.push({ data: [] });
            if (this._config?.series[index].show.in_brush) brushData.series.push({ data: [] });
            return;
          }
          let data: EntityCachePoints = [];
          const offset =
            this._serverTimeOffset + (this._seriesOffset[index] || 0) - (this._seriesTimeDelta[index] || 0);
          if (offset) {
            data = offsetData(graph.history, offset);
          } else {
            data = [...graph.history];
          }
          if (this._config?.series[index].type !== 'column' && this._config?.series[index].extend_to) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const lastPoint = data.slice(-1)[0]!;
            if (
              this._config?.series[index].extend_to === 'end' &&
              lastPoint[0] < end.getTime() - this._serverTimeOffset
            ) {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              data.push([end.getTime() - this._serverTimeOffset, lastPoint[1]]);
            } else if (
              this._config?.series[index].extend_to === 'now' &&
              lastPoint[0] < now.getTime() - this._serverTimeOffset
            ) {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              data.push([now.getTime() - this._serverTimeOffset, lastPoint[1]]);
            }
          }
          // Apply color thresholds for column charts before inverting
          const processedData = this._applyColorThresholds(data, this._config?.series[index]);
          const result = this._config?.series[index].invert ? { data: this._invertData(processedData as any) } : { data: processedData };
          if (this._config?.series[index].show.in_chart) graphData.series.push(result);
          if (this._config?.series[index].show.in_brush) brushData.series.push(result);
          return;
        });
        graphData.annotations = this._computeAnnotations(start, end, new Date(now.getTime() - this._serverTimeOffset));
        if (this._yAxisConfig) {
          graphData.yaxis = this._computeYAxisAutoMinMax(start, end);
        }
        if (!this._apexBrush) {
          graphData.xaxis = {
            min: start.getTime() - this._serverTimeOffset,
            max: this._findEndOfChart(new Date(end.getTime() - this._serverTimeOffset), false),
          };
        }
      } else {
        // No timeline charts
        graphData = {
          series: this._graphs.flatMap((graph, index) => {
            if (!graph) return [];
            let data = 0;
            if (graph.history.length === 0) {
              if (this._config?.series[index].show.in_header !== 'raw') {
                this._headerState[index] = null;
              }
              data = 0;
            } else {
              const lastState = graph.lastState;
              data = lastState || 0;
              if (this._config?.series[index].show.in_header !== 'raw') {
                this._headerState[index] = lastState;
              }
            }
            if (!this._config?.series[index].show.in_chart) {
              return [];
            }
            if (this._config?.chart_type === 'radialBar') {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              return [getPercentFromValue(data, this._config.series[index].min, this._config.series[index].max)];
            } else {
              return [data];
            }
          }),
        };
      }
      graphData.colors = this._computeChartColors(false);
      if (this._apexBrush) {
        brushData.colors = this._computeChartColors(true);
      }
      if (this._config.experimental?.color_threshold && this._config.series.some((serie) => serie.color_threshold)) {
        graphData.markers = {
          colors: computeColors(
            this._config.series_in_graph.flatMap((serie, index) => {
              if (serie.type === 'column') return [];
              return [this._colors[index]];
            }),
          ),
        };
        // graphData.fill = { colors: graphData.colors };
        graphData.legend = { markers: { fillColors: computeColors(this._colors) } };
        graphData.tooltip = { marker: { fillColors: graphData.legend.markers.fillColors } };
        graphData.fill = {
          gradient: {
            type: 'vertical',
            colorStops: this._config.series_in_graph.map((serie, index) => {
              if (!serie.color_threshold || ![undefined, 'area', 'line'].includes(serie.type)) return [];
              const min = this._graphs?.[serie.index]?.min;
              const max = this._graphs?.[serie.index]?.max;
              if (min === undefined || max === undefined) return [];
              return (
                this._computeFillColorStops(serie, min, max, computeColor(this._colors[index]), serie.invert) || []
              );
            }),
          },
        };
        if (this._apexBrush) {
          brushData.fill = {
            gradient: {
              type: 'vertical',
              colorStops: this._config.series_in_brush.map((serie, index) => {
                if (!serie.color_threshold || ![undefined, 'area', 'line'].includes(serie.type)) return [];
                const min = this._graphs?.[serie.index]?.min;
                const max = this._graphs?.[serie.index]?.max;
                if (min === undefined || max === undefined) return [];
                return (
                  this._computeFillColorStops(serie, min, max, computeColor(this._colors[index]), serie.invert) || []
                );
              }),
            },
          };
        }
      }
      // graphData.tooltip = { marker: { fillColors: ['#ff0000', '#00ff00'] } };
      const brushIsAtEnd =
        this._apexBrush &&
        this._brushInit &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this._apexChart as any).axes?.w?.globals?.maxX === (this._apexBrush as any).axes?.w?.globals?.maxX;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentMin = (this._apexChart as any).axes?.w?.globals?.minX;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentMax = (this._apexChart as any).axes?.w?.globals?.maxX;
      this._headerState = [...this._headerState];
      
      const chartUpdates: Promise<void>[] = [];
      chartUpdates.push(
        this._apexChart?.updateOptions(
          graphData,
          false,
          TIMESERIES_TYPES.includes(this._config.chart_type) ? false : true,
        ),
      );
      if (this._apexBrush) {
        const newMin = start.getTime() - this._serverTimeOffset;
        const newMax = this._findEndOfChart(new Date(end.getTime() - this._serverTimeOffset), false);
        brushData.xaxis = {
          min: newMin,
          max: newMax,
        };
        if (brushIsAtEnd || !this._brushInit) {
          brushData.chart = {
            selection: {
              enabled: true,
              xaxis: {
                min: brushData.xaxis.max - (this._brushSelectionSpan ? this._brushSelectionSpan : this._graphSpan / 4),
                max: brushData.xaxis.max,
              },
            },
          };
        } else {
          brushData.chart = {
            selection: {
              enabled: true,
              xaxis: {
                min: currentMin < newMin ? newMin : currentMin,
                max: currentMin < newMin ? newMin + (currentMax - currentMin) : currentMax,
              },
            },
          };
        }
        const selectionColor = computeColor('var(--primary-text-color)');
        brushData.chart.selection.stroke = { color: selectionColor };
        brushData.chart.selection.fill = { color: selectionColor, opacity: 0.1 };
        this._brushInit = true;
        chartUpdates.push(this._apexBrush?.updateOptions(brushData, false, false));
      }
      await Promise.all(chartUpdates);

      // Restore viewport if persist_view is enabled
      if (this._config.interaction?.persist_view) {
        this._queueViewRestore();
      }
    } catch (err) {
      log(err);
    }
    this._updating = false;
  }

  private _computeAnnotations(start: Date, end: Date, now: Date) {
    return {
      ...this._computeMinMaxPointsAnnotations(start, end),
      ...this._computeNowAnnotation(now),
    };
  }

  private _computeMinMaxPointsAnnotations(start: Date, end: Date) {
    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
    const minMaxPoints = this._config?.series_in_graph.flatMap((serie, index) => {
      if (serie.show.extremas) {
        const { min, max } = this._graphs?.[serie.index]?.minMaxWithTimestamp(
          this._seriesOffset[serie.index]
            ? new Date(start.getTime() + this._seriesOffset[serie.index]).getTime()
            : start.getTime(),
          this._seriesOffset[serie.index]
            ? new Date(end.getTime() + this._seriesOffset[serie.index]).getTime()
            : end.getTime(),
          this._serverTimeOffset - (this._seriesTimeDelta[serie.index] || 0),
        ) || {
          min: [0, null],
          max: [0, null],
        };
        const bgColor = computeColor(this._colors[index]);
        const txtColor = computeTextColor(bgColor);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const extremas: any = [];
        if (min[0] && ['min', 'min+time', true, 'time'].includes(serie.show.extremas)) {
          const withTime = serie.show.extremas === 'time' || serie.show.extremas === 'min+time';
          extremas.push(
            ...this._getPointAnnotationStyle(
              min,
              this._seriesOffset[serie.index],
              bgColor,
              txtColor,
              serie,
              index,
              serie.invert,
              sameDay,
              withTime,
            ),
          );
        }
        if (max[0] && ['max', 'max+time', true, 'time'].includes(serie.show.extremas)) {
          const withTime = serie.show.extremas === 'time' || serie.show.extremas === 'max+time';
          extremas.push(
            ...this._getPointAnnotationStyle(
              max,
              this._seriesOffset[serie.index],
              bgColor,
              txtColor,
              serie,
              index,
              serie.invert,
              sameDay,
              withTime,
            ),
          );
        }
        return extremas;
      } else {
        return [];
      }
    });
    return { points: [...(minMaxPoints || []), ...(this._config?.apex_config?.annotations?.points || [])] };
  }

  private _getPointAnnotationStyle(
    value: HistoryPoint,
    offset: number,
    bgColor: string,
    txtColor: string,
    serie: ChartCardSeriesConfig,
    index: number,
    invert = false,
    sameDay: boolean,
    withTime: boolean,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const points: any = [];
    const multiYAxis =
      this._config?.apex_config?.yaxis &&
      Array.isArray(this._config.apex_config.yaxis) &&
      this._config.apex_config.yaxis.length > 1;
    points.push({
      x: offset ? value[0] - offset : value[0],
      y: invert && value[1] ? -value[1] : value[1],
      seriesIndex: index,
      yAxisIndex: multiYAxis ? index : 0,
      marker: {
        strokeColor: bgColor,
        fillColor: 'var(--card-background-color)',
      },
      label: {
        text: myFormatNumber(value[1], this._hass?.locale, serie.float_precision),
        borderColor: 'var(--card-background-color)',
        borderWidth: 2,
        style: {
          background: bgColor,
          color: txtColor,
        },
      },
    });
    if (withTime) {
      let bgColorTime = tinycolor(computeColor('var(--card-background-color)'));
      bgColorTime =
        bgColorTime.isValid && bgColorTime.getLuminance() > 0.5 ? bgColorTime.darken(20) : bgColorTime.lighten(20);
      const txtColorTime = computeTextColor(bgColorTime.toHexString());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let options: any = { timeStyle: 'medium' };
      if (!sameDay) {
        options.dateStyle = 'medium';
      }
      options = { ...options, ...(is12Hour(this._config, this._hass) ? { hour12: true } : { hourCycle: 'h23' }) };
      const lang = getLang(this._config, this._hass);
      points.push({
        x: offset ? value[0] - offset : value[0],
        y: invert && value[1] ? -value[1] : value[1],
        seriesIndex: index,
        yAxisIndex: multiYAxis ? index : 0,
        marker: {
          size: 0,
        },
        label: {
          text: `${Intl.DateTimeFormat(lang, options).format(value[0])}`,
          borderColor: 'var(--card-background-color)',
          offsetY: -22,
          borderWidth: 0,
          style: {
            background: bgColorTime.toHexString(),
            color: txtColorTime,
            fontSize: '8px',
            fontWeight: 200,
          },
        },
      });
    }
    return points;
  }

  private _computeNowAnnotation(now: Date) {
    if (this._config?.now?.show) {
      const color = computeColor(this._config.now.color || 'var(--primary-color)');
      const textColor = computeTextColor(color);
      return {
        xaxis: [
          {
            x: now.getTime(),
            strokeDashArray: 3,
            label: {
              text: this._config.now.label,
              borderColor: color,
              style: {
                color: textColor,
                background: color,
              },
            },
            borderColor: color,
          },
          ...(this._config?.apex_config?.annotations?.xaxis || []),
        ],
      };
    }
    return {};
  }

  private _computeYAxisAutoMinMax(start: Date, end: Date) {
    if (!this._config) return;
    this._yAxisConfig?.map((yaxis) => {
      if (yaxis.min_type !== minmax_type.FIXED || yaxis.max_type !== minmax_type.FIXED) {
        const minMax = yaxis.series_id?.map((id) => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const lMinMax = this._graphs![id]?.minMaxWithTimestampForYAxis(
            this._seriesOffset[id] ? new Date(start.getTime() + this._seriesOffset[id]).getTime() : start.getTime(),
            this._seriesOffset[id] ? new Date(end.getTime() + this._seriesOffset[id]).getTime() : end.getTime(),
          );
          if (!lMinMax) return undefined;
          if (this._config?.series[id].invert) {
            const cmin = lMinMax.min[1];
            const cmax = lMinMax.max[1];
            if (cmin !== null) {
              lMinMax.max[1] = -cmin;
            }
            if (cmax !== null) {
              lMinMax.min[1] = -cmax;
            }
          }
          return lMinMax;
        });
        let min: number | null = null;
        let max: number | null = null;
        minMax?.forEach((elt) => {
          if (!elt) return;
          if (min === undefined || min === null) {
            min = elt.min[1];
          } else if (elt.min[1] !== null && min > elt.min[1]) {
            min = elt.min[1];
          }
          if (max === undefined || max === null) {
            max = elt.max[1];
          } else if (elt.max[1] !== null && max < elt.max[1]) {
            max = elt.max[1];
          }
        });

        // Apply optional padding below the computed minimum to avoid touching the baseline
        if (
          typeof yaxis.min_padding === 'number' &&
          yaxis.min_padding > 0 &&
          min !== null &&
          yaxis.min_type !== minmax_type.FIXED
        ) {
          min = (min as number) - yaxis.min_padding;
        }

        if (yaxis.align_to !== undefined) {
          if (min !== null && yaxis.min_type !== minmax_type.FIXED) {
            if (min % yaxis.align_to !== 0) {
              min = min >= 0 ? min - (min % yaxis.align_to) : -(yaxis.align_to + (min % yaxis.align_to) - min);
            }
          }
          if (max !== null && yaxis.max_type !== minmax_type.FIXED) {
            if (max % yaxis.align_to !== 0) {
              max = max >= 0 ? yaxis.align_to - (max % yaxis.align_to) + max : (max % yaxis.align_to) - max;
            }
          }
        }
        yaxis.series_id?.forEach((id) => {
          if (min !== null && yaxis.min_type !== minmax_type.FIXED) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this._config!.apex_config!.yaxis![id].min = this._getMinMaxBasedOnType(
              true,
              min,
              yaxis.min as number,
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              yaxis.min_type!,
            );
          }
          if (max !== null && yaxis.max_type !== minmax_type.FIXED) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this._config!.apex_config!.yaxis![id].max = this._getMinMaxBasedOnType(
              false,
              max,
              yaxis.max as number,
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              yaxis.max_type!,
            );
          }
        });
      }
    });
    return this._config?.apex_config?.yaxis;
  }

  private _getMinMaxBasedOnType(isMin: boolean, value: number, configMinMax: number, type: minmax_type): number {
    switch (type) {
      case minmax_type.AUTO:
        return value;
      case minmax_type.SOFT:
        if ((isMin && value > configMinMax) || (!isMin && value < configMinMax)) {
          return configMinMax;
        } else {
          return value;
        }
      case minmax_type.ABSOLUTE:
        return value + configMinMax;
      default:
        return value;
    }
  }

  private _getTypeOfMinMax(value?: 'auto' | number | string): [number | undefined, minmax_type] {
    const regexFloat = /[+-]?\d+(\.\d+)?/g;
    if (typeof value === 'number') {
      return [value, minmax_type.FIXED];
    } else if (value === undefined || value === 'auto') {
      return [undefined, minmax_type.AUTO];
    }
    if (typeof value === 'string' && value !== 'auto') {
      const matched = value.match(regexFloat);
      if (!matched || matched.length !== 1) {
        throw new Error(`Bad yaxis min/max format: ${value}`);
      }
      const floatValue = parseFloat(matched[0]);
      if (value.startsWith('~')) {
        return [floatValue, minmax_type.SOFT];
      } else if (value.startsWith('|') && value.endsWith('|')) {
        return [floatValue, minmax_type.ABSOLUTE];
      }
    }
    throw new Error(`Bad yaxis min/max format: ${value}`);
  }

  private _computeChartColors(brush: boolean): (string | (({ value }) => string))[] {
    const defaultColors: (string | (({ value }) => string))[] = computeColors(brush ? this._brushColors : this._colors);
    const series = brush ? this._config?.series_in_brush : this._config?.series_in_graph;
    series?.forEach((serie, index) => {
      if (
        this._config?.experimental?.color_threshold &&
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        (PLAIN_COLOR_TYPES.includes(this._config!.chart_type!) || serie.type === 'column') &&
        serie.color_threshold &&
        serie.color_threshold.length > 0
      ) {
        const colors = this._colors;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        defaultColors[index] = function ({ value }, sortedL = serie.color_threshold!, defColor = colors[index]) {
          let returnValue = sortedL[0].color || defColor;
          sortedL.forEach((color) => {
            if (value > color.value) returnValue = color.color || defColor;
          });
          return computeColor(returnValue);
        };
      }
    });
    return defaultColors.slice(0, this._config?.series_in_graph.length);
  }

  private _computeFillColorStops(
    serie: ChartCardSeriesConfig,
    min: number,
    max: number,
    defColor: string,
    invert = false,
  ): { offset: number; color: string; opacity?: number }[] | undefined {
    if (!serie.color_threshold) return undefined;
    const scale = max - min;

    const result = serie.color_threshold.flatMap((thres, index, arr) => {
      if (
        (thres.value > max && arr[index - 1] && arr[index - 1].value > max) ||
        (thres.value < min && arr[index + 1] && arr[index + 1].value < min)
      ) {
        return [];
      }
      let color: string | undefined = undefined;
      const defaultOp = serie.opacity !== undefined ? serie.opacity : serie.type === 'area' ? DEFAULT_AREA_OPACITY : 1;
      let opacity = thres.opacity === undefined ? defaultOp : thres.opacity;
      if (thres.value > max && arr[index - 1]) {
        const factor = (max - arr[index - 1].value) / (thres.value - arr[index - 1].value);
        color = interpolateColor(
          tinycolor(arr[index - 1].color || defColor).toHexString(),
          tinycolor(thres.color || defColor).toHexString(),
          factor,
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const prevOp = arr[index - 1].opacity === undefined ? defaultOp : arr[index - 1].opacity!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const curOp = thres.opacity === undefined ? defaultOp : thres.opacity!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (prevOp > curOp) {
          opacity = (prevOp - curOp) * (1 - factor) + curOp;
        } else {
          opacity = (curOp - prevOp) * factor + prevOp;
        }
        opacity = opacity < 0 ? -opacity : opacity;
      } else if (thres.value < min && arr[index + 1]) {
        const factor = (arr[index + 1].value - min) / (arr[index + 1].value - thres.value);
        color = interpolateColor(
          tinycolor(arr[index + 1].color || defColor).toHexString(),
          tinycolor(thres.color || defColor).toHexString(),
          factor,
        );
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const nextOp = arr[index + 1].opacity === undefined ? defaultOp : arr[index + 1].opacity!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const curOp = thres.opacity === undefined ? defaultOp : thres.opacity!;
        if (nextOp > curOp) {
          opacity = (nextOp - curOp) * (1 - factor) + curOp;
        } else {
          opacity = (curOp - nextOp) * factor + nextOp;
        }
        opacity = opacity < 0 ? -opacity : opacity;
      }
      color = color || tinycolor(thres.color || defColor).toHexString();
      if ([undefined, 'line'].includes(serie.type)) color = tinycolor(color).setAlpha(opacity).toHex8String();
      return [
        {
          color: color || tinycolor(thres.color || defColor).toHexString(),
          offset:
            scale <= 0 ? 0 : invert ? 100 - (max - thres.value) * (100 / scale) : (max - thres.value) * (100 / scale),
          opacity,
        },
      ];
    });
    return invert ? result : result.reverse();
  }

  private _computeHeaderStateColor(serie: ChartCardSeriesConfig, value: number | null): string {
    let color = '';
    
    // Explicit per-series header color wins if provided
    if (serie.show?.header_color) {
      return `color: ${serie.show.header_color};`;
    }

    // Check if this is a max series (green for lowest removed, keep orange for highest)
    const serieName = serie.name?.toLowerCase() || '';
    if (serieName.includes('duurste') && value === this._maxPrice) {
      return 'color: #ed5e18;'; // Orange for highest price
    }
    
    if (this._config?.header?.colorize_states) {
      if (
        this._config.experimental?.color_threshold &&
        serie.show.header_color_threshold &&
        serie.color_threshold &&
        serie.color_threshold.length > 0 &&
        value !== null
      ) {
        const index = serie.color_threshold.findIndex((thres) => {
          return thres.value > value;
        });
        if (index < 0) {
          color = computeColor(
            serie.color_threshold[serie.color_threshold.length - 1].color || this._headerColors[serie.index],
          );
        } else if (index === 0) {
          color = computeColor(serie.color_threshold[0].color || this._headerColors[serie.index]);
        } else {
          const prev = serie.color_threshold[index - 1];
          const next = serie.color_threshold[index];
          if (serie.type === 'column') {
            color = computeColor(prev.color || this._headerColors[serie.index]);
          } else {
            const factor = (value - prev.value) / (next.value - prev.value);
            color = interpolateColor(
              computeColor(prev.color || this._headerColors[serie.index]),
              computeColor(next.color || this._headerColors[serie.index]),
              factor,
            );
          }
        }
      } else {
        return this._headerColors && this._headerColors.length > 0 ? `color: ${this._headerColors[serie.index]};` : '';
      }
    }
    return color ? `color: ${color};` : '';
  }

  private _computeLastState(value: number | null, index: number): string | number | null {
    if (value === null) return value;
    return myFormatNumber(value, this._hass?.locale, this._config?.series[index].float_precision);
  }

  private _extractDayHourFromForecast(index: number, minOrMax: 'min' | 'max'): string {
    const serie = this._config?.series[index];
    if (!serie) return '';
    
    // Get the entity to read forecast data
    const entityId = serie.entity;
    if (!entityId || !this._hass?.states[entityId]) return '';
    
    const entity = this._hass.states[entityId];
    const forecast = entity.attributes?.forecast;
    if (!forecast || !Array.isArray(forecast) || forecast.length === 0) return '';
    
    const now = Date.now();
    const days = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];
    
    // Filter to only future forecast items
    const futureItems = forecast.filter((item: any) => {
      const itemTime = new Date(item.datetime).getTime();
      return itemTime >= now;
    });
    
    if (futureItems.length === 0) return '';
    
    // Find min/max from future forecast only
    let targetItem: any = futureItems[0];
    if (minOrMax === 'min') {
      futureItems.forEach((item: any) => {
        const itemPrice = item.electricity_price || 0;
        const targetPrice = targetItem.electricity_price || 0;
        if (itemPrice < targetPrice) {
          targetItem = item;
        }
      });
      // Store minimum price (convert to cents/kWh like data_generator does)
      if (targetItem?.electricity_price) {
        const minPrice = (targetItem.electricity_price / 10000000) * 100;
        this._headerState[index] = minPrice; // Update the displayed value to match
      }
    } else {
      futureItems.forEach((item: any) => {
        const itemPrice = item.electricity_price || 0;
        const targetPrice = targetItem.electricity_price || 0;
        if (itemPrice > targetPrice) {
          targetItem = item;
        }
      });
      // Store maximum price (convert to cents/kWh like data_generator does)
      if (targetItem?.electricity_price) {
        const maxPrice = (targetItem.electricity_price / 10000000) * 100;
        this._maxPrice = maxPrice;
        this._headerState[index] = maxPrice; // Update the displayed value to match
      }
    }
    
    if (!targetItem?.datetime) return '';
    const date = new Date(targetItem.datetime);
    const day = days[date.getDay()];
    const hour = String(date.getHours()).padStart(2, '0');
    return `${day} ${hour}:00`;
  }

  /*
    Makes the chart end at the last timestamp of the data when everything displayed is a
    column and group_by is enabled for every serie
  */
  private _findEndOfChart(end: Date, brush: boolean): number {
    const localEnd = new Date(end);
    let offsetEnd: number | undefined = 0;
    const series = brush ? this._config?.series_in_brush : this._config?.series_in_graph;
    const onlyGroupBy = series?.reduce((acc, serie) => {
      return acc && serie.group_by.func !== 'raw';
    }, series?.length > 0);
    if (onlyGroupBy) {
      offsetEnd = series?.reduce((acc, serie) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const dur = parse(serie.group_by.duration)!;
        if (acc === -1 || dur < acc) {
          return dur;
        }
        return acc;
      }, -1);
    }
    return new Date(localEnd.getTime() - (offsetEnd ? offsetEnd : 0)).getTime();
  }

  private _invertData(data: EntityCachePoints): EntityCachePoints {
    return data.map((item) => {
      if (item[1] === null) return item;
      return [item[0], -item[1]];
    });
  }

  private _getSpanDates(): { start: Date; end: Date } {
    let end = new Date();
    let start = new Date(end.getTime() - this._graphSpan + 1);
    const curMoment = moment();
    if ((this._hass?.locale as OverrideFrontendLocaleData).time_zone === 'server') {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      curMoment.tz(this._hass!.config.time_zone);
    }
    if (this._config?.span?.start) {
      // Just Span
      const startM = curMoment.startOf(this._config.span.start);
      start = startM.toDate();
      end = new Date(start.getTime() + this._graphSpan);
    } else if (this._config?.span?.end) {
      const endM = curMoment.endOf(this._config.span.end);
      end = new Date(endM.toDate().getTime() + 1);
      start = new Date(end.getTime() - this._graphSpan + 1);
    }
    if (this._offset) {
      end.setTime(end.getTime() + this._offset);
      start.setTime(start.getTime() + this._offset);
    }
    return { start, end };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _handleAction(ev: any, serieConfig: ChartCardSeriesConfig) {
    if (ev.detail?.action) {
      const configDup: ActionsConfig = serieConfig.header_actions
        ? JSON.parse(JSON.stringify(serieConfig.header_actions))
        : {};

      switch (ev.detail.action) {
        case 'tap':
        case 'hold':
        case 'double_tap':
          configDup.entity = configDup[`${ev.detail.action}_action`]?.entity || serieConfig.entity;
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          handleAction(this, this._hass!, configDup, ev.detail.action);
          break;
        default:
          break;
      }
    }
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _handleTitleAction(ev: any) {
    if (ev.detail?.action) {
      const configDup: ActionsConfig = this._config?.header?.title_actions
        ? JSON.parse(JSON.stringify(this._config?.header?.title_actions))
        : {};

      switch (ev.detail.action) {
        case 'tap':
        case 'hold':
        case 'double_tap':
          configDup.entity = configDup[`${ev.detail.action}_action`]?.entity;
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          handleAction(this, this._hass!, configDup, ev.detail.action);
          break;
        default:
          break;
      }
    }
    return;
  }

  // backward compatibility
  @eventOptions({ passive: true })
  private handleRippleActivate(evt: Event, index: number | string): void {
    const r = this.shadowRoot?.getElementById(`ripple-${index}`) as Ripple;
    r && typeof r.startFocus === 'function' && r.startPress(evt);
  }

  private handleRippleDeactivate(_, index: number | string): void {
    const r = this.shadowRoot?.getElementById(`ripple-${index}`) as Ripple;
    r && typeof r.startFocus === 'function' && r.endPress();
  }

  private handleRippleFocus(_, index: number | string): void {
    const r = this.shadowRoot?.getElementById(`ripple-${index}`) as Ripple;
    r && typeof r.startFocus === 'function' && r.startFocus();
  }

  private handleRippleBlur(_, index: number | string): void {
    const r = this.shadowRoot?.getElementById(`ripple-${index}`) as Ripple;
    r && typeof r.startFocus === 'function' && r.endFocus();
  }

  public getCardSize(): number {
    return 3;
  }

  public getGridOptions() {
    if (!this._config?.section_mode) {
      return {};
    }
    return {
      rows: 6,
      columns: 12,
      min_rows: 2,
      min_columns: 6,
    };
  }

  static getStubConfig(hass: HomeAssistant, entities: string[], entitiesFallback: string[]) {
    const entityFilter = (stateObj: HassEntity): boolean => {
      return !isNaN(Number(stateObj.state));
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _arrayFilter = (array: any[], conditions: Array<(value: any) => boolean>, maxSize: number) => {
      if (!maxSize || maxSize > array.length) {
        maxSize = array.length;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filteredArray: any[] = [];

      for (let i = 0; i < array.length && filteredArray.length < maxSize; i++) {
        let meetsConditions = true;

        for (const condition of conditions) {
          if (!condition(array[i])) {
            meetsConditions = false;
            break;
          }
        }

        if (meetsConditions) {
          filteredArray.push(array[i]);
        }
      }

      return filteredArray;
    };
    const _findEntities = (
      hass: HomeAssistant,
      maxEntities: number,
      entities: string[],
      entitiesFallback: string[],
      includeDomains?: string[],
      entityFilter?: (stateObj: HassEntity) => boolean,
    ) => {
      const conditions: Array<(value: string) => boolean> = [];

      if (includeDomains?.length) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        conditions.push((eid) => includeDomains!.includes(eid.split('.')[0]));
      }

      if (entityFilter) {
        conditions.push((eid) => hass.states[eid] && entityFilter(hass.states[eid]));
      }

      const entityIds = _arrayFilter(entities, conditions, maxEntities);

      if (entityIds.length < maxEntities && entitiesFallback.length) {
        const fallbackEntityIds = _findEntities(
          hass,
          maxEntities - entityIds.length,
          entitiesFallback,
          [],
          includeDomains,
          entityFilter,
        );

        entityIds.push(...fallbackEntityIds);
      }

      return entityIds;
    };
    const includeDomains = ['sensor'];
    const maxEntities = 2;

    const foundEntities = _findEntities(hass, maxEntities, entities, entitiesFallback, includeDomains, entityFilter);
    const conf = {
      header: { show: true, title: 'ApexCharts-Card', show_states: true, colorize_states: true },
      series: [] as ChartCardSeriesExternalConfig[],
    };
    if (foundEntities[0]) {
      conf.series[0] = {
        entity: foundEntities[0],
        data_generator: `// REMOVE ME
const now = new Date();
const data = [];
for(let i = 0; i <= 24; i++) {
  data.push([now.getTime() - i * 1000 * 60 * 60, Math.floor((Math.random() * 10) + 1)])
}
return data.reverse();
`,
      };
    }
    if (foundEntities[1]) {
      conf.series[1] = {
        entity: foundEntities[1],
        type: 'column',
        data_generator: `// REMOVE ME
const now = new Date();
const data = [];
for(let i = 0; i <= 24; i++) {
  data.push([now.getTime() - i * 1000 * 60 * 60, Math.floor((Math.random() * 10) + 1)])
}
return data.reverse();
`,
      };
    }
    return conf;
  }
}

// Configure the preview in the Lovelace card picker
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).customCards = (window as any).customCards || [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).customCards.push({
  type: 'apexcharts-card',
  name: 'ApexCharts Card',
  preview: true,
  description: 'A graph card based on ApexCharts',
});
