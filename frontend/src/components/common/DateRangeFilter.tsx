import moment from "moment-timezone";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

/**
 * Shared date-range filter.
 *
 * The business runs on US Eastern time, but the backend stores candidate dates
 * as UTC instants and filters with `{ [dateField]: { $gte: dateFrom, $lt: dateTo } }`.
 * So the contract is: the UI reasons about *Eastern* calendar boundaries
 * (start-of-day, start-of-week, start-of-month, …) and emits the **UTC instants**
 * of those Eastern boundaries as ISO strings. `resolveDateRange` is the single
 * place that translation happens.
 */

export const DATE_RANGE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "last30", label: "Last 30 days" },
  { value: "custom", label: "Custom" },
  { value: "all", label: "All" },
] as const;

export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number]["value"];

export interface DateRangeValue {
  /** One of the preset keys (defaults to "all"). */
  preset: string;
  /** `YYYY-MM-DD` (from a native date input) — only meaningful when preset === "custom". */
  from?: string;
  /** `YYYY-MM-DD` — only meaningful when preset === "custom". */
  to?: string;
}

export interface ResolvedDateRange {
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Translate a preset (and, for `custom`, the explicit from/to dates carried on
 * the value object) into UTC ISO boundaries of an Eastern-time range.
 *
 * - `today`   Eastern start-of-day → next day (24h on non-DST days).
 * - `week`    Eastern start-of-week → +1 week.
 * - `month`   Eastern start-of-month → +1 month.
 * - `last30`  (now − 30d) Eastern start-of-day → Eastern end-of-day of now.
 * - `custom`  Eastern start-of-day of `from` → start-of-next-day of `to`
 *             (i.e. `to` is inclusive). Missing bounds are simply omitted.
 * - `all`     → `{}` (no filter).
 *
 * Unknown presets fall through to `{}` so the caller never accidentally filters.
 */
export function resolveDateRange(
  preset: string,
  tz: string = "America/New_York",
  custom?: { from?: string; to?: string }
): ResolvedDateRange {
  const now = moment.tz(tz);

  switch (preset) {
    case "today": {
      const start = now.clone().startOf("day");
      const end = start.clone().add(1, "day");
      return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
    }
    case "week": {
      const start = now.clone().startOf("week");
      const end = start.clone().add(1, "week");
      return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
    }
    case "month": {
      const start = now.clone().startOf("month");
      const end = start.clone().add(1, "month");
      return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
    }
    case "last30": {
      const start = now.clone().subtract(30, "days").startOf("day");
      const end = now.clone().endOf("day");
      return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
    }
    case "custom": {
      const out: ResolvedDateRange = {};
      if (custom?.from) {
        // Parse the YYYY-MM-DD as an Eastern wall-clock day, not UTC.
        const from = moment.tz(custom.from, "YYYY-MM-DD", tz).startOf("day");
        if (from.isValid()) out.dateFrom = from.toISOString();
      }
      if (custom?.to) {
        // `to` is inclusive → upper bound is the start of the following day.
        const to = moment
          .tz(custom.to, "YYYY-MM-DD", tz)
          .startOf("day")
          .add(1, "day");
        if (to.isValid()) out.dateTo = to.toISOString();
      }
      return out;
    }
    case "all":
    default:
      return {};
  }
}

export interface DateRangeFilterProps {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  /** Optional className for the outer wrapper (lets callers control layout). */
  className?: string;
  /** aria-label for the preset trigger; defaults to a generic label. */
  ariaLabel?: string;
}

/**
 * Preset `<Select>` plus, when `custom` is chosen, two native date inputs.
 * Purely controlled — the parent owns the `{ preset, from, to }` value and is
 * responsible for calling `resolveDateRange` to turn it into emit args.
 */
export function DateRangeFilter({
  value,
  onChange,
  className,
  ariaLabel = "Filter by date range",
}: DateRangeFilterProps) {
  const isCustom = value.preset === "custom";

  return (
    <div className={className ?? "flex items-center gap-2"}>
      <Select
        value={value.preset || "all"}
        onValueChange={(preset) => onChange({ ...value, preset })}
      >
        <SelectTrigger className="w-[150px] h-9" aria-label={ariaLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_RANGE_PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isCustom && (
        <>
          <Input
            type="date"
            className="w-[150px] h-9"
            aria-label="From date"
            value={value.from ?? ""}
            max={value.to || undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <span className="text-sm text-muted-foreground">–</span>
          <Input
            type="date"
            className="w-[150px] h-9"
            aria-label="To date"
            value={value.to ?? ""}
            min={value.from || undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </>
      )}
    </div>
  );
}

export default DateRangeFilter;
