// Hazard tags and product categories derived from recall text with keyword rules.
// Kept small and readable on purpose: they label cards and drive the feed filters.

const HAZARDS = [
  ['fire', /\b(fire|ignit|flame|flammab|overheat|smok(e|ing) hazard|thermal)/i],
  ['burn', /\bburn/i],
  ['shock', /\b(shock|electrocut)/i],
  ['choking', /\bchok/i],
  ['suffocation', /\b(suffocat|asphyxia)/i],
  ['strangulation', /\b(strangul|entangle)/i],
  ['entrapment', /\bentrap/i],
  ['tip-over', /\btip[- ]?over|\btip and fall/i],
  ['fall', /\bfall(s|ing)?\b/i],
  ['laceration', /\b(lacerat|cut hazard|amputat|fingertip)/i],
  ['ingestion', /\b(ingest|swallow)/i],
  ['lead', /\blead (paint|content|poison|exposure|level|standard|limit)|\blead\b.*\b(ban|violat)/i],
  ['poisoning', /\b(poison|chemical|toxic|carbon monoxide|\bCO\b)/i],
  ['crash', /\bcrash/i],
  ['drowning', /\bdrown/i],
  ['salmonella', /\bsalmonella/i],
  ['listeria', /\blisteria/i],
  ['e. coli', /\b(e\. ?coli|stec|o157)/i],
  ['botulism', /\bbotul/i],
  ['allergen', /\b(undeclared|allergen|milk|peanut|tree nut|soy|wheat|egg|sesame|shellfish|gluten)\b.*\b(undeclared|not declared|allerg)|\bundeclared\b/i],
  ['foreign object', /\b(foreign (material|object|matter)|metal (fragment|piece|shaving)|glass (fragment|piece)|plastic (fragment|piece))/i],
];

export function hazardTags(text = '') {
  const tags = HAZARDS.filter(([, re]) => re.test(text)).map(([t]) => t);
  // "burn" is implied by most fire recalls; keep the card short.
  return tags.includes('fire') ? tags.filter((t) => t !== 'burn').slice(0, 3) : tags.slice(0, 3);
}

export const CATEGORIES = [
  ['baby', 'Babies & kids', /\b(infant|baby|babies|toddler|child|children|kid|kids|crib|bassinet|stroller|car seat|high ?chair|pacifier|teether|sleeper|playard|play yard|nursery|toy|toys|youth|bunk bed|walker|bouncer|swing|rattle|doll|onesie|pajama|sleepwear|robe)/i],
  ['power', 'Batteries & electronics', /\b(battery|batteries|power bank|charger|charging|adapter|cord|cable|lithium|e-?bike|e-?scooter|hoverboard|laptop|phone|headphone|speaker|electronic|extension|outlet|surge|usb|power strip|light|lamp|led)/i],
  ['home', 'Home & furniture', /\b(dresser|chest|furniture|chair|table|desk|bed|mattress|sofa|couch|shelf|bookcase|cabinet|window|blind|shade|curtain|door|rug|candle|decor)/i],
  ['kitchen', 'Kitchen & appliances', /\b(cooker|pressure|fryer|toaster|oven|stove|range|microwave|blender|mixer|kettle|coffee|refrigerator|freezer|dishwasher|washer|dryer|grill|smoker|appliance|heater|humidifier|dehumidifier|fan|air purifier|vacuum)/i],
  ['outdoor', 'Outdoor & sports', /\b(bicycle|bike|helmet|scooter|atv|off-road|utility vehicle|snowmobile|golf|mower|trimmer|chainsaw|generator|pressure washer|tent|camp|boat|kayak|pool|trampoline|exercise|treadmill|fitness|fishing|hunting)/i],
  ['clothing', 'Clothing & jewelry', /\b(shirt|sweatshirt|hoodie|jacket|coat|dress|pants|shoe|shoes|boot|sneaker|sandal|jewelry|necklace|bracelet|ring|earring|pendant|clothing|garment|drawstring)/i],
];

export function classify(text = '') {
  for (const [key, , re] of CATEGORIES) if (re.test(text)) return key;
  return 'other';
}
