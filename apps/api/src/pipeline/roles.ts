/**
 * What kind of job a title describes, as far as interview rounds go. Shared by
 * question routing and the kit sanity check, so the two can never disagree.
 *
 * Checked against the real-kit fixtures (tests/fixtures/realKits.json): titles and
 * requirements the model actually produced for 24 postings, not examples written
 * for the test.
 */

// English, then the German, French, Spanish, Italian, Portuguese and Japanese
// titles that turn up in postings ("Senior Backend-Entwickler" was missed).
const ENGINEERING_TITLE =
  /engineer|developer|programmer|architect|\bsre\b|site reliability|devops|platform|infrastructure|data scientist|machine learning|\bml\b|security engineer|\bqa\b|test automation|technical lead|\bcto\b|entwickler|ingenieur|informatiker|développeur|ingénieur|desarrollador|ingeniero|programador|sviluppatore|engenheiro|エンジニア|開発/i;

// Crafts with their own "design" and "platform" vocabulary that has nothing to do
// with a system-design round. Checked before the engineering words, so a
// "Platform Product Manager" or a "Product Designer" is not mistaken for one.
const NON_ENGINEERING_TITLE =
  /designer|design (lead|manager|director)|researcher|product manager|product owner|marketing|sales|account (executive|manager)|recruit|people partner|finance|legal|content|writer|nurse|physician|teacher|chef|kitchen|driver|support specialist|customer success|partner programs/i;

const JUNIOR_TITLE =
  /intern|praktik|junior|graduate|new grad|entry[- ]level|apprentice|trainee|werkstudent|stagiaire|becario/i;

export function isNonEngineeringTitle(title: string): boolean {
  return NON_ENGINEERING_TITLE.test(title);
}

/** An engineering title, and not a non-engineering one that borrows a word from it. */
export function isEngineeringTitle(title: string): boolean {
  return !isNonEngineeringTitle(title) && ENGINEERING_TITLE.test(title);
}

export function isJunior(titleOrSeniority: string): boolean {
  return JUNIOR_TITLE.test(titleOrSeniority);
}

/** Software-systems language, used when the title itself does not settle it. */
export const SYSTEMS_WORK =
  /system design|software architect|architecture|distributed|micro-?service|scalab|high availability|throughput|latency|api design|data pipeline|infrastructure|kubernetes|database schema/i;

/** Whether the company's own published process mentions a design round. */
export function processHasDesignRound(hiringProcess: string | null): boolean {
  return Boolean(hiringProcess && /system design|architecture (interview|round)|design round/i.test(hiringProcess));
}
