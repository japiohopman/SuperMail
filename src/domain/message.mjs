/**
 * Helper to decode base64url strings from Gmail API body parts.
 */
function decodeBase64Url(input) {
  if (!input) return "";
  // Convert base64url to base64
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  try {
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch (_err) {
    return "";
  }
}

/**
 * Extract headers from Gmail message payload header list.
 */
function getHeader(headers = [], name) {
  const normalized = name.toLowerCase();
  const header = headers.find((h) => h && h.name && h.name.toLowerCase() === normalized);
  return header ? header.value : "";
}

/**
 * Extract multiple values from header if comma-separated or multiple headers.
 */
function getHeaderList(headers = [], name) {
  const val = getHeader(headers, name);
  if (!val) return [];
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Recursively parse parts to extract text and html contents.
 */
function extractBodies(part) {
  let text = "";
  let html = "";

  if (!part) return { text, html };

  if (part.mimeType === "text/plain" && part.body && part.body.data) {
    text += decodeBase64Url(part.body.data);
  } else if (part.mimeType === "text/html" && part.body && part.body.data) {
    html += decodeBase64Url(part.body.data);
  }

  if (Array.isArray(part.parts)) {
    for (const subPart of part.parts) {
      const extracted = extractBodies(subPart);
      if (extracted.text) text += (text ? "\n" : "") + extracted.text;
      if (extracted.html) html += (html ? "\n" : "") + extracted.html;
    }
  }

  return { text, html };
}

/**
 * Domain representation of a normalized email message.
 */
export class Message {
  constructor({
    id,
    threadId,
    historyId,
    labelIds,
    snippet,
    internalDate,
    from,
    to,
    cc,
    bcc,
    subject,
    messageIdHeader,
    date,
    textContent,
    htmlContent,
  }) {
    this.id = id;
    this.threadId = threadId;
    this.historyId = historyId;
    this.labelIds = Array.from(new Set(labelIds || [])).sort();
    this.snippet = snippet || "";
    this.internalDate = internalDate || null;
    this.from = from || "";
    this.to = to || [];
    this.cc = cc || [];
    this.bcc = bcc || [];
    this.subject = subject || "";
    this.messageIdHeader = messageIdHeader || "";
    this.date = date || null;
    this.textContent = textContent || "";
    this.htmlContent = htmlContent || "";
    Object.freeze(this);
  }

  /**
   * Normalizes a raw Gmail API message object into a domain Message.
   * Ensures no raw payload/headers/provider JSON are leaked on the returned instance.
   */
  static fromGmailPayload(gmailMsg) {
    if (!gmailMsg || typeof gmailMsg !== "object") {
      throw new TypeError("Invalid Gmail message payload");
    }

    const { id, threadId, historyId, labelIds = [], snippet = "", internalDate, payload = {} } = gmailMsg;

    const headers = Array.isArray(payload.headers) ? payload.headers : [];
    const from = getHeader(headers, "From");
    const to = getHeaderList(headers, "To");
    const cc = getHeaderList(headers, "Cc");
    const bcc = getHeaderList(headers, "Bcc");
    const subject = getHeader(headers, "Subject");
    const messageIdHeader = getHeader(headers, "Message-ID");
    const date = getHeader(headers, "Date");

    const bodies = extractBodies(payload);

    return new Message({
      id,
      threadId,
      historyId: historyId ? String(historyId) : null,
      labelIds,
      snippet,
      internalDate: internalDate ? Number(internalDate) : null,
      from,
      to,
      cc,
      bcc,
      subject,
      messageIdHeader,
      date,
      textContent: bodies.text,
      htmlContent: bodies.html,
    });
  }
}
