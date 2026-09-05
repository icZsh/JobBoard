import type { CollectorImportJob, CollectorPosting, CollectorRules, RuleDecision } from "./types";

const DAY_MS = 86400000;
const nonUsLocation = /\b(?:canada|india|united kingdom|uk|england|ireland|australia|new zealand|germany|poland|france|spain|portugal|netherlands|singapore|japan|china|philippines|mexico|brazil|argentina|israel|south africa)\b/iu;
const usCountry = /^(?:us|usa|u\.s\.(?:a\.)?|united states(?: of america)?)$/iu;

function matches(patterns: string[], value: string) {
  return patterns.some((pattern) => new RegExp(pattern, "iu").test(value));
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

function postingDate(posting: CollectorPosting) {
  return posting.dateEvidence !== "unknown" && validDate(posting.datePosted) !== null ? posting.datePosted : null;
}

function eligibleLocation(posting: CollectorPosting, rules: CollectorRules): string | null {
  const country = posting.country?.trim();
  // A provider's explicit non-US country is stronger evidence than company boilerplate.
  if (country && !usCountry.test(country)) return null;
  for (const location of posting.locations) {
    if (matches(rules.usRemotePatterns, location)) return location;
    if (nonUsLocation.test(location)) continue;
    if (matches(rules.locationPatterns, location)) return location;
  }
  const remote = posting.remoteType === "remote" || posting.locations.some((location) => /\bremote\b/iu.test(location));
  if (!remote || posting.locations.some((location) => nonUsLocation.test(location))) return null;
  if (country && usCountry.test(country) && matches(rules.usRemotePatterns, `Remote - ${country}`)) return "US remote (provider country)";
  for (const location of posting.locations) {
    if (usCountry.test(location.trim()) && matches(rules.usRemotePatterns, `Remote - ${location}`)) return "US remote (provider location)";
  }
  // Only an explicit eligibility statement can resolve a bare "Remote" location.
  // Headquarters, "work with us", and North America alone are not US eligibility.
  const eligibility = /\b(?:this (?:role|position) is remote (?:in|within)|(?:candidates|applicants|employees|you) must (?:be (?:based|located) in|reside in))\s+(?:the\s+)?(?:united states(?: of america)?|u\.?s\.?a?\.?)(?=$|[\s,;.!])/iu;
  return matches(rules.usRemotePatterns, "Remote - United States") && eligibility.test(posting.description) ? "US remote (explicit posting eligibility)" : null;
}

interface ExperienceEvidence { minimum: number | null; preferred: number[]; ambiguous: boolean; alternatives: boolean }

function experienceEvidence(description: string): ExperienceEvidence {
  const required: number[] = [];
  const preferred: number[] = [];
  let ambiguous = false;
  let alternatives = false;
  let section: "required" | "preferred" | null = null;
  for (const line of description.split(/\n/u)) {
    const heading = line.trim().replace(/^[#*\-•\s]+/u, "");
    if (/^(?:(?:minimum|required|basic) (?:qualifications|requirements)|qualifications|requirements|(?:what )?you (?:bring|have|need)|what you(?:['’]ll| will) (?:bring|need)|what we(?:['’]re| are) looking for|what we look for|who you are|about you)\b/iu.test(heading)) section = "required";
    else if (/^(?:preferred (?:qualifications|skills|experience)|nice[ -]to[ -]have|bonus points|desirable)\b/iu.test(heading)) section = "preferred";
    else if (/^(?:benefits|compensation|about (?:the company|us)|responsibilities|what you(?:'ll| will) do|perks|equal opportunity)\b/iu.test(heading)) section = null;
    for (const clause of line.split(/[.!?;](?:\s|$)/u)) {
      const experience = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*(?:-|–|—|to)\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten))?\s*\+?\s*(?:or more\s+)?(?:years?|yrs?)(?:['’])?\b[^.!?;\n]{0,75}?\bexperience\b/giu;
      const found = [...clause.matchAll(experience)];
      if (!found.length) continue;
      const isPreferred = section === "preferred" || /\b(?:preferred|nice[ -]to[ -]have|bonus|ideally|a plus|desirable)\b/iu.test(clause);
      const isRequired = section === "required" || /\b(?:requires?|required|must|minimum|at least|you (?:have|bring)|need to have)\b/iu.test(clause);
      const numberWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
      const values = found.filter((match) => !/\b(?:paid|leave|vesting|vacation|benefits|bonus|business|founded)\b/iu.test(match[0])).map((match) => /^\d+$/u.test(match[1]) ? Number(match[1]) : numberWords.indexOf(match[1].toLowerCase()));
      if (isPreferred) preferred.push(...values);
      else if (isRequired) {
        const alternate = found.some((match, index) => index > 0 && /\bor\b/iu.test(clause.slice((found[index - 1].index ?? 0) + found[index - 1][0].length, match.index)));
        if (alternate && values.length > 1) { required.push(Math.min(...values)); alternatives = true; }
        else required.push(...values);
      } else ambiguous = true;
    }
  }
  return { minimum: required.length ? Math.max(...required) : null, preferred, ambiguous, alternatives };
}

function keywordMatch(skill: string, description: string) {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(description);
}

export function evaluatePosting(posting: CollectorPosting, rules: CollectorRules, runDate: string): RuleDecision {
  const runTimestamp = validDate(runDate);
  if (runTimestamp === null) throw new Error("Invalid run date; expected YYYY-MM-DD");
  const reasons: string[] = [];
  const concerns = [...posting.warnings];
  let excluded = false;
  let score = 0;
  const exclude = (reason: string) => { excluded = true; reasons.push(`Excluded: ${reason}`); };
  const addScore = (points: number, reason: string) => { score += points; reasons.push(`${points >= 0 ? "+" : ""}${points}: ${reason}`); };
  if (matches(rules.excludeTitlePatterns, posting.title)) exclude("title has an excluded seniority or employment pattern");
  if (/\b(?:contract(?:or)?|intern(?:ship)?|temporary|freelance|fixed[ -]term)\b/iu.test(posting.employmentType ?? "")) exclude("employment type is contract, internship, or temporary");
  if (matches(rules.excludedCompanyPatterns, posting.company)) exclude("company matches an exclusion rule");
  if (matches(rules.includeTitlePatterns, posting.title)) addScore(35, "title matches a configured target role");
  else exclude("title does not match a configured target role");
  const location = eligibleLocation(posting, rules);
  if (location) addScore(20, `location matches target eligibility: ${location}`);
  else exclude("location is outside target cities or US remote eligibility is unverified");

  const experience = experienceEvidence(posting.description);
  const minimumExperience = rules.minExperienceYears ?? 2;
  if (experience.minimum === null) concerns.push("Required minimum experience is unverified or unclear; review the original qualifications.");
  else if (experience.minimum > rules.maxExperienceYears) exclude(`required minimum experience ${experience.minimum} years exceeds configured maximum ${rules.maxExperienceYears}`);
  else if (experience.minimum >= minimumExperience && experience.minimum < rules.maxExperienceYears) addScore(10, `required minimum experience ${experience.minimum} years matches the configured ${minimumExperience}–${rules.maxExperienceYears} year preference`);
  else if (experience.minimum === rules.maxExperienceYears) {
    addScore(3, `required minimum experience ${experience.minimum} years is within the configured maximum`);
    concerns.push(`Required minimum ${experience.minimum} years is at the experience boundary; verify suitability.`);
  } else { addScore(-5, `required minimum experience ${experience.minimum} years is below the configured ${minimumExperience} year preference`); concerns.push("The stated experience minimum may indicate an earlier-career role."); }
  if (experience.preferred.some((years) => years > rules.maxExperienceYears)) concerns.push(`Preferred experience exceeds ${rules.maxExperienceYears} years; treated as a preference, not a required minimum.`);
  if (experience.alternatives) concerns.push("Experience requirements include alternative qualification paths; verify the applicable path.");
  if (experience.ambiguous && experience.minimum !== null) concerns.push("Additional experience wording has unclear required/preferred status; review the posting.");

  const threshold = rules.preferredSalaryMin.toLocaleString("en-US");
  if (posting.salaryMin !== null && posting.salaryMin >= rules.preferredSalaryMin) addScore(10, `annual USD base salary minimum meets $${threshold} preference`);
  else if (posting.salaryMax !== null && posting.salaryMax < rules.preferredSalaryMin) { addScore(-10, `annual USD base salary range is below $${threshold} preference`); concerns.push(`Listed annual USD base salary is below the $${threshold} preference.`); }
  else if (posting.salaryMax !== null && posting.salaryMax >= rules.preferredSalaryMin) { addScore(4, `annual USD base salary ceiling reaches $${threshold} preference`); concerns.push("Only the salary ceiling meets the preference; the applicable offer is unverified."); }
  else concerns.push("Annual USD base salary is unknown or insufficient to verify the salary preference.");

  const date = postingDate(posting);
  if (date === null) {
    concerns.push("Posting date is unknown or invalid; observation and update dates are not publication dates.");
    if (!rules.allowUnknownDate) exclude("posting date is unknown and allowUnknownDate is false");
  } else {
    const age = Math.floor((runTimestamp - (validDate(date) as number)) / DAY_MS);
    if (age < 0) concerns.push("Provider posting date is in the future; no freshness points awarded.");
    else if (age > rules.maxPostingAgeDays) exclude(`provider posting date is ${age} days old, beyond ${rules.maxPostingAgeDays} days`);
    else addScore(age <= 7 ? 10 : 5, `provider posting date is ${age} days old (${posting.dateEvidence})`);
    if (posting.dateEvidence === "last_published") concerns.push("Provider date reflects last publication and may be a repost; original publication date is unverified.");
    if (posting.dateEvidence === "created") concerns.push("Provider date reflects posting creation; original publication date is unverified.");
  }
  const matchedSkills = [...new Set(rules.skills)].filter((skill) => keywordMatch(skill, `${posting.title}\n${posting.description}`));
  if (matchedSkills.length) addScore(Math.min(15, matchedSkills.length * 2), `configured skills appear in posting text: ${matchedSkills.join(", ")}`);
  else concerns.push("No configured skill keywords were found; this does not establish missing candidate skills.");
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (score < rules.minimumScore) exclude(`rules score ${score} is below minimumScore ${rules.minimumScore}`);
  return { included: !excluded, reasons, score, matchedSkills, concerns: [...new Set(concerns)] };
}

export function toImportJob(posting: CollectorPosting, decision: RuleDecision, fetchedAt: string): CollectorImportJob {
  if (!decision.included) throw new Error("Cannot export an excluded posting");
  return {
    title: posting.title,
    company: posting.company,
    company_website_url: posting.companyWebsiteUrl,
    location: posting.locations.join("; ") || null,
    remote_type: posting.remoteType,
    salary_min: posting.salaryMin,
    salary_max: posting.salaryMax,
    source_url: posting.sourceUrl,
    date_posted: postingDate(posting),
    description: `Company: ${posting.company}\n\nBenefits: Not independently verified; see the original posting.\n\nRole: ${posting.description}`,
    fit_score: decision.score,
    priority: decision.score >= 80 ? "high" : decision.score >= 60 ? "medium" : "low",
    matched_skills: decision.matchedSkills,
    missing_skills: [],
    match_reason: `Deterministic rules-v1 score ${decision.score}/100. ${decision.reasons.join("; ")}. Keyword matches identify posting text only.`,
    concerns: decision.concerns.join(" ") || null,
    suggested_action: "Review today.",
    collector: {
      provider: posting.provider, board: posting.board, external_id: posting.externalId,
      fetched_at: fetchedAt, date_evidence: posting.dateEvidence,
      source_updated_at: posting.sourceUpdatedAt, scoring: "rules-v1",
    },
  };
}
