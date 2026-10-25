// Shopping data: real OTC product names with list prices (a sanity cap on real-store listings) and the demo profile.
// Each kit lists items in priority order: over budget, optional items are dropped from the bottom up.
// `match` is the exact product rule the user pre-approved (SKU, brand, or active ingredient + strength). Nothing else is bought.

export const PRODUCTS: RawProduct[] = [
  {"sku": "stelo-2pk", "name": "Dexcom Stelo Glucose Biosensor, 2 sensors", "brand": "Dexcom Stelo", "category": "diabetes", "list_price": 99.0, "rx": false, "keywords": ["stelo"]},
  {"sku": "dexcom-g7-sensor", "name": "Dexcom G7 Sensor", "brand": "Dexcom G7", "category": "diabetes", "list_price": 89.0, "rx": true, "slot": "cgm_sensor", "keywords": ["g7"]},
  {"sku": "libre3-sensor", "name": "FreeStyle Libre 3 Sensor", "brand": "FreeStyle Libre 3", "category": "diabetes", "list_price": 79.0, "rx": true, "slot": "cgm_sensor", "keywords": ["libre"]},
  {"sku": "cgm-overpatch-20", "name": "CGM Sensor Overpatches, 20 ct", "brand": "Skin Grip", "category": "diabetes", "list_price": 14.99, "rx": false},
  {"sku": "bd-alcohol-swabs-100", "name": "BD Alcohol Swabs, 100 ct", "brand": "BD", "active_ingredient": "isopropyl alcohol", "strength": "70%", "category": "diabetes", "list_price": 4.49, "rx": false},
  {"sku": "store-alcohol-pads-100", "name": "Alcohol Prep Pads, 100 ct (store brand)", "brand": "Store brand", "active_ingredient": "isopropyl alcohol", "strength": "70%", "category": "diabetes", "list_price": 2.99, "rx": false},
  {"sku": "fastclix-102", "name": "Accu-Chek FastClix Lancets, 102 ct", "brand": "Accu-Chek FastClix", "category": "diabetes", "list_price": 21.99, "rx": false},
  {"sku": "dex4-gel-3", "name": "Dex4 Glucose Gel, 3 pack", "brand": "Dex4", "active_ingredient": "dextrose", "category": "diabetes", "list_price": 8.99, "rx": false},
  {"sku": "claritin-10mg-30", "name": "Claritin 24hr Non-Drowsy, loratadine 10 mg, 30 tablets", "brand": "Claritin", "active_ingredient": "loratadine", "strength": "10 mg", "category": "allergy", "list_price": 24.99, "rx": false},
  {"sku": "loratadine-10mg-30", "name": "Loratadine 10 mg, 30 tablets (store brand)", "brand": "Store brand", "active_ingredient": "loratadine", "strength": "10 mg", "category": "allergy", "list_price": 9.99, "rx": false},
  {"sku": "zyrtec-10mg-30", "name": "Zyrtec 24hr, cetirizine 10 mg, 30 tablets", "brand": "Zyrtec", "active_ingredient": "cetirizine", "strength": "10 mg", "category": "allergy", "list_price": 26.99, "rx": false},
  {"sku": "neilmed-nasamist", "name": "NeilMed NasaMist Saline Spray", "brand": "NeilMed", "active_ingredient": "sodium chloride", "category": "allergy", "list_price": 7.99, "rx": false},
  {"sku": "levoit-core300-filter", "name": "Levoit Core 300 True HEPA Replacement Filter", "brand": "Levoit", "category": "allergy", "list_price": 29.99, "rx": false},
  {"sku": "aerochamber-plus", "name": "AeroChamber Plus Flow-Vu Spacer", "brand": "AeroChamber", "category": "allergy", "list_price": 24.99, "rx": false},
  {"sku": "albuterol-inhaler", "name": "Albuterol Sulfate Inhaler", "brand": "Albuterol", "active_ingredient": "albuterol", "category": "allergy", "list_price": 30.0, "rx": true, "keywords": ["albuterol", "rescue inhaler"]},
  {"sku": "telfa-3x4-10", "name": "Telfa Non-Adherent Pads, 3x4 in, 10 ct", "brand": "Telfa", "category": "recovery", "list_price": 6.49, "rx": false},
  {"sku": "micropore-1in", "name": "3M Micropore Paper Tape, 1 in", "brand": "3M Micropore", "category": "recovery", "list_price": 4.99, "rx": false},
  {"sku": "flexikold-knee", "name": "FlexiKold Reusable Gel Cold Pack, knee", "brand": "FlexiKold", "category": "recovery", "list_price": 15.99, "rx": false},
  {"sku": "voltaren-1pct-100g", "name": "Voltaren Arthritis Pain Gel, diclofenac 1%, 100 g", "brand": "Voltaren", "active_ingredient": "diclofenac sodium", "strength": "1%", "category": "recovery", "list_price": 14.99, "rx": false},
  {"sku": "theraband-set", "name": "TheraBand Resistance Bands, 3-level set", "brand": "TheraBand", "category": "recovery", "list_price": 16.99, "rx": false},
  {"sku": "oxycodone-5mg", "name": "Oxycodone 5 mg", "brand": "Oxycodone", "active_ingredient": "oxycodone", "category": "recovery", "list_price": 20.0, "rx": true, "keywords": ["oxycodone", "percocet", "opioid"]},
  {"sku": "thermacare-menstrual-3", "name": "ThermaCare Menstrual Heat Wraps, 3 ct", "brand": "ThermaCare", "category": "cycle", "list_price": 7.99, "rx": false},
  {"sku": "advil-200mg-50", "name": "Advil, ibuprofen 200 mg, 50 tablets", "brand": "Advil", "active_ingredient": "ibuprofen", "strength": "200 mg", "category": "cycle", "list_price": 9.99, "rx": false},
  {"sku": "ibuprofen-200mg-100", "name": "Ibuprofen 200 mg, 100 tablets (store brand)", "brand": "Store brand", "active_ingredient": "ibuprofen", "strength": "200 mg", "category": "cycle", "list_price": 6.49, "rx": false},
  {"sku": "aleve-220mg-24", "name": "Aleve, naproxen sodium 220 mg, 24 tablets", "brand": "Aleve", "active_ingredient": "naproxen sodium", "strength": "220 mg", "category": "cycle", "list_price": 8.99, "rx": false},
  {"sku": "mag-glycinate-120", "name": "Doctor's Best Magnesium Glycinate, 120 tablets", "brand": "Doctor's Best", "active_ingredient": "magnesium glycinate", "category": "cycle", "list_price": 17.99, "rx": false},
  {"sku": "lindt-85-100g", "name": "Lindt Excellence 85% Dark Chocolate, 100 g", "brand": "Lindt", "category": "cycle", "list_price": 3.99, "rx": false},
  {"sku": "tylenol-es-500mg-100", "name": "Tylenol Extra Strength, acetaminophen 500 mg, 100 caplets", "brand": "Tylenol", "active_ingredient": "acetaminophen", "strength": "500 mg", "category": "headache", "list_price": 13.99, "rx": false},
  {"sku": "acetaminophen-500mg-100", "name": "Acetaminophen 500 mg, 100 caplets (store brand)", "brand": "Store brand", "active_ingredient": "acetaminophen", "strength": "500 mg", "category": "headache", "list_price": 6.99, "rx": false},
  {"sku": "liquid-iv-lemon-8", "name": "Liquid I.V. Hydration Multiplier, lemon lime, 8 sticks", "brand": "Liquid I.V.", "category": "headache", "list_price": 12.99, "rx": false},
  {"sku": "bekoool-adult-4", "name": "Be Koool Soft Gel Cooling Sheets, 4 ct", "brand": "Be Koool", "category": "headache", "list_price": 6.49, "rx": false},
  {"sku": "fioricet-50mg", "name": "Fioricet (butalbital/acetaminophen/caffeine)", "brand": "Fioricet", "active_ingredient": "butalbital", "category": "headache", "list_price": 25.0, "rx": true, "keywords": ["fioricet", "butalbital", "sumatriptan", "imitrex", "triptan"]},
];

export const PROFILE = { name: "Demo patient (synthetic)", location: "San Francisco, CA" };

export const KITS: Record<string, RawKit> = {
  diabetes: {
    label: "Diabetes care",
    budget_cap: 140.00,
    keywords: ["diabetes", "diabetic", "glucose", "blood sugar", "cgm", "sensor", "lancet"],
    items: [
      {"key": "cgm_sensor", "label": "CGM sensors", "match": {"sku": "stelo-2pk"}, "qty": 1, "essential": true, "keywords": ["cgm", "sensor", "stelo", "biosensor"]},
      {"key": "glucose_gel", "label": "Fast-acting glucose gel", "match": {"brand": "Dex4"}, "qty": 1, "essential": true, "keywords": ["gel", "glucose gel", "glucose shot", "dex4"]},
      {"key": "prep_pads", "label": "Alcohol prep pads", "match": {"active_ingredient": "isopropyl alcohol", "strength": "70%"}, "qty": 1, "essential": true, "keywords": ["alcohol", "prep pad", "swab"]},
      {"key": "lancets", "label": "Lancets", "match": {"brand": "Accu-Chek FastClix"}, "qty": 1, "essential": false, "keywords": ["lancet"]},
      {"key": "overpatches", "label": "Sensor overpatches", "match": {"sku": "cgm-overpatch-20"}, "qty": 1, "essential": false, "keywords": ["overpatch", "patch", "cover"]},
    ],
  },
  allergy: {
    label: "Allergy and air quality",
    budget_cap: 60.00,
    keywords: ["allergy", "allergies", "pollen", "hay fever", "sneez", "aqi", "air quality", "smoke", "wildfire", "antihistamine", "congest"],
    items: [
      {"key": "antihistamine", "label": "Non-drowsy antihistamine", "match": {"active_ingredient": "loratadine", "strength": "10 mg"}, "qty": 1, "essential": true, "keywords": ["antihistamine", "loratadine", "claritin", "allergy pill"]},
      {"key": "saline_spray", "label": "Saline nasal spray", "match": {"brand": "NeilMed"}, "qty": 1, "essential": true, "keywords": ["saline", "nasal", "spray"]},
      {"key": "hepa_filter", "label": "HEPA purifier filter", "match": {"sku": "levoit-core300-filter"}, "qty": 1, "essential": false, "aqi_essential": 101, "keywords": ["filter", "hepa", "purifier"]},
      {"key": "spacer", "label": "Inhaler spacer", "match": {"brand": "AeroChamber"}, "qty": 1, "essential": false, "keywords": ["spacer", "aerochamber"]},
    ],
  },
  recovery: {
    label: "Post-surgery recovery",
    budget_cap: 45.00,
    keywords: ["surgery", "post-op", "recovery", "wound", "incision", "knee", "injury", "sprain", "physical therapy"],
    items: [
      {"key": "gauze", "label": "Non-stick gauze pads", "match": {"brand": "Telfa"}, "qty": 1, "essential": true, "keywords": ["gauze", "pad", "dressing"]},
      {"key": "tape", "label": "Medical paper tape", "match": {"brand": "3M Micropore"}, "qty": 1, "essential": true, "keywords": ["tape"]},
      {"key": "cold_pack", "label": "Cold compression gel pack", "match": {"sku": "flexikold-knee"}, "qty": 1, "essential": true, "keywords": ["cold pack", "ice pack", "gel pack", "cold"]},
      {"key": "pain_gel", "label": "Anti-inflammatory gel", "match": {"brand": "Voltaren"}, "qty": 1, "essential": false, "keywords": ["voltaren", "diclofenac", "pain gel"]},
      {"key": "bands", "label": "Physical therapy bands", "match": {"brand": "TheraBand"}, "qty": 1, "essential": false, "keywords": ["band", "theraband", "resistance"]},
    ],
  },
  cycle: {
    label: "Period care",
    budget_cap: 30.00,
    keywords: ["period", "cramp", "menstrual", "cycle", "luteal", "pms"],
    items: [
      {"key": "heat", "label": "Heat wraps", "match": {"brand": "ThermaCare"}, "qty": 1, "essential": true, "keywords": ["heat", "thermacare", "wrap", "patch"]},
      {"key": "pain_relief", "label": "Pain reliever", "match": {"brand": "Advil", "active_ingredient": "ibuprofen", "strength": "200 mg"}, "qty": 1, "essential": true, "keywords": ["advil", "ibuprofen", "pain"]},
      {"key": "magnesium", "label": "Magnesium glycinate", "match": {"active_ingredient": "magnesium glycinate"}, "qty": 1, "essential": false, "keywords": ["magnesium"]},
      {"key": "chocolate", "label": "85% dark chocolate", "match": {"sku": "lindt-85-100g"}, "qty": 1, "essential": false, "keywords": ["chocolate"]},
    ],
  },
  headache: {
    label: "Headache relief",
    budget_cap: 30.00,
    keywords: ["headache", "head ache", "head hurts", "migraine", "tension headache", "hangover"],
    items: [
      {"key": "pain_relief", "label": "Pain reliever", "match": {"active_ingredient": "acetaminophen", "strength": "500 mg"}, "qty": 1, "essential": true, "keywords": ["tylenol", "acetaminophen", "paracetamol", "pain"]},
      {"key": "electrolytes", "label": "Electrolyte drink mix", "match": {"brand": "Liquid I.V."}, "qty": 1, "essential": true, "keywords": ["electrolyte", "hydration", "liquid iv", "liquid i.v."]},
      {"key": "cooling_patch", "label": "Cooling gel sheets", "match": {"brand": "Be Koool"}, "qty": 1, "essential": false, "keywords": ["cooling", "cold patch", "gel sheet", "be koool"]},
    ],
  },
};

export type RawProduct = {
  sku: string;
  name: string;
  brand: string;
  category: string;
  list_price: number;
  rx: boolean;
  active_ingredient?: string;
  strength?: string;
  slot?: string; // prescription products: the kit item this would stand in for
  keywords?: string[];
};

export type RawKit = {
  label: string;
  budget_cap: number;
  keywords: string[];
  items: {
    key: string;
    label: string;
    match: Record<string, string>;
    qty: number;
    essential: boolean;
    keywords: string[];
    aqi_essential?: number; // becomes essential when live US AQI is at or above this
  }[];
};
