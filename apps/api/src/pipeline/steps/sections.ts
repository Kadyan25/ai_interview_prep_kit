/**
 * Job postings are organised under section headings, and the heading a line sits
 * under says a lot: a bullet under "Nice to have" is optional even when the bullet
 * itself never says so, and nothing under "Benefits" is a requirement at all.
 *
 * Real headings rarely end in a colon — pasted from a web page they are simply a
 * short line on their own — so they are recognised by wording rather than
 * punctuation. Input is expected lowercased with straight quotes.
 */

export type HeadingKind = "must" | "nice" | "neutral" | "boilerplate";

const MAX_HEADING_CHARS = 60;

// Checked before MUST so "preferred qualifications" is not read as a must.
// Each lexicon ends with the German, French, Spanish and Japanese headings seen
// in real postings, since the model's own priority is all that is left otherwise.
const NICE_HEADING = new RegExp(
  "^(" +
    [
      "nice[- ]to[- ]haves?", "good[- ]to[- ]haves?", "bonus( points)?( if you have)?",
      "preferred( qualifications| skills| experience)?", "desired( qualifications| skills| experience)?",
      "pluses", "extra credit", "it'?s a plus( if you have)?", "ideally( you have)?",
      "desirable( skills| criteria)?", "what would make you stand out", "you might also have",
      "additional (qualifications|skills)", "even better if you have", "bonus if you have",
      "wünschenswert", "von vorteil", "atouts?", "(ce qui )?serait un plus", "se valorará", "deseable",
      "valorable", "歓迎(スキル|条件|要件)?",
    ].join("|") +
    ")$",
);

const MUST_HEADING = new RegExp(
  "^(" +
    [
      "requirements", "job requirements", "minimum (qualifications|requirements)", "basic qualifications",
      "qualifications", "required( qualifications| skills| experience)?",
      "requirements (and|&) qualifications", "qualifications (and|&) (experience|skills)",
      "what you('ll| will)? (bring|need)( to (the|this|our) (team|role|table))?",
      "you('ll| will) need", "what we('re| are) looking for( in you)?", "who we('re| are) looking for",
      "the ideal candidate", "who you are", "about you", "you (have|bring|are|should have)",
      "must[- ]haves?", "essential (skills|criteria)", "skills( and| &) experience",
      "experience( and| &) skills", "skills", "experience",
      "your (skills|experience|background|profile|qualifications)", "what you need to succeed",
      "key (requirements|qualifications|skills)",
      "anforderungen", "dein profil", "ihr profil", "was du mitbringst", "was sie mitbringen",
      "qualifikationen", "voraussetzungen", "profil recherché", "votre profil", "compétences requises",
      "prérequis", "requisitos", "tu perfil", "perfil", "lo que buscamos", "必須(スキル|条件|要件)", "応募資格",
    ].join("|") +
    ")$",
);

// Sections that are not requirements and contain none; also safe to drop from a
// posting that is too long to send whole.
const BOILERPLATE_HEADING =
  /^(benefits|our benefits|perks( and benefits)?|benefits( and| &) perks|what we offer|compensation|salary|pay (range|transparency)|equal (employment )?opportunity.*|eeo( statement)?|diversity.*|accommodations?|privacy( notice| policy)?|how to apply|application process|how gitlab supports.*|how we support you|(was )?wir bieten|avantages|ce que nous (offrons|proposons)|beneficios|lo que ofrecemos|福利厚生)$/;

// Real sections that simply carry no priority signal.
const NEUTRAL_HEADING =
  /^(about (us|the (team|role|company|job|position))|the role|the team|what you('ll| will) do|responsibilities|key responsibilities|your (role|responsibilities|impact)|in this role|day to day|who we are|why (join|work).*|our (mission|values|culture|process|hiring process)|location|overview|job description|role overview|(deine|ihre) aufgaben|über uns|(vos )?missions|à propos|responsabilidades|sobre nosotros|funciones|業務内容)$/;

function clean(line: string): string {
  return line
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/[:.]$/, "")
    .trim();
}

/** Classifies a line as a section heading, or returns null for ordinary text. */
export function classifyHeading(line: string): HeadingKind | null {
  const text = clean(line);
  if (text.length === 0 || text.length > MAX_HEADING_CHARS) return null;

  if (NICE_HEADING.test(text)) return "nice";
  if (MUST_HEADING.test(text)) return "must";
  if (BOILERPLATE_HEADING.test(text)) return "boilerplate";
  if (NEUTRAL_HEADING.test(text)) return "neutral";
  return null;
}

/** The heading text, trimmed of markers, for reporting which cue decided. */
export function headingLabel(line: string): string {
  return clean(line);
}
