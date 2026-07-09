import { db, locationsTable, pool } from "@workspace/db";
import { notInArray } from "drizzle-orm";

const STATE = { slug: "chhattisgarh", nameHi: "छत्तीसगढ़", nameEn: "Chhattisgarh" };

const DISTRICTS: Array<{ slug: string; nameHi: string; nameEn: string }> = [
  { slug: "raipur", nameHi: "रायपुर", nameEn: "Raipur" },
  { slug: "durg", nameHi: "दुर्ग", nameEn: "Durg" },
  { slug: "rajnandgaon", nameHi: "राजनांदगांव", nameEn: "Rajnandgaon" },
  { slug: "balod", nameHi: "बालोद", nameEn: "Balod" },
  { slug: "bemetara", nameHi: "बेमेतरा", nameEn: "Bemetara" },
  { slug: "kabirdham", nameHi: "कबीरधाम", nameEn: "Kabirdham" },
  { slug: "dhamtari", nameHi: "धमतरी", nameEn: "Dhamtari" },
  { slug: "gariaband", nameHi: "गरियाबंद", nameEn: "Gariaband" },
  { slug: "mahasamund", nameHi: "महासमुंद", nameEn: "Mahasamund" },
  { slug: "baloda-bazar", nameHi: "बलौदाबाजार-भाटापारा", nameEn: "Baloda Bazar-Bhatapara" },
  { slug: "bilaspur", nameHi: "बिलासपुर", nameEn: "Bilaspur" },
  { slug: "mungeli", nameHi: "मुंगेली", nameEn: "Mungeli" },
  { slug: "gaurela-pendra-marwahi", nameHi: "गौरेला-पेंड्रा-मरवाही", nameEn: "Gaurela-Pendra-Marwahi" },
  { slug: "korba", nameHi: "कोरबा", nameEn: "Korba" },
  { slug: "janjgir-champa", nameHi: "जांजगीर-चांपा", nameEn: "Janjgir-Champa" },
  { slug: "raigarh", nameHi: "रायगढ़", nameEn: "Raigarh" },
  { slug: "surguja", nameHi: "सरगुजा", nameEn: "Surguja" },
  { slug: "surajpur", nameHi: "सूरजपुर", nameEn: "Surajpur" },
  { slug: "balrampur-ramanujganj", nameHi: "बलरामपुर-रामानुजगंज", nameEn: "Balrampur-Ramanujganj" },
  { slug: "jashpur", nameHi: "जशपुर", nameEn: "Jashpur" },
  { slug: "koriya", nameHi: "कोरिया", nameEn: "Koriya" },
  { slug: "manendragarh-chirmiri-bharatpur", nameHi: "मनेन्द्रगढ़-चिरमिरी-भरतपुर", nameEn: "Manendragarh-Chirmiri-Bharatpur" },
  { slug: "bastar", nameHi: "बस्तर", nameEn: "Bastar" },
  { slug: "kanker", nameHi: "कांकेर", nameEn: "Kanker" },
  { slug: "kondagaon", nameHi: "कोंडागांव", nameEn: "Kondagaon" },
  { slug: "narayanpur", nameHi: "नारायणपुर", nameEn: "Narayanpur" },
  { slug: "dantewada", nameHi: "दंतेवाड़ा", nameEn: "Dantewada" },
  { slug: "bijapur", nameHi: "बीजापुर", nameEn: "Bijapur" },
  { slug: "sukma", nameHi: "सुकमा", nameEn: "Sukma" },
  { slug: "mohla-manpur-ambagarh-chowki", nameHi: "मोहला-मानपुर-अंबागढ़ चौकी", nameEn: "Mohla-Manpur-Ambagarh Chowki" },
  { slug: "khairagarh-chhuikhadan-gandai", nameHi: "खैरागढ़-छुईखदान-गंडई", nameEn: "Khairagarh-Chhuikhadan-Gandai" },
  { slug: "sakti", nameHi: "सक्ति", nameEn: "Sakti" },
  { slug: "sarangarh-bilaigarh", nameHi: "सारंगढ़-बिलाईगढ़", nameEn: "Sarangarh-Bilaigarh" },
];

async function main() {
  const [state] = await db
    .insert(locationsTable)
    .values({ slug: STATE.slug, type: "state", nameHi: STATE.nameHi, nameEn: STATE.nameEn, parentId: null })
    .onConflictDoUpdate({
      target: locationsTable.slug,
      set: { type: "state", nameHi: STATE.nameHi, nameEn: STATE.nameEn, parentId: null },
    })
    .returning();

  console.log(`State upserted: ${state.nameEn} (${state.id})`);

  for (const d of DISTRICTS) {
    await db
      .insert(locationsTable)
      .values({ slug: d.slug, type: "district", nameHi: d.nameHi, nameEn: d.nameEn, parentId: state.id })
      .onConflictDoUpdate({
        target: locationsTable.slug,
        set: { type: "district", nameHi: d.nameHi, nameEn: d.nameEn, parentId: state.id },
      });
  }
  console.log(`Districts upserted: ${DISTRICTS.length}`);

  const keepSlugs = [STATE.slug, ...DISTRICTS.map((d) => d.slug)];
  const removed = await db
    .delete(locationsTable)
    .where(notInArray(locationsTable.slug, keepSlugs))
    .returning({ slug: locationsTable.slug, type: locationsTable.type });

  console.log(`Removed ${removed.length} other location(s):`);
  for (const r of removed) console.log(`  - [${r.type}] ${r.slug}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
