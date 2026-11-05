export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^whatsapp:/i, "");
  const hasPlus = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("00")) digits = digits.slice(2);
  if (!hasPlus || digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

export function isValidEmail(raw: string | null | undefined): raw is string {
  return !!raw && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

export function extractEmail(text: string): string | null {
  const m = text.match(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i);
  return m ? m[0].replace(/[.,;:!?]+$/, "") : null;
}

export function formatMoney(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function firstName(name: string | null | undefined): string | null {
  const first = (name || "").trim().split(/\s+/)[0];
  return first ? first.slice(0, 40) : null;
}

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.length > 6 ? `${phone.slice(0, 4)}•••${phone.slice(-3)}` : phone;
}
