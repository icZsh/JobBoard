"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { SelfHostConfig } from "@/lib/selfhost/config";

function lines(value: FormDataEntryValue | null) {
  return [
    ...new Set(
      String(value ?? "")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

export function ConfigForm({
  initial,
  setup = false,
}: {
  initial: SelfHostConfig;
  setup?: boolean;
}) {
  const router = useRouter();
  const timezoneInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (setup && timezoneInput.current)
      timezoneInput.current.value =
        Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, [setup]);
  const [sources, setSources] = useState(
    initial.collector.sources.map((source) => ({
      company: source.company,
      enabled: source.enabled,
      atsUrl: `https://${source.provider === "ashby" ? "jobs.ashbyhq.com" : source.provider === "greenhouse" ? "job-boards.greenhouse.io" : "jobs.lever.co"}/${source.board}`,
    })),
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const preferences = initial.preferences;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const config = {
      timezone: String(data.get("timezone")),
      schedule: {
        enabled: data.get("scheduleEnabled") === "on",
        time: String(data.get("time")),
      },
      preferences: {
        cities: lines(data.get("cities")),
        usRemote: data.get("usRemote") === "on",
        roles: lines(data.get("roles")),
        excludedTitles: lines(data.get("excludedTitles")),
        skills: lines(data.get("skills")),
        minExperienceYears: Number(data.get("minExperienceYears")),
        maxExperienceYears: Number(data.get("maxExperienceYears")),
        preferredSalaryMin: Number(data.get("preferredSalaryMin")),
        maxPostingAgeDays: Number(data.get("maxPostingAgeDays")),
        maxResults: Number(data.get("maxResults")),
        allowUnknownDate: data.get("allowUnknownDate") === "on",
      },
      sources,
    };
    try {
      const response = await fetch(
        setup ? "/api/setup" : "/api/collection-config",
        {
          method: setup ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            setup
              ? {
                  email: String(data.get("email")),
                  password: String(data.get("password")),
                  config,
                }
              : config,
          ),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.errorMessage ?? "Could not save settings.");
      if (setup) router.push("/settings?setup=1");
      else
        setMessage(
          "Settings saved. Queued and running collections keep their original preferences; the next collection uses these changes.",
        );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save settings.",
      );
    } finally {
      setPending(false);
    }
  }
  const textFields = [
    { name: "cities", label: "US cities", rows: 5 },
    { name: "roles", label: "Role title phrases", rows: 5 },
    { name: "excludedTitles", label: "Excluded title words", rows: 4 },
    { name: "skills", label: "Skills to match", rows: 4 },
  ] as const;
  const numberFields = [
    {
      name: "minExperienceYears",
      label: "Preferred minimum experience (years)",
      max: 30,
      min: 0,
    },
    {
      name: "maxExperienceYears",
      label: "Maximum required experience (years)",
      max: 30,
      min: 0,
    },
    {
      name: "preferredSalaryMin",
      label: "Preferred annual base salary (USD)",
      max: 10000000,
      min: 0,
    },
    {
      name: "maxPostingAgeDays",
      label: "Maximum posting age (days)",
      max: 365,
      min: 1,
    },
    {
      name: "maxResults",
      label: "Maximum jobs per shortlist",
      max: 100,
      min: 1,
    },
  ] as const;
  return (
    <form onSubmit={submit} className="grid gap-5">
      {setup && (
        <section className="paper-card grid gap-4">
          <h2 className="text-xl font-bold">
            1. Create your administrator account
          </h2>
          <p className="text-sm text-[var(--ink-soft)]">
            This account manages your private JobBoard. Setup closes after the
            account is created.
          </p>
          <label className="grid gap-2">
            Email
            <input
              className="paper-input"
              type="email"
              name="email"
              autoComplete="username"
              maxLength={254}
              required
            />
          </label>
          <label className="grid gap-2">
            Password
            <input
              className="paper-input"
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
            />
            <span className="text-sm text-[var(--ink-soft)]">
              Use 12–256 characters.
            </span>
          </label>
        </section>
      )}
      <section className="paper-card grid gap-5">
        <h2 className="text-xl font-bold">
          {setup ? "2. " : ""}Search preferences
        </h2>
        <p className="text-sm text-[var(--ink-soft)]">
          Matching uses the words in job postings and these settings. Salary and
          minimum experience affect the score; jobs above your maximum required
          experience are excluded. Unknown details stay visible for review.
        </p>
        <div className="grid gap-5 md:grid-cols-2">
          {textFields.map((field) => (
            <label className="grid gap-2" key={field.name}>
              {field.label}
              <span className="text-xs text-[var(--ink-soft)]">
                One item per line
              </span>
              <textarea
                className="paper-input"
                name={field.name}
                rows={field.rows}
                defaultValue={preferences[field.name].join("\n")}
                required={field.name === "roles"}
              />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="usRemote"
            defaultChecked={preferences.usRemote}
          />{" "}
          Include jobs explicitly open to remote work in the US
        </label>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {numberFields.map((field) => (
            <label className="grid gap-2" key={field.name}>
              {field.label}
              <input
                className="paper-input"
                type="number"
                name={field.name}
                min={field.min}
                max={field.max}
                defaultValue={preferences[field.name]}
                required
              />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="allowUnknownDate"
            defaultChecked={preferences.allowUnknownDate}
          />{" "}
          Include jobs with an unknown posting date and flag them for review
        </label>
      </section>
      <section className="paper-card grid gap-5">
        <h2 className="text-xl font-bold">
          {setup ? "3. " : ""}Collection schedule
        </h2>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="scheduleEnabled"
            defaultChecked={initial.schedule.enabled}
          />{" "}
          Collect new jobs automatically each day
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="grid gap-2">
            Timezone
            <input
              className="paper-input"
              name="timezone"
              ref={timezoneInput}
              list="timezones"
              defaultValue={initial.timezone}
              required
            />
            <datalist id="timezones">
              {[
                "America/Los_Angeles",
                "America/New_York",
                "America/Chicago",
                "America/Denver",
                "Europe/London",
                "Asia/Shanghai",
                "UTC",
              ].map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </label>
          <label className="grid gap-2">
            Daily time
            <input
              className="paper-input"
              type="time"
              name="time"
              defaultValue={initial.schedule.time}
              required
            />
          </label>
        </div>
        <p className="text-sm text-[var(--ink-soft)]">
          Daily times follow your selected timezone, including daylight saving
          changes. Manual collection is also available.
        </p>
      </section>
      <section className="paper-card">
        <details>
          <summary className="cursor-pointer text-xl font-bold">
            Company sources ·{" "}
            {sources.filter((source) => source.enabled).length} enabled
          </summary>
          <p className="my-4 text-sm text-[var(--ink-soft)]">
            Start with the included companies or add a company’s Ashby,
            Greenhouse, or Lever board URL. Only enabled companies are searched.
          </p>
          <div className="grid gap-4">
            {sources.map((source, index) => (
              <div
                className="grid gap-3 border-b border-[var(--hair)] pb-4 sm:grid-cols-[auto_1fr_2fr_auto]"
                key={index}
              >
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={source.enabled}
                    onChange={(event) =>
                      setSources((current) =>
                        current.map((item, i) =>
                          i === index
                            ? { ...item, enabled: event.target.checked }
                            : item,
                        ),
                      )
                    }
                  />
                  Enabled
                </label>
                <input
                  aria-label={`Company ${index + 1} name`}
                  className="paper-input"
                  placeholder="Company name"
                  value={source.company}
                  required
                  onChange={(event) =>
                    setSources((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, company: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Company ${index + 1} ATS board URL`}
                  className="paper-input"
                  type="url"
                  placeholder="https://jobs.ashbyhq.com/company"
                  value={source.atsUrl}
                  required
                  onChange={(event) =>
                    setSources((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, atsUrl: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <button
                  className="paper-btn"
                  type="button"
                  aria-label={`Remove ${source.company || "company"}`}
                  onClick={() =>
                    setSources((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            className="paper-btn mt-5"
            type="button"
            onClick={() =>
              setSources((current) => [
                ...current,
                { company: "", atsUrl: "", enabled: true },
              ])
            }
          >
            Add company
          </button>
        </details>
      </section>
      {message && (
        <p className="paper-card text-sm" role="status">
          {message}
        </p>
      )}
      <div>
        <button
          className="paper-btn paper-btn-solid"
          disabled={pending}
          type="submit"
        >
          {pending
            ? "Saving…"
            : setup
              ? "Create account and save preferences"
              : "Save preferences"}
        </button>
      </div>
    </form>
  );
}

export function AccountActions() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function action(url: string) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(url, { method: "POST" });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.errorMessage ?? "Request failed.");
      router.push(url.endsWith("logout") ? "/login" : "/today");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        <button
          className="paper-btn paper-btn-solid"
          disabled={pending}
          onClick={() => action("/api/collection-runs")}
        >
          Collect jobs now
        </button>
        <button
          className="paper-btn"
          disabled={pending}
          onClick={() => action("/api/auth/logout")}
        >
          Sign out
        </button>
      </div>
      {message && (
        <p className="text-sm" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
