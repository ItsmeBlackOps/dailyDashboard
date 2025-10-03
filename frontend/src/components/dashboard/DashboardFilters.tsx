import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { endOfDay, format, startOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  clampWeekIndex,
  computeDayRange,
  computeMonthRange,
  computeWeekRange,
  DEFAULT_TIMEZONE,
  generateWeekOptions,
} from "@/utils/dateRanges";
import { Switch } from "@/components/ui/switch";

export type DashboardRange = "day" | "week" | "month" | "custom";
export type DashboardDateField = "Date of Interview" | "receivedDateTime";

export interface DashboardFilterState {
  range: DashboardRange;
  dateField: DashboardDateField;
  start?: string;
  end?: string;
  dayDate?: string;
  weekYear?: number;
  weekMonth?: number;
  weekIndex?: number;
  monthYear?: number;
  monthMonth?: number;
  upcoming?: boolean;
}

interface DashboardFiltersProps {
  filters: DashboardFilterState;
  onChange: (next: DashboardFilterState) => void;
  allowReceivedDate?: boolean;
}

const RANGE_OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "custom", label: "Custom" },
];

const MONTH_ITEMS = Array.from({ length: 12 }, (_, month) => ({
  value: month,
  label: format(new Date(2024, month, 1), "LLLL"),
}));

export function DashboardFilters({ filters, onChange, allowReceivedDate = false }: DashboardFiltersProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [dayPickerOpen, setDayPickerOpen] = useState(false);

  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const yearOptions = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => currentYear - 3 + index);
  }, [currentYear]);

  const dateFieldOptions = useMemo(() => {
    const base: { value: DashboardDateField; label: string }[] = [
      { value: "Date of Interview", label: "Date of Interview" },
    ];

    if (allowReceivedDate) {
      base.push({ value: "receivedDateTime", label: "Received Date Time" });
    }

    return base;
  }, [allowReceivedDate]);

  const weekYear = filters.weekYear ?? currentYear;
  const weekMonth = filters.weekMonth ?? currentMonth;
  const weekOptions = useMemo(
    () => generateWeekOptions(weekYear, weekMonth, DEFAULT_TIMEZONE),
    [weekYear, weekMonth]
  );
  const resolvedWeekIndex = clampWeekIndex(
    filters.weekIndex ?? (weekOptions[0]?.index ?? 1),
    weekOptions
  );
  const selectedWeek = weekOptions.find((option) => option.index === resolvedWeekIndex) ?? null;

  const monthYear = filters.monthYear ?? currentYear;
  const monthValue = filters.monthMonth ?? currentMonth;

  const formattedDayLabel = filters.dayDate
    ? format(new Date(filters.dayDate), "LLL dd, y")
    : "Select a day";

  const formattedMonthLabel = format(new Date(monthYear, monthValue, 1), "LLLL yyyy");

  useEffect(() => {
    if (filters.range !== "custom") {
      setCustomRange(undefined);
      return;
    }

    const from = filters.start ? new Date(filters.start) : undefined;
    const to = filters.end ? new Date(filters.end) : undefined;

    if (from && to) {
      setCustomRange({ from, to });
    } else {
      setCustomRange(undefined);
    }
  }, [filters.range, filters.start, filters.end]);

  const applyDayValue = (date: Date) => {
    const { startIso, endIso, dayIso } = computeDayRange(date, DEFAULT_TIMEZONE);
    onChange({
      ...filters,
      range: "day",
      dayDate: dayIso,
      start: startIso,
      end: endIso,
    });
  };

  const applyWeekValues = (partial?: Partial<{ weekYear: number; weekMonth: number; weekIndex: number }>) => {
    const targetYear = partial?.weekYear ?? filters.weekYear ?? currentYear;
    const targetMonth = partial?.weekMonth ?? filters.weekMonth ?? currentMonth;
    const options = generateWeekOptions(targetYear, targetMonth, DEFAULT_TIMEZONE);

    if (options.length === 0) {
      const fallback = computeWeekRange(targetYear, targetMonth, 1, DEFAULT_TIMEZONE);
      onChange({
        ...filters,
        range: "week",
        weekYear: targetYear,
        weekMonth: targetMonth,
        weekIndex: 1,
        start: fallback.startIso,
        end: fallback.endIso,
      });
      return;
    }

    const index = clampWeekIndex(partial?.weekIndex ?? filters.weekIndex ?? options[0].index, options);
    const selected = options.find((option) => option.index === index) ?? options[0];

    onChange({
      ...filters,
      range: "week",
      weekYear: targetYear,
      weekMonth: targetMonth,
      weekIndex: selected.index,
      start: selected.startIso,
      end: selected.endIso,
    });
  };

  const applyMonthValues = (partial?: Partial<{ monthYear: number; monthMonth: number }>) => {
    const targetYear = partial?.monthYear ?? filters.monthYear ?? currentYear;
    const targetMonth = partial?.monthMonth ?? filters.monthMonth ?? currentMonth;
    const { startIso, endIso } = computeMonthRange(targetYear, targetMonth, DEFAULT_TIMEZONE);

    onChange({
      ...filters,
      range: "month",
      monthYear: targetYear,
      monthMonth: targetMonth,
      start: startIso,
      end: endIso,
    });
  };

  const handleRangeChange = (value: DashboardRange) => {
    if (value === filters.range) {
      return;
    }

    switch (value) {
      case "day": {
        const base = filters.dayDate ? new Date(filters.dayDate) : new Date();
        applyDayValue(base);
        break;
      }
      case "week": {
        applyWeekValues();
        break;
      }
      case "month": {
        applyMonthValues();
        break;
      }
      case "custom":
      default:
        onChange({ ...filters, range: value });
        break;
    }
  };

  const handleUpcomingToggle = (checked: boolean) => {
    onChange({ ...filters, upcoming: checked });
  };

  const handleDateFieldChange = (value: DashboardDateField) => {
    const resolved = allowReceivedDate ? value : "Date of Interview";
    if (resolved === filters.dateField) return;
    onChange({ ...filters, dateField: resolved });
  };

  const applyCustomRange = (range: DateRange | undefined) => {
    setCustomRange(range);
    if (!range?.from || !range?.to) {
      onChange({ ...filters, range: "custom", start: undefined, end: undefined });
      return;
    }

    const startIso = startOfDay(range.from).toISOString();
    const endIso = endOfDay(range.to).toISOString();
    onChange({ ...filters, range: "custom", start: startIso, end: endIso });
  };

  const clearCustomRange = () => {
    setCustomRange(undefined);
    onChange({ ...filters, range: "custom", start: undefined, end: undefined });
  };

  const formattedCustomRange = useMemo(() => {
    if (!customRange?.from || !customRange?.to) {
      return "Select date range";
    }
    const fromLabel = format(customRange.from, "LLL dd, y");
    const toLabel = format(customRange.to, "LLL dd, y");
    return `${fromLabel} → ${toLabel}`;
  }, [customRange]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Dashboard Filters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-end">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Time Range</p>
            <Tabs value={filters.range} onValueChange={(value) => handleRangeChange(value as DashboardRange)}>
              <TabsList className="grid grid-cols-2 md:grid-cols-4">
                {RANGE_OPTIONS.map((option) => (
                  <TabsTrigger key={option.value} value={option.value}>
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Date Field</p>
            <Select value={filters.dateField} onValueChange={(value) => handleDateFieldChange(value as DashboardDateField)}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Select date field" />
              </SelectTrigger>
              <SelectContent>
                {dateFieldOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Upcoming Only</p>
            <div className="flex items-center gap-3">
              <Switch id="dashboard-upcoming" checked={Boolean(filters.upcoming)} onCheckedChange={handleUpcomingToggle} />
              <label htmlFor="dashboard-upcoming" className="text-sm text-muted-foreground select-none">Only tasks after today</label>
            </div>
          </div>
          {/* </div> */}

          {filters.range === "day" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Select Day</p>
              <Popover open={dayPickerOpen} onOpenChange={setDayPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-left font-normal w-full md:w-[260px]",
                      !filters.dayDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formattedDayLabel}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={filters.dayDate ? new Date(filters.dayDate) : undefined}
                    onSelect={(date) => {
                      if (date) {
                        applyDayValue(date);
                        setDayPickerOpen(false);
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {filters.range === "week" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Select Week</p>
              <div className="flex flex-wrap gap-2">
                <Select
                  value={String(weekYear)}
                  onValueChange={(value) => applyWeekValues({ weekYear: Number.parseInt(value, 10) })}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={String(weekMonth)}
                  onValueChange={(value) => applyWeekValues({ weekMonth: Number.parseInt(value, 10) })}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_ITEMS.map((month) => (
                      <SelectItem key={month.value} value={String(month.value)}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={String(resolvedWeekIndex)}
                  onValueChange={(value) => applyWeekValues({ weekIndex: Number.parseInt(value, 10) })}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Choose week" />
                  </SelectTrigger>
                  <SelectContent>
                    {weekOptions.map((option) => (
                      <SelectItem key={option.index} value={String(option.index)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">{selectedWeek ? selectedWeek.label : "No weeks available for the selected month"}</p>
            </div>
          )}

          {filters.range === "month" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Select Month</p>
              <div className="flex flex-wrap gap-2">
                <Select
                  value={String(monthYear)}
                  onValueChange={(value) => applyMonthValues({ monthYear: Number.parseInt(value, 10) })}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={String(monthValue)}
                  onValueChange={(value) => applyMonthValues({ monthMonth: Number.parseInt(value, 10) })}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_ITEMS.map((month) => (
                      <SelectItem key={month.value} value={String(month.value)}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">{formattedMonthLabel}</p>
            </div>
          )}

          {filters.range === "custom" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Custom Range</p>
              <div className="flex items-center gap-2">
                <Popover open={customOpen} onOpenChange={setCustomOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "justify-start text-left font-normal w-full md:w-[260px]",
                        !customRange?.from && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formattedCustomRange}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="range"
                      numberOfMonths={2}
                      selected={customRange}
                      onSelect={(range) => applyCustomRange(range)}
                      defaultMonth={customRange?.from}
                    />
                  </PopoverContent>
                </Popover>
                <Button variant="ghost" size="icon" onClick={clearCustomRange} aria-label="Clear custom range">
                  <RefreshCcw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}</div>
      </CardContent>
    </Card>
  );
}
