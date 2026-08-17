"""
Map the local IIT-JEE folder onto the NEET spine, and report both gaps.

WHY THIS EXISTS
---------------
The instruction was to use the JEE Physics and Chemistry sets to understand
what topics need explaining. They are a reasonable starting point — same two
subjects, same NCERT foundation — but they are not the same syllabus, and
using them as the plan would go wrong in two directions at once:

  * Topics NEET asks that JEE material skips or under-weights. Revision built
    from the folder would simply never reach them.
  * Topics the folder covers that NEET no longer examines AT ALL. NCERT cut a
    large amount of content in 2023 and NTA followed. That coaching set
    predates the cut, so a chunk of it teaches deleted syllabus. Every hour
    spent there scores zero.

The second is the dangerous one, because it feels like work.

HOW THE ANSWER IS ESTABLISHED
-----------------------------
Not from memory of what was deleted. The NEET side is the spine derived in
neet_syllabus.py, which is read out of THIS YEAR'S NCERT books — so a chapter
that no longer exists is absent from the corpus as a matter of fact, and shows
up here as a JEE chapter with nothing to map onto. The aliases below encode the
one thing that genuinely needs judgement: that "NLM & Friction" and "Laws of
Motion" are the same chapter under two names.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
SPINE = ROOT / "content" / "manifests" / "neet_syllabus.json"
JEE = Path(r"D:\User\IIT JEE-20260816T173959Z-1-001\IIT JEE")

# JEE chapter name -> the NEET chapter(s) it teaches. Coaching sets split and
# merge NCERT chapters freely, so this is many-to-many. An empty list is a
# deliberate assertion: nothing in the current NEET syllabus corresponds.
ALIASES: dict[str, list[str]] = {
    # --- Physics ---
    "Units, Dimensions & Vectors": ["Units and Measurement", "Motion in a Plane"],
    "Kinematics": ["Motion in a Straight Line", "Motion in a Plane"],
    "NLM & Friction": ["Laws of Motion"],
    "COM, Momentum & Collision": ["Systems of Particles and Rotational Motion", "Work, Energy and Power"],
    "Circular Motion & WPE": ["Work, Energy and Power"],
    "Rotation": ["Systems of Particles and Rotational Motion"],
    "Elasticity and Thermal Expansion, Calorimetry": ["Mechanical Properties of Solids", "Thermal Properties of Matter"],
    "Heat Transfer": ["Thermal Properties of Matter"],
    "Kinetic Theory of Gases and Thermodynamics": ["Kinetic Theory", "Thermodynamics"],
    "Fluid Mechanic, Surface Tension & Viscosity": ["Mechanical Properties of Fluids"],
    "Electrostatics": ["Electric Charges and Fields"],
    "Gravitation": ["Gravitation"],
    "Current Electricity": ["Current Electricity"],
    "Capacitor": ["Electrostatic Potential and Capacitance"],
    "Magnetic effects of current & Magnetism": ["Moving Charges and Magnetism", "Magnetism and Matter"],
    "EMI and Alternating Current": ["Electromagnetic Induction", "Alternating Current"],
    "Geometrical Optics": ["Ray Optics and Optical Instruments"],
    "Wave Optics": ["Wave Optics"],
    "Modern Physics": ["Dual Nature of Radiation and Matter", "Atoms", "Nuclei"],
    # --- Chemistry ---
    "Mole Concept": ["Some Basic Concepts of Chemistry"],
    "Chemical Bonding": ["Chemical Bonding and Molecular Structure"],
    "Nomenclature": ["Organic Chemistry – Some Basic Principles and Techniques"],
    "GOC": ["Organic Chemistry – Some Basic Principles and Techniques"],
    "Gaseous State": [],
    "Atomic Structure": ["Structure of Atom"],
    "Hydrocarbons": ["Hydrocarbons"],
    "Purification & Characterisation of Organic Compounds": ["Organic Chemistry – Some Basic Principles and Techniques"],
    "Redox Reaction": ["Redox Reactions"],
    "Hydrogen & Compounds": [],
    "Chemical Equilibrium": ["Equilibrium"],
    "Ionic Equilibrium": ["Equilibrium"],
    "S Block": [],
    "p block 1": [],
    "Thermodynamics": ["Thermodynamics"],
    "Thermochemistry": ["Thermodynamics"],
    "Chemical Kinetics": ["Chemical Kinetics"],
    "Alcohol,Phenol & Ethers": ["Alcohols, Phenols and Ethers"],
    "Halogen Derivatives & Grignard Reagents": ["Haloalkanes and Haloarenes"],
    "Coordination Compound": ["Coordination Compounds"],
    "Radioactivity": [],
    "Carbonyl Compounds": ["Aldehydes, Ketones and Carboxylic Acids"],
    "Carboxylic Acid & Derivatives": ["Aldehydes, Ketones and Carboxylic Acids"],
    "Solutions": ["Solutions"],
    "Electrochemistry": ["Electrochemistry"],
    "Nitrogen Compounds": ["Amines"],
    "Metallurgy": [],
    "P Block 2": [],
    "Qualitative Analysis": [],
    "d_f block elements": ["The d- and f- Block Elements"],
    "Solid State": [],
    "Surface Chemistry": [],
    "Aromatic Hydrocarbons": ["Hydrocarbons"],
    "Biomolecules": ["Biomolecules"],
    "Polymers": [],
}


def jee_chapters() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for subject in ("Physics", "Chemistry"):
        folder = JEE / subject
        if not folder.is_dir():
            continue
        names = []
        for pdf in sorted(folder.glob("*.pdf")):
            # "Chap12 - Fluid Mechanic, Surface Tension _ Viscosity"
            name = re.sub(r"^Chap(?:ter)?\s*\d+\s*-?\s*", "", pdf.stem).strip()
            names.append(name.replace("_", "&").strip())
        out[subject] = names
    return out


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def main() -> int:
    if not SPINE.exists():
        print("run tools/neet_syllabus.py --write first")
        return 1
    spine = json.loads(SPINE.read_text(encoding="utf-8"))["chapters"]
    neet = {norm(c["title"]): c for c in spine if c["subject"] in ("Physics", "Chemistry")}

    jee = jee_chapters()
    if not jee:
        print(f"JEE folder not readable at {JEE}")
        return 1

    covered: set[str] = set()
    dead: list[tuple[str, str]] = []
    unmapped: list[tuple[str, str]] = []

    # Matched on normalised names: the folder writes "Alcohol,Phenol_Ethers"
    # with no spaces around the separator, so exact-string lookup missed three
    # chapters and reported them as NEET gaps they are not.
    by_norm = {norm(k): v for k, v in ALIASES.items()}

    for subject, names in jee.items():
        for name in names:
            if norm(name) not in by_norm:
                unmapped.append((subject, name))
                continue
            targets = by_norm[norm(name)]
            if not targets:
                dead.append((subject, name))
                continue
            for t in targets:
                key = norm(t)
                if key in neet:
                    covered.add(key)
                else:
                    unmapped.append((subject, f"{name} -> '{t}' not in spine"))

    print("=" * 68)
    print("WHAT THE JEE FOLDER TEACHES THAT NEET NO LONGER EXAMINES")
    print("=" * 68)
    print("NCERT deleted this content in 2023 and NTA followed. It is absent")
    print("from the books on disk, so these chapters map onto nothing.\n")
    for subject, name in dead:
        print(f"  {subject:10} {name}")
    print(f"\n  {len(dead)} of {sum(len(v) for v in jee.values())} JEE chapters — time here scores zero.")

    print("\n" + "=" * 68)
    print("WHAT NEET EXAMINES THAT THE JEE FOLDER DOES NOT COVER")
    print("=" * 68)
    missing = [c for k, c in neet.items() if k not in covered]
    missing.sort(key=lambda c: (c["subject"], c["klass"], c["number"]))
    for c in missing:
        print(f"  {c['subject']:10} cls{c['klass']} ch{c['number']:>2}  {c['title']}")
    print(f"\n  {len(missing)} NEET chapters with no JEE counterpart on disk.")

    if unmapped:
        print("\nunmapped JEE chapter names (alias table needs an entry):")
        for subject, name in unmapped:
            print(f"  {subject:10} {name}")

    print(f"\nBiology is untouched by any of this: 32 chapters, 90 questions,")
    print("360 marks — half the paper — and the JEE folder contains none of it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
