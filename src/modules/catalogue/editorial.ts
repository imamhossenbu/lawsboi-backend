// Editorial data the reader site used to keep in code, now the seed the import script writes into the database:
// the hand-curated laws' bilingual metadata and the CPC's Order titles, group titles and cross-references.
// After the import these live in the laws, law_parts, law_sections and law_orders tables.

export interface CuratedLaw {
  slug: string;
  title: { en: string; bn: string };
  description: { en: string; bn: string };
  actNo: { en: string; bn: string };
  year: number;
  type: "constitution" | "act" | "ordinance" | "po";
  status: "in-force" | "repealed";
  subject: string;
  sections?: number;
  unit: "sections" | "articles";
  orders?: number;
  views: number;
}

/** The hand-written laws: featured on the home page, with Bangla titles and descriptions. */
export const curatedLaws: CuratedLaw[] = [
  {
    slug: "constitution-1972",
    title: { en: "The Constitution of the People's Republic of Bangladesh", bn: "গণপ্রজাতন্ত্রী বাংলাদেশের সংবিধান" },
    description: { en: "The supreme law of the Republic.", bn: "প্রজাতন্ত্রের সর্বোচ্চ আইন।" },
    actNo: { en: "Adopted 4 Nov 1972", bn: "গৃহীত ৪ নভেম্বর ১৯৭২" },
    year: 1972,
    type: "constitution",
    status: "in-force",
    subject: "constitutional",
    sections: 153,
    unit: "articles",
    views: 98000,
  },
  {
    slug: "cpc-1908",
    title: { en: "The Code of Civil Procedure, 1908", bn: "দেওয়ানী কার্যবিধি, ১৯০৮" },
    description: {
      en: "An Act to consolidate and amend the laws relating to the procedure of the Courts of Civil Judicature.",
      bn: "দেওয়ানী আদালতের কার্যপদ্ধতি সংক্রান্ত আইন একীভূত ও সংশোধন করার জন্য প্রণীত আইন।",
    },
    actNo: { en: "Act No. V of 1908", bn: "১৯০৮ সনের ৫ নং আইন" },
    year: 1908,
    type: "act",
    status: "in-force",
    subject: "civil-procedure",
    sections: 158,
    unit: "sections",
    orders: 51,
    views: 124000,
  },
  {
    slug: "penal-code-1860",
    title: { en: "The Penal Code, 1860", bn: "দণ্ডবিধি, ১৮৬০" },
    description: {
      en: "An Act to provide a general Penal Code for Bangladesh.",
      bn: "বাংলাদেশের জন্য একটি সাধারণ দণ্ডবিধি প্রণয়নের আইন।",
    },
    actNo: { en: "Act No. XLV of 1860", bn: "১৮৬০ সনের ৪৫ নং আইন" },
    year: 1860,
    type: "act",
    status: "in-force",
    subject: "criminal",
    sections: 511,
    unit: "sections",
    views: 112000,
  },
  {
    slug: "crpc-1898",
    title: { en: "The Code of Criminal Procedure, 1898", bn: "ফৌজদারী কার্যবিধি, ১৮৯৮" },
    description: {
      en: "An Act to consolidate and amend the law relating to Criminal Procedure.",
      bn: "ফৌজদারী কার্যপদ্ধতি সংক্রান্ত আইন একীভূত ও সংশোধনের আইন।",
    },
    actNo: { en: "Act No. V of 1898", bn: "১৮৯৮ সনের ৫ নং আইন" },
    year: 1898,
    type: "act",
    status: "in-force",
    subject: "criminal",
    sections: 565,
    unit: "sections",
    views: 105000,
  },
  {
    slug: "evidence-act-1872",
    title: { en: "The Evidence Act, 1872", bn: "সাক্ষ্য আইন, ১৮৭২" },
    description: {
      en: "An Act to consolidate, define and amend the law of Evidence.",
      bn: "সাক্ষ্য সংক্রান্ত আইন একীভূত, সংজ্ঞায়িত ও সংশোধনের আইন।",
    },
    actNo: { en: "Act No. I of 1872", bn: "১৮৭২ সনের ১ নং আইন" },
    year: 1872,
    type: "act",
    status: "in-force",
    subject: "evidence",
    sections: 167,
    unit: "sections",
    views: 76000,
  },
  {
    slug: "contract-act-1872",
    title: { en: "The Contract Act, 1872", bn: "চুক্তি আইন, ১৮৭২" },
    description: {
      en: "An Act to define and amend certain parts of the law relating to contracts.",
      bn: "চুক্তি সংক্রান্ত আইনের কিছু অংশ সংজ্ঞায়িত ও সংশোধনের আইন।",
    },
    actNo: { en: "Act No. IX of 1872", bn: "১৮৭২ সনের ৯ নং আইন" },
    year: 1872,
    type: "act",
    status: "in-force",
    subject: "contract",
    sections: 238,
    unit: "sections",
    views: 54000,
  },
  {
    slug: "specific-relief-act-1877",
    title: { en: "The Specific Relief Act, 1877", bn: "সুনির্দিষ্ট প্রতিকার আইন, ১৮৭৭" },
    description: {
      en: "An Act to define and amend the law relating to certain kinds of specific relief.",
      bn: "কিছু ধরনের সুনির্দিষ্ট প্রতিকার সংক্রান্ত আইন সংজ্ঞায়িত ও সংশোধনের আইন।",
    },
    actNo: { en: "Act No. I of 1877", bn: "১৮৭৭ সনের ১ নং আইন" },
    year: 1877,
    type: "act",
    status: "in-force",
    subject: "civil-procedure",
    sections: 57,
    unit: "sections",
    views: 61000,
  },
  {
    slug: "transfer-of-property-act-1882",
    title: { en: "The Transfer of Property Act, 1882", bn: "সম্পত্তি হস্তান্তর আইন, ১৮৮২" },
    description: {
      en: "An Act to amend the law relating to the transfer of property by act of parties.",
      bn: "পক্ষগণের কার্য দ্বারা সম্পত্তি হস্তান্তর সংক্রান্ত আইন সংশোধনের আইন।",
    },
    actNo: { en: "Act No. IV of 1882", bn: "১৮৮২ সনের ৪ নং আইন" },
    year: 1882,
    type: "act",
    status: "in-force",
    subject: "property",
    sections: 137,
    unit: "sections",
    views: 48000,
  },
  {
    slug: "limitation-act-1908",
    title: { en: "The Limitation Act, 1908", bn: "তামাদি আইন, ১৯০৮" },
    description: {
      en: "An Act to consolidate and amend the law for the limitation of suits, and for other purposes.",
      bn: "মামলার তামাদি সংক্রান্ত আইন একীভূত ও সংশোধন এবং অন্যান্য উদ্দেশ্যে প্রণীত আইন।",
    },
    actNo: { en: "Act No. IX of 1908", bn: "১৯০৮ সনের ৯ নং আইন" },
    year: 1908,
    type: "act",
    status: "in-force",
    subject: "limitation",
    sections: 32,
    unit: "sections",
    views: 39000,
  },
  {
    slug: "registration-act-1908",
    title: { en: "The Registration Act, 1908", bn: "রেজিস্ট্রেশন আইন, ১৯০৮" },
    description: {
      en: "An Act to consolidate the enactments relating to the Registration of Documents.",
      bn: "দলিল নিবন্ধন সংক্রান্ত বিধানসমূহ একীভূত করার আইন।",
    },
    actNo: { en: "Act No. XVI of 1908", bn: "১৯০৮ সনের ১৬ নং আইন" },
    year: 1908,
    type: "act",
    status: "in-force",
    subject: "registration",
    sections: 93,
    unit: "sections",
    views: 33000,
  },
  {
    slug: "labour-act-2006",
    title: { en: "The Bangladesh Labour Act, 2006", bn: "বাংলাদেশ শ্রম আইন, ২০০৬" },
    description: {
      en: "An Act to amend and consolidate the laws relating to labour.",
      bn: "শ্রম সংক্রান্ত আইন সংশোধন ও একীভূত করার আইন।",
    },
    actNo: { en: "Act No. XLII of 2006", bn: "২০০৬ সনের ৪২ নং আইন" },
    year: 2006,
    type: "act",
    status: "in-force",
    subject: "labour",
    sections: 354,
    unit: "sections",
    views: 57000,
  },
  {
    slug: "digital-security-act-2018",
    title: { en: "The Digital Security Act, 2018", bn: "ডিজিটাল নিরাপত্তা আইন, ২০১৮" },
    description: {
      en: "An Act to ensure digital security and to prevent offences committed through digital devices.",
      bn: "ডিজিটাল নিরাপত্তা নিশ্চিতকরণ এবং ডিজিটাল মাধ্যমে সংঘটিত অপরাধ প্রতিরোধের আইন।",
    },
    actNo: { en: "Act No. XLVI of 2018", bn: "২০১৮ সনের ৪৬ নং আইন" },
    year: 2018,
    type: "act",
    status: "repealed",
    subject: "cyber",
    sections: 62,
    unit: "sections",
    views: 41000,
  },
  {
    slug: "muslim-family-laws-ordinance-1961",
    title: { en: "The Muslim Family Laws Ordinance, 1961", bn: "মুসলিম পারিবারিক আইন অধ্যাদেশ, ১৯৬১" },
    description: {
      en: "An Ordinance to give effect to certain recommendations of the Commission on Marriage and Family Laws.",
      bn: "বিবাহ ও পারিবারিক আইন কমিশনের কিছু সুপারিশ কার্যকর করার অধ্যাদেশ।",
    },
    actNo: { en: "Ordinance No. VIII of 1961", bn: "১৯৬১ সনের ৮ নং অধ্যাদেশ" },
    year: 1961,
    type: "ordinance",
    status: "in-force",
    subject: "family",
    sections: 13,
    unit: "sections",
    views: 52000,
  },
  {
    slug: "family-courts-ordinance-1985",
    title: { en: "The Family Courts Ordinance, 1985", bn: "পারিবারিক আদালত অধ্যাদেশ, ১৯৮৫" },
    description: {
      en: "An Ordinance to provide for the establishment of Family Courts.",
      bn: "পারিবারিক আদালত প্রতিষ্ঠার বিধান করার অধ্যাদেশ।",
    },
    actNo: { en: "Ordinance No. XVIII of 1985", bn: "১৯৮৫ সনের ১৮ নং অধ্যাদেশ" },
    year: 1985,
    type: "ordinance",
    status: "in-force",
    subject: "family",
    unit: "sections",
    views: 29000,
  },
  {
    slug: "bangladesh-bank-order-1972",
    title: { en: "The Bangladesh Bank Order, 1972", bn: "বাংলাদেশ ব্যাংক আদেশ, ১৯৭২" },
    description: {
      en: "An Order to provide for the establishment of the Bangladesh Bank.",
      bn: "বাংলাদেশ ব্যাংক প্রতিষ্ঠার বিধান করার আদেশ।",
    },
    actNo: { en: "President's Order No. 127 of 1972", bn: "১৯৭২ সনের ১২৭ নং রাষ্ট্রপতির আদেশ" },
    year: 1972,
    type: "po",
    status: "in-force",
    subject: "banking",
    unit: "sections",
    views: 18000,
  },
];

/** The CPC's First Schedule Orders: roman numeral, English title, Bangla title. */
export const cpcOrderTitles: [roman: string, en: string, bn: string][] = [
  ["I", "Parties to Suits", "মামলার পক্ষসমূহ"],
  ["II", "Frame of Suit", "মামলার কাঠামো"],
  ["III", "Recognized Agents and Pleaders", "স্বীকৃত প্রতিনিধি ও প্লিডার"],
  ["IV", "Institution of Suits", "মামলা দায়ের"],
  ["V", "Issue and Service of Summons", "সমন জারি ও প্রেরণ"],
  ["VI", "Pleadings Generally", "প্লিডিং — সাধারণ বিধান"],
  ["VII", "Plaint", "আরজি"],
  ["VIII", "Written Statement and Set-off", "লিখিত জবাব ও সেট-অফ"],
  ["IX", "Appearance of Parties and Consequence of Non-appearance", "পক্ষগণের হাজিরা ও অনুপস্থিতির পরিণাম"],
  ["X", "Examination of Parties by the Court", "আদালত কর্তৃক পক্ষগণের পরীক্ষা"],
  ["XI", "Discovery and Inspection", "উদ্ঘাটন ও পরিদর্শন"],
  ["XII", "Admissions", "স্বীকৃতি"],
  ["XIII", "Production, Impounding and Return of Documents", "দলিল দাখিল, আটক ও ফেরত"],
  [
    "XIV",
    "Settlement of Issues and Determination of Suit on Issues of Law or on Issues Agreed upon",
    "বিচার্য বিষয় নির্ধারণ এবং আইনগত বা সম্মত বিচার্য বিষয়ে মামলা নিষ্পত্তি",
  ],
  ["XV", "Disposal of the Suit at the First Hearing", "প্রথম শুনানিতে মামলা নিষ্পত্তি"],
  ["XVI", "Summoning and Attendance of Witnesses", "সাক্ষীদের তলব ও হাজিরা"],
  ["XVII", "Adjournments", "মুলতবি"],
  ["XVIII", "Hearing of the Suit and Examination of Witnesses", "মামলার শুনানি ও সাক্ষীদের জবানবন্দি"],
  ["XIX", "Affidavits", "হলফনামা"],
  ["XX", "Judgment and Decree", "রায় ও ডিক্রি"],
  ["XXI", "Execution of Decrees and Orders", "ডিক্রি ও আদেশ জারি"],
  ["XXII", "Death, Marriage and Insolvency of Parties", "পক্ষগণের মৃত্যু, বিবাহ ও দেউলিয়াত্ব"],
  ["XXIII", "Withdrawal and Adjustment of Suits", "মামলা প্রত্যাহার ও আপস-মীমাংসা"],
  ["XXIV", "Payment into Court", "আদালতে অর্থ জমা"],
  ["XXV", "Security for Costs", "খরচের জামানত"],
  ["XXVI", "Commissions", "কমিশন"],
  [
    "XXVII",
    "Suits by or against the Government or Public Officers in their Official Capacity",
    "সরকার বা সরকারি কর্মকর্তার দাপ্তরিক ক্ষমতায় বা বিরুদ্ধে মামলা",
  ],
  [
    "XXVIIA",
    "Suits involving any Substantial Question as to the Interpretation of Constitutional Law",
    "সংবিধানের ব্যাখ্যা সংক্রান্ত গুরুত্বপূর্ণ প্রশ্নযুক্ত মামলা",
  ],
  [
    "XXVIII",
    "Suits by or against Military or Naval Men or Airmen",
    "সামরিক, নৌ বা বিমান বাহিনীর সদস্যদের দ্বারা বা বিরুদ্ধে মামলা",
  ],
  ["XXIX", "Suits by or against Corporations", "কর্পোরেশনের দ্বারা বা বিরুদ্ধে মামলা"],
  [
    "XXX",
    "Suits by or against Firms and Persons Carrying on Business in Names other than their own",
    "ফার্ম ও অন্য নামে ব্যবসা পরিচালনাকারী ব্যক্তির দ্বারা বা বিরুদ্ধে মামলা",
  ],
  [
    "XXXI",
    "Suits by or against Trustees, Executors and Administrators",
    "ট্রাস্টি, নির্বাহক ও প্রশাসকের দ্বারা বা বিরুদ্ধে মামলা",
  ],
  [
    "XXXII",
    "Suits by or against Minors and Persons of Unsound Mind",
    "নাবালক ও অপ্রকৃতিস্থ ব্যক্তির দ্বারা বা বিরুদ্ধে মামলা",
  ],
  ["XXXIII", "Suits by Paupers", "নিঃস্ব ব্যক্তির মামলা"],
  ["XXXIV", "Suits relating to Mortgages of Immovable Property", "স্থাবর সম্পত্তির বন্ধক সংক্রান্ত মামলা"],
  ["XXXV", "Interpleader", "ইন্টারপ্লিডার"],
  ["XXXVI", "Special Case", "বিশেষ মামলা"],
  ["XXXVII", "Summary Procedure on Negotiable Instruments", "হস্তান্তরযোগ্য দলিলের ক্ষেত্রে সংক্ষিপ্ত পদ্ধতি"],
  ["XXXVIII", "Arrest and Attachment before Judgment", "রায়ের পূর্বে গ্রেফতার ও ক্রোক"],
  ["XXXIX", "Temporary Injunctions and Interlocutory Orders", "অস্থায়ী নিষেধাজ্ঞা ও অন্তর্বর্তীকালীন আদেশ"],
  ["XL", "Appointment of Receivers", "রিসিভার নিয়োগ"],
  ["XLI", "Appeals from Original Decrees", "মূল ডিক্রির বিরুদ্ধে আপিল"],
  ["XLII", "Appeals from Appellate Decrees", "আপিল ডিক্রির বিরুদ্ধে আপিল"],
  ["XLIII", "Appeals from Orders", "আদেশের বিরুদ্ধে আপিল"],
  ["XLIV", "Pauper Appeals", "নিঃস্ব ব্যক্তির আপিল"],
  ["XLV", "Appeals to the Appellate Division", "আপিল বিভাগে আপিল"],
  ["XLVI", "Reference", "রেফারেন্স"],
  ["XLVII", "Review", "রিভিউ"],
  ["XLVIII", "Miscellaneous", "বিবিধ"],
  ["XLIX", "High Court Division", "হাইকোর্ট বিভাগ"],
  ["L", "Small Cause Courts", "স্মল কজ কোর্ট"],
  ["LI", "Presidency Small Cause Courts (omitted)", "প্রেসিডেন্সি স্মল কজ কোর্ট (বিলুপ্ত)"],
];

/** Bangla titles of the CPC's section groups (ids from the reader's cpc-sections.json). */
export const cpcGroupTitlesBn: Record<string, string> = {
  preliminary: "প্রারম্ভিক",
  "part-1-jurisdiction-of-the-courts": "প্রথম খণ্ড — আদালতের এখতিয়ার ও রেস জুডিকাটা",
  "part-1-place-of-suing": "প্রথম খণ্ড — মামলা দায়েরের স্থান",
  "part-1-institution-of-suits": "প্রথম খণ্ড — মামলা দায়ের",
  "part-1-summons-and-discovery": "প্রথম খণ্ড — সমন ও উদ্ঘাটন",
  "part-1-judgment-and-decree": "প্রথম খণ্ড — রায় ও ডিক্রি",
  "part-1-interest": "প্রথম খণ্ড — সুদ",
  "part-1-costs": "প্রথম খণ্ড — খরচ",
  "part-2-general": "দ্বিতীয় খণ্ড — সাধারণ",
  "part-2-courts-by-which-decrees": "দ্বিতীয় খণ্ড — যেসব আদালত ডিক্রি জারি করতে পারে",
  "part-2-limit-of-time-for": "দ্বিতীয় খণ্ড — জারির সময়সীমা",
  "part-2-transferees-and-legal-representatives": "দ্বিতীয় খণ্ড — হস্তান্তরগ্রহীতা ও আইনগত প্রতিনিধি",
  "part-2-procedure-in-execution": "দ্বিতীয় খণ্ড — জারির পদ্ধতি",
  "part-2-arrest-and-detention": "দ্বিতীয় খণ্ড — গ্রেফতার ও আটক",
  "part-2-attachment": "দ্বিতীয় খণ্ড — ক্রোক",
  "part-2-sale": "দ্বিতীয় খণ্ড — বিক্রয়",
  "part-2-delegation-to-collector-of": "দ্বিতীয় খণ্ড — স্থাবর সম্পত্তির বিরুদ্ধে ডিক্রি জারির ক্ষমতা কালেক্টরকে অর্পণ",
  "part-2-distribution-of-assets": "দ্বিতীয় খণ্ড — পরিসম্পদ বণ্টন",
  "part-2-resistance-to-execution": "দ্বিতীয় খণ্ড — জারিতে বাধা",
  "part-3-commissions": "তৃতীয় খণ্ড — কমিশন",
  "part-4-suits-by-or-against": "চতুর্থ খণ্ড — সরকার বা সরকারি কর্মকর্তার দাপ্তরিক ক্ষমতায় তাদের দ্বারা বা বিরুদ্ধে মামলা",
  "part-4-suits-by-aliens-and": "চতুর্থ খণ্ড — বিদেশি এবং বিদেশি শাসক, রাষ্ট্রদূত ও দূতদের দ্বারা বা বিরুদ্ধে মামলা",
  "part-4-suits-against-rulers-of": "চতুর্থ খণ্ড — যোগদানকারী ও একীভূত রাজ্যের শাসকদের বিরুদ্ধে মামলা",
  "part-4-interpleader": "চতুর্থ খণ্ড — স্বত্ব-নির্ধারণী মামলা",
  "part-5-alternative-dispute-resolution": "পঞ্চম খণ্ড — বিকল্প বিরোধ নিষ্পত্তি",
  "part-5-special-case": "পঞ্চম খণ্ড — বিশেষ মামলা",
  "part-5-suits-relating-to-public": "পঞ্চম খণ্ড — জনস্বার্থ সংক্রান্ত মামলা",
  "part-6": "ষষ্ঠ খণ্ড — সম্পূরক কার্যধারা",
  "part-7-appeals-from-original-decrees": "সপ্তম খণ্ড — মূল ডিক্রির বিরুদ্ধে আপিল",
  "part-7-appeals-from-appellate-decrees": "সপ্তম খণ্ড — আপিল ডিক্রির বিরুদ্ধে আপিল",
  "part-7-appeals-from-orders": "সপ্তম খণ্ড — আদেশের বিরুদ্ধে আপিল",
  "part-7-general-provisions-relating-to": "সপ্তম খণ্ড — আপিল সংক্রান্ত সাধারণ বিধানাবলি",
  "part-7-appeals-to-the-appellate": "সপ্তম খণ্ড — আপিল বিভাগে আপিল",
  "part-8": "অষ্টম খণ্ড — রেফারেন্স, রিভিউ ও রিভিশন",
  "part-9": "নবম খণ্ড — হাইকোর্ট বিভাগ সংক্রান্ত বিশেষ বিধানাবলি",
  "part-10": "দশম খণ্ড — বিধিমালা",
  "part-11": "একাদশ খণ্ড — বিবিধ",
};

/** Editorial cross-references between CPC sections, shown in the "Related sections" rail. */
export const cpcRelated: Record<string, string[]> = {
  "1": ["2", "3"],
  "2": ["1"],
  "3": ["15", "24"],
  "6": ["9", "15"],
  "9": ["10", "11", "15"],
  "10": ["9", "11"],
  "11": ["10", "12"],
  "12": ["11"],
  "13": ["14"],
  "14": ["13"],
  "15": ["6", "16", "20"],
  "94": ["95", "151"],
  "95": ["94"],
  "151": ["94", "9"],
};

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };

/** "XXXIX" → "39", "XXVIIA" → "27A" (the ids used in URLs: /order-39). */
export function orderIdOf(roman: string) {
  const letters = roman.replace(/A$/, "");
  let total = 0;
  for (let i = 0; i < letters.length; i++) {
    const v = ROMAN[letters[i]!]!;
    total += v < (ROMAN[letters[i + 1] ?? ""] ?? 0) ? -v : v;
  }
  return `${total}${roman.endsWith("A") ? "A" : ""}`;
}
