import sanitizeHtml from "sanitize-html";

export type JobDescriptionSections = {
  company: string | null;
  benefits: string | null;
  role: string | null;
  legacy: string | null;
};

export function sanitizeJobDescription(description: string) {
  return sanitizeHtml(description, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "a",
      "h2",
      "h3",
      "h4",
      "blockquote",
      "code",
      "pre",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noreferrer",
        target: "_blank",
      }),
    },
  });
}

export function parseJobDescriptionSections(
  description: string | null | undefined,
): JobDescriptionSections {
  const value = description?.trim();

  if (!value) {
    return {
      company: null,
      benefits: null,
      role: null,
      legacy: null,
    };
  }

  const matches = [
    ...value.matchAll(
      /^[\t ]*(Company|Benefits|Role)[\t ]*:[\t ]*/gimu,
    ),
  ];

  if (matches.length === 0) {
    return {
      company: null,
      benefits: null,
      role: null,
      legacy: value,
    };
  }

  const sections = {
    company: null,
    benefits: null,
    role: null,
  } as Pick<JobDescriptionSections, "company" | "benefits" | "role">;

  matches.forEach((match, index) => {
    const label = match[1].toLowerCase() as keyof typeof sections;
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? value.length;
    const sectionValue = value.slice(start, end).trim();

    sections[label] = sectionValue || null;
  });

  return {
    ...sections,
    legacy: null,
  };
}
