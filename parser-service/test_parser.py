"""Quick test to verify the grouped parsing logic works correctly."""
import sys
sys.path.insert(0, ".")

from parsers.mapper import parse_cell_to_entries, display_faculty, find_period_info

print("=" * 60)
print("PARSER TEST SUITE")
print("=" * 60)

passed = 0
failed = 0

def test(name, actual, expected):
    global passed, failed
    if actual == expected:
        print(f"  ✅ {name}")
        passed += 1
    else:
        print(f"  ❌ {name}")
        print(f"     Expected: {expected}")
        print(f"     Got:      {actual}")
        failed += 1


# ── Test 1: Compact format "SUBJECT FACULTY_CODE ROOM" ──
print("\n── Test 1: Compact format parsing ──")
result = parse_cell_to_entries("PM KVT 309")
test("Compact: 1 entry", len(result), 1)
if result:
    test("Compact: subject=PM", result[0]["subject"], "PM")
    test("Compact: faculty=FC:KVT", result[0]["faculty"], "FC:KVT")
    test("Compact: room=309", result[0]["room"], "309")

# ── Test 2: Multi-word subject compact format ──
print("\n── Test 2: Multi-word subject compact ──")
result = parse_cell_to_entries("POC II AAN 201 A")
test("Multi-word: 1 entry", len(result), 1)
if result:
    test("Multi-word: subject=POC II", result[0]["subject"], "POC II")
    test("Multi-word: faculty=FC:AAN", result[0]["faculty"], "FC:AAN")
    test("Multi-word: room=201 A", result[0]["room"], "201 A")

# ── Test 3: Formal format (title-based) ──
print("\n── Test 3: Formal format parsing ──")
result = parse_cell_to_entries("HAPP-I (BP101T)\nMs. Jahnavi Soni\nRoom 302")
test("Formal: 1 entry", len(result), 1)
if result:
    test("Formal: faculty has title", result[0]["faculty"], "Ms. Jahnavi Soni")
    test("Formal: room=302", result[0]["room"], "302")

# ── Test 4: Lab cell with 2 batches ──
print("\n── Test 4: Lab cell with batches ──")
result = parse_cell_to_entries("Batch A: Pharma Chem Lab\nDr. Smith\nLab 201\nBatch B: Pharmacognosy\nMs. Patel\nLab 202")
test("Lab: 2 entries", len(result), 2)
if len(result) >= 2:
    test("Lab batch A", result[0]["batch"], "A")
    test("Lab batch B", result[1]["batch"], "B")
    test("Lab A faculty", result[0]["faculty"], "Dr. Smith")
    test("Lab B faculty", result[1]["faculty"], "Ms. Patel")

# ── Test 5: Recess cell → 0 entries ──
print("\n── Test 5: Recess ──")
result = parse_cell_to_entries("RECESS")
test("Recess: 0 entries", len(result), 0)

# ── Test 6: Empty cell → 0 entries ──
print("\n── Test 6: Empty cell ──")
result = parse_cell_to_entries("")
test("Empty: 0 entries", len(result), 0)

# ── Test 7: Simple single-word cell ──
print("\n── Test 7: Simple cell ──")
result = parse_cell_to_entries("Mathematics")
test("Simple: 1 entry", len(result), 1)
if result:
    test("Simple: subject=Mathematics", result[0]["subject"], "Mathematics")

# ── Test 8: FC: prefix display stripping ──
print("\n── Test 8: FC: display stripping ──")
test("FC:KVT → KVT", display_faculty("FC:KVT"), "KVT")
test("Ms. Soni → Ms. Soni", display_faculty("Ms. Soni"), "Ms. Soni")
test("None → empty", display_faculty(None), "")

# ── Test 9: Subject code detection ──
print("\n── Test 9: Subject code detection ──")
result = parse_cell_to_entries("HAPP-I (BP101T)")
if result:
    test("BP101T detected", result[0]["subject_code"], "BP101T")

# ── Test 10: Flexible time detection ──
print("\n── Test 10: Flexible time detection ──")
test("9:30 → period 0", find_period_info("9:30")["period"], 0)
test("09:30 → period 0", find_period_info("09:30")["period"], 0)
test("9.30 → period 0", find_period_info("9.30")["period"], 0)
test("10:30-11:30 → period 1", find_period_info("10:30-11:30")["period"], 1)
test("01:30 → period 3", find_period_info("01:30")["period"], 3)
test("1:30 → period 3", find_period_info("1:30")["period"], 3)
test("02:30 → period 4", find_period_info("02:30")["period"], 4)
test("None → None", find_period_info(None), None)
test("Empty → None", find_period_info(""), None)

# ── Test 11: All imports work ──
print("\n── Test 11: Import chain ──")
from parsers.docx_parser import parse_docx
from parsers.pdf_parser import parse_pdf
test("docx_parser imports OK", True, True)
test("pdf_parser imports OK", True, True)

# ── Test 12: Parsing score calculation ──
print("\n── Test 12: Parsing score calculation ──")
sys.path.insert(0, ".")
from main import calculate_parsing_score, calculate_overall_score

perfect_entry = {
    "day": "Monday",
    "period": 0,
    "start_time": "09:30:00",
    "end_time": "10:30:00",
    "subject": "HAPP-I",
    "subject_code": "BP101T",
    "class_type": "theory",
    "batch": "ALL",
    "faculty": "Ms. Jahnavi Soni",
    "room": "302",
}
test("Perfect entry score = 100", calculate_parsing_score(perfect_entry), 100)

minimal_entry = {
    "day": "Monday",
    "period": 0,
    "subject": "Mathematics",
    "class_type": "theory",
    "batch": "ALL",
}
test("Minimal entry score = 45", calculate_parsing_score(minimal_entry), 45)

empty_entry = {}
test("Empty entry score = 0", calculate_parsing_score(empty_entry), 0)

scored_entries = [
    {**perfect_entry, "parsing_score": 100},
    {**minimal_entry, "parsing_score": 45},
]
test("Overall score = 72.5", calculate_overall_score(scored_entries), 72.5)

# ── Summary ──
print("\n" + "=" * 60)
print(f"RESULTS: {passed} passed, {failed} failed, {passed + failed} total")
print("=" * 60)

if failed > 0:
    print("⚠️  Some tests failed!")
    sys.exit(1)
else:
    print("✅ All tests passed!")
