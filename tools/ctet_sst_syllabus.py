"""
The official CTET Paper II Social Studies syllabus — the topic taxonomy.

WHY THIS IS TRANSCRIBED, NOT INVENTED
-------------------------------------
Every topic below is copied from CBSE's own September 2026 information bulletin
(content/raw/ctet/official/ctet_sep2026_information_bulletin.pdf, pp. 13-14).
Not a coaching site's topic list, not my summary of the subject — the list the
board publishes and sets the paper against.

That matters because the whole point of tagging questions to topics is to tell
her what to revise. A taxonomy that does not match the board's would send her
revision somewhere the paper will not go.

THE SPLIT MOST CANDIDATES MISS
------------------------------
Her 60 Social Studies questions are NOT 60 questions of history and geography:

    Content              40 questions   History / Geography / Social & Political Life
    Pedagogical issues   20 questions   how the subject is TAUGHT and assessed

A third of the section is pedagogy. It is also the most liftable third, because
it rewards method rather than recall — and it is the part a candidate revising
"the syllabus" tends to skip.

ALIASES
-------
Each topic carries the words a question would actually use. "The Revolt of
1857-58" is rarely named in a stem; the stem says "sepoy", "Mangal Pandey",
"Rani Lakshmibai", "1857". Aliases are what make deterministic tagging possible
without a model.

They are deliberately SPECIFIC. A vague alias ("India", "people") would match
half the paper and file questions under the wrong topic, which is worse than
leaving them untagged: a wrong topic sends her revision in the wrong direction
with false confidence.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Topic:
    id: str
    strand: str          # History | Geography | Social and Political Life | Pedagogy
    name: str            # exactly as printed in the bulletin
    aliases: tuple[str, ...] = field(default=())


# ── Content: History (bulletin p.13) ──────────────────────────────────────────
HISTORY = [
    Topic("hist_when_where_how", "History", "When, Where and How",
          ("archaeolog", "manuscript", "inscription", "source of history", "dating",
           "how do we know", "historian")),
    Topic("hist_earliest_societies", "History", "The Earliest Societies",
          ("hunter", "gatherer", "palaeolithic", "paleolithic", "mesolithic",
           "stone age", "bhimbetka", "earliest people")),
    Topic("hist_first_farmers", "History", "The First Farmers and Herders",
          ("neolithic", "domestication", "mehrgarh", "first farmer", "herder",
           "agriculture began", "burzahom")),
    Topic("hist_first_cities", "History", "The First Cities",
          ("harappa", "mohenjo", "indus valley", "citadel", "great bath",
           "dholavira", "lothal", "kalibangan")),
    Topic("hist_early_states", "History", "Early States",
          ("janapada", "mahajanapada", "magadha", "vajji", "bimbisara", "ajatasattu")),
    Topic("hist_new_ideas", "History", "New Ideas",
          ("buddha", "buddhism", "jainism", "mahavira", "upanishad", "ahimsa",
           "sangha", "nirvana", "vardhamana")),
    Topic("hist_first_empire", "History", "the first Empire",
          ("mauryan", "ashoka", "chandragupta maurya", "arthashastra", "kautilya",
           "megasthenes", "dhamma")),
    Topic("hist_distant_lands", "History", "Contacts with Distant lands",
          ("silk route", "roman", "trade route", "sangam", "muziris",
           "distant land", "maritime trade",
           "punch marked", "punch-marked", "northern black polished", "glazed pottery")),
    Topic("hist_political_developments", "History", "Political Developments",
          ("gupta", "samudragupta", "harshavardhana", "prashasti", "pallava",
           "chalukya")),
    Topic("hist_culture_science", "History", "Culture and Science",
          ("aryabhata", "sushruta", "charaka", "ajanta", "iron pillar")),
    Topic("hist_new_kings", "History", "New Kings and Kingdoms",
          ("chola", "rashtrakuta", "tripartite", "samanta", "rajendra",
           "brihadeshvara", "prashasti of kings",
           "kadamba", "mayurasharman", "chera", "pandya", "satavahana")),
    Topic("hist_sultans_delhi", "History", "Sultans of Delhi",
          ("sultanate", "iltutmish", "razia", "alauddin", "khalji", "tughlaq",
           "iqta", "delhi sultan", "muhammad bin")),
    Topic("hist_architecture", "History", "Architecture",
          ("temple architecture", "stupa", "qutb", "dome",
           "shikhara", "garbhagriha", "monument")),
    Topic("hist_creation_empire", "History", "Creation of an Empire",
          ("mughal", "akbar", "babur", "aurangzeb", "jahangir", "shah jahan",
           "mansabdar", "zabt", "sulh")),
    Topic("hist_social_change", "History", "Social Change",
          ("varna", "jati", "caste hierarchy", "tribe", "nomad", "banjara",
           "social change")),
    Topic("hist_regional_cultures", "History", "Regional Cultures",
          ("kathak", "miniature", "regional language", "bhakti", "sufi",
           "kabir", "mirabai", "guru nanak", "manipuri")),
    Topic("hist_company_power", "History", "The Establishment of Company Power",
          ("east india company", "plassey", "buxar", "diwani", "subsidiary alliance",
           "doctrine of lapse", "robert clive", "dalhousie")),
    Topic("hist_rural_life", "History", "Rural Life and Society",
          ("permanent settlement", "ryotwari", "mahalwari", "indigo",
           "santhal", "zamindar", "peasant", "revenue system")),
    Topic("hist_tribal_societies", "History", "Colonialism and Tribal Societies",
          ("birsa", "tribal", "forest law", "shifting cultivation", "jhum",
           "adivasi", "munda")),
    Topic("hist_revolt_1857", "History", "The Revolt of 1857-58",
          ("1857", "sepoy", "mangal pandey", "rani lakshmibai", "bahadur shah",
           "meerut", "revolt of", "first war of independence")),
    Topic("hist_women_reform", "History", "Women and reform",
          ("sati", "widow remarriage", "raja ram mohan", "vidyasagar",
           "women's education", "pandita ramabai", "phule",
           "rammohan", "ram mohan", "brahmo", "reform association", "social reformer")),
    Topic("hist_caste_system", "History", "Challenging the Caste System",
          ("ambedkar", "jyotirao", "jyotiba", "satyashodhak", "periyar",
           "untouchab", "caste system", "dalit")),
    Topic("hist_nationalist_movement", "History", "The Nationalist Movement",
          ("congress", "gandhi", "swadeshi", "non-cooperation", "civil disobedience",
           "quit india", "salt march", "dandi", "jallianwala", "partition of bengal",
           "freedom struggle", "national movement", "satyagraha")),
    Topic("hist_after_independence", "History", "India After Independence",
          ("after independence", "linguistic state", "five year plan",
           "integration of princely", "constituent assembly", "1947")),
]

# ── Content: Geography (bulletin p.13) ────────────────────────────────────────
GEOGRAPHY = [
    Topic("geo_as_social_study", "Geography", "Geography as a social study and as a science",
          ("geography as", "branch of geography", "study of geography")),
    Topic("geo_planet_earth", "Geography", "Planet: Earth in the solar system",
          ("solar system", "planet", "orbit", "rotation",
           "leap year", "asteroid", "satellite", "moon")),
    Topic("geo_globe", "Geography", "Globe",
          ("latitude", "longitude", "meridian", "equator", "tropic",
           "globe", "time zone", "greenwich", "standard time",
           "map", "maps", "cartograph", "scale of a map", "contour")),
    Topic("geo_environment", "Geography", "Environment in its totality: natural and human environment",
          ("ecosystem", "biosphere", "lithosphere", "natural environment",
           "human environment", "domain of the earth",
           "rock cycle", "igneous", "sedimentary", "metamorphic", "landform", "earthquake", "volcano")),
    Topic("geo_air", "Geography", "Air",
          ("troposphere", "weather", "climate", "humidity",
           "wind", "monsoon", "air pressure",
           "temperature on earth", "distribution of temperature", "insolation", "isotherm")),
    Topic("geo_water", "Geography", "Water",
          ("ocean", "tide", "wave", "current", "hydrosphere", "water cycle",
           "river", "glacier")),
    Topic("geo_human_environment", "Geography", "Human Environment: settlement, transport and communication",
          ("settlement", "transport", "communication", "rural settlement",
           "urban settlement", "roadway", "railway")),
    Topic("geo_resources", "Geography", "Resources: Types-Natural and Human",
          ("resource", "renewable", "non-renewable", "conservation",
           "human resource", "natural resource")),
    Topic("geo_agriculture", "Geography", "Agriculture",
          ("agriculture", "crop", "kharif", "rabi", "subsistence farming",
           "plantation", "horticulture", "cultivation")),
]

# ── Content: Social and Political Life (bulletin pp.13-14) ────────────────────
SPL = [
    Topic("spl_diversity", "Social and Political Life", "Diversity",
          ("diversity", "prejudice", "stereotype", "discrimination", "inequality")),
    Topic("spl_government", "Social and Political Life", "Government",
          ("government", "levels of government", "key elements")),
    Topic("spl_local_government", "Social and Political Life", "Local Government",
          ("panchayat", "gram sabha", "municipal", "ward", "sarpanch",
           "local government", "patwari")),
    Topic("spl_making_a_living", "Social and Political Life", "Making a Living",
          ("livelihood", "making a living", "urban livelihood", "rural livelihood")),
    Topic("spl_democracy", "Social and Political Life", "Democracy",
          ("democracy", "democratic", "universal adult franchise", "election",
           "voting", "representative")),
    Topic("spl_state_government", "Social and Political Life", "State Government",
          ("state government", "mla", "legislative assembly", "chief minister",
           "governor")),
    Topic("spl_media", "Social and Political Life", "Understanding Media",
          ("mass media", "role of media", "television", "advertis", "journalis")),
    Topic("spl_gender", "Social and Political Life", "Unpacking Gender",
          ("gender", "unpaid work", "women's work", "stereotype about girl")),
    Topic("spl_constitution", "Social and Political Life", "The Constitution",
          ("constitution", "fundamental right", "preamble", "directive principle",
           "secular", "amendment", "fundamental duty",
           "constituent assembly", "right to equality", "right to freedom")),
    Topic("spl_parliament", "Social and Political Life", "Parliamentary Government",
          ("parliament", "lok sabha", "rajya sabha", "prime minister",
           "council of ministers", "opposition")),
    Topic("spl_judiciary", "Social and Political Life", "The Judiciary",
          ("judiciary", "supreme court", "high court", "judge", "fir",
           "public interest litigation", "judicial")),
    Topic("spl_social_justice", "Social and Political Life", "Social Justice and the Marginalised",
          ("marginalis", "marginaliz", "scheduled tribe", "scheduled caste",
           "minority", "social justice", "manual scaveng")),
]

# ── Pedagogical issues — 20 of her 60 marks (bulletin p.14) ───────────────────
PEDAGOGY = [
    Topic("ped_concept_nature", "Pedagogy", "Concept & Nature of Social Science/Social Studies",
          ("nature of social science", "concept of social", "why teach social",
           "aim of teaching social", "objective of social science")),
    Topic("ped_classroom_processes", "Pedagogy", "Class Room Processes, activities and discourse",
          ("classroom process", "class room", "group work", "discussion",
           "activity in the class", "discourse", "role play")),
    Topic("ped_critical_thinking", "Pedagogy", "Developing Critical thinking",
          ("critical thinking", "reflective", "reasoning skill", "higher order")),
    Topic("ped_enquiry_evidence", "Pedagogy", "Enquiry/Empirical Evidence",
          ("enquiry", "inquiry", "empirical", "evidence-based", "hypothesis")),
    Topic("ped_problems_teaching", "Pedagogy", "Problems of teaching Social Science/Social Studies",
          ("problem of teaching", "difficulty in teaching", "challenge in teaching",
           "misconception")),
    Topic("ped_sources", "Pedagogy", "Sources- Primary & Secondary",
          ("primary source", "secondary source", "source material",
           "primary and secondary", "source-based", "archival")),
    Topic("ped_project_work", "Pedagogy", "Projects Work",
          ("project work", "field trip", "field visit", "survey by student")),
    Topic("ped_evaluation", "Pedagogy", "Evaluation",
          ("evaluation", "assessment", "rubric", "portfolio", "formative",
           "summative", "cce", "feedback to student",
           "open-ended question", "weightage", "question paper", "marking scheme", "blueprint of a")),
]

TOPICS: list[Topic] = HISTORY + GEOGRAPHY + SPL + PEDAGOGY
BY_ID = {t.id: t for t in TOPICS}

# The board's own split of the 60-mark section.
SECTION_SPLIT = {"Content": 40, "Pedagogy": 20}

CONTENT_STRANDS = ("History", "Geography", "Social and Political Life")


def strand_of(topic_id: str) -> str | None:
    t = BY_ID.get(topic_id)
    return t.strand if t else None


if __name__ == "__main__":
    import sys

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    from collections import Counter

    print(f"{len(TOPICS)} topics from the official CTET Sep-2026 bulletin\n")
    for strand, n in Counter(t.strand for t in TOPICS).most_common():
        print(f"  {strand:28} {n} topics")
    print(f"\nsection split: {SECTION_SPLIT} (of 60 Social Studies questions)")
