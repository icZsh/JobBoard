"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";

export type RunDateOption = {
  id: string;
  label: string;
};

function buildTodayHref(runId: string, includeHidden: boolean) {
  const params = new URLSearchParams({ runId });

  if (includeHidden) {
    params.set("includeHidden", "1");
  }

  return `/today?${params.toString()}`;
}

export function RunDateSelect({
  options,
  selectedRunId,
  includeHidden,
}: {
  options: RunDateOption[];
  selectedRunId: string;
  includeHidden: boolean;
}) {
  const router = useRouter();

  if (options.length === 0) {
    return null;
  }

  return (
    <label className="paper-date-select">
      <span className="sr-only">Review date</span>
      <CalendarDays className="paper-date-select-icon" aria-hidden="true" />
      <select
        aria-label="Review date"
        onChange={(event) => {
          router.push(buildTodayHref(event.target.value, includeHidden));
        }}
        value={selectedRunId}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="paper-date-select-caret" aria-hidden="true" />
    </label>
  );
}
