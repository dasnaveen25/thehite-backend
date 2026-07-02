// Basic Hindi/Devanagari to Roman transliteration map
const DEVANAGARI_MAP: Record<string, string> = {
  "अ":"a","आ":"aa","इ":"i","ई":"ee","उ":"u","ऊ":"oo","ए":"e","ऐ":"ai","ओ":"o","औ":"au",
  "क":"k","ख":"kh","ग":"g","घ":"gh","च":"ch","छ":"chh","ज":"j","झ":"jh",
  "ट":"t","ठ":"th","ड":"d","ढ":"dh","ण":"n","त":"t","थ":"th","द":"d","ध":"dh","न":"n",
  "प":"p","फ":"ph","ब":"b","भ":"bh","म":"m","य":"y","र":"r","ल":"l","व":"v",
  "श":"sh","ष":"sh","स":"s","ह":"h","ळ":"l","क्ष":"ksh","ज्ञ":"gya",
  "ा":"a","ि":"i","ी":"i","ु":"u","ू":"u","े":"e","ै":"ai","ो":"o","ौ":"au",
  "ं":"n","ः":"","्":"","ँ":"n","ॉ":"o","ॊ":"o","ृ":"ri",
  "०":"0","१":"1","२":"2","३":"3","४":"4","५":"5","६":"6","७":"7","८":"8","९":"9",
};

function transliterate(text: string): string {
  let result = "";
  for (const char of text) {
    result += DEVANAGARI_MAP[char] ?? char;
  }
  return result;
}

// Deterministic slugify with no random suffix — for user-supplied custom slugs.
export function slugifyExact(text: string): string {
  const base = transliterate(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return base;
}

export function slugify(text: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  const base = transliterate(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")   // ASCII only after transliteration
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${base || "article"}-${suffix}`;
}
