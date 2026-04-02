import type { EmailMessage } from "./types.js";

export interface FutureSkyParsed {
  ticket_id: string;
  type: string;
  issue: string;
}

export function parseFutureSkyEmail(email: EmailMessage): FutureSkyParsed {
  const { subject, body } = email;

  // Extract ticket ID from subject: "Ticket ID:26197" or "Ticket Received - Ticket ID:26197"
  const ticketMatch = subject.match(/Ticket\s*(?:ID|#)\s*:?\s*(\d+)/i);
  const ticket_id = ticketMatch?.[1] || "";

  // Determine sub-type
  let type = "helpdesk";
  if (subject.includes("user activation")) type = "helpdesk_activation";
  else if (subject.includes("Ticket Received")) type = "helpdesk_ticket";
  else if (subject.startsWith("Re:")) type = "helpdesk_reply";

  // Extract issue from subject (after ticket ID part)
  let issue = "";
  const issueMatch = subject.match(/Ticket\s*ID:\d+\s+(.+)/i);
  if (issueMatch) {
    issue = issueMatch[1].trim();
  } else if (subject.startsWith("Re:")) {
    issue = subject.replace(/^Re:\s*/, "").trim();
  }

  return { ticket_id, type, issue };
}

export function isFutureSkyEmail(email: EmailMessage): boolean {
  return email.from.includes("futuresky");
}
