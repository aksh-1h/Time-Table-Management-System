"""Quick test to verify the grouped parsing logic works correctly."""
import sys

# BUG-10 FIX: Reconfigure stdout for UTF-8 to prevent UnicodeEncodeError on Windows cp1252
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

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
        print(f"  PASS: {name}")
        passed += 1
    else:
        print(f"  FAIL: {name}")
        print(f"     Expected: {expected}")
        print(f"     Got:      {actual}")
        failed += 1


# -- Test 1: Compact format "SUBJECT FACULTY_CODE ROOM" --
print("\n-- Test 1: Compact format parsing --")
result = parse_cell_to_entries("PM KVT 309")
test("Compact: 1 entry", len(result), 1)
if result:
    test("Compact: subject=PM", result[0]["subject"], "PM")
    test("Compact: faculty=FC:KVT", result[0]["faculty"], "FC:KVT")
    test("Compact: room=309", result[0]["room"], "309")

# -- Test 2: Multi-word subject compact format --
print("\n-- Test 2: Multi-word subject compact --")
result = parse_cell_to_entries("POC II AAN 201 A")
test("Multi-word: 1 entry", len(result), 1)
if result:
    test("Multi-word: subject=POC II", result[0]["subject"], "POC II")
    test("Multi-word: faculty=FC:AAN", result[0]["faculty"], "FC:AAN")
    test("Multi-word: room=201 A", result[0]["room"], "201 A")

# -- Test 3: Formal format (title-based) --
print("\n-- Test 3: Formal format parsing --")
result = parse_cell_to_entries("HAPP-I (BP101T)\nMs. Jahnavi Soni\nRoom 302")
test("Formal: 1 entry", len(result), 1)
if result:
    test("Formal: faculty has title", result[0]["faculty"], "Ms. Jahnavi Soni")
    test("Formal: room=302", result[0]["room"], "302")

# -- Test 4: Lab cell with 2 batches --
print("\n-- Test 4: Lab cell with batches --")
result = parse_cell_to_entries("Batch A: Pharma Chem Lab\nDr. Smith\nLab 201\nBatch B: Pharmacognosy\nMs. Patel\nLab 202")
test("Lab: 2 entries", len(result), 2)
if len(result) >= 2:
    test("Lab batch A", result[0]["batch"], "A")
    test("Lab batch B", result[1]["batch"], "B")
    test("Lab A faculty", result[0]["faculty"], "Dr. Smith")
    test("Lab B faculty", result[1]["faculty"], "Ms. Patel")

# -- Test 5: Recess cell -> 0 entries --
print("\n-- Test 5: Recess --")
result = parse_cell_to_entries("RECESS")
test("Recess: 0 entries", len(result), 0)

# -- Test 6: Empty cell -> 0 entries --
print("\n-- Test 6: Empty cell --")
result = parse_cell_to_entries("")
test("Empty: 0 entries", len(result), 0)

# -- Test 7: Simple single-word cell --
print("\n-- Test 7: Simple cell --")
result = parse_cell_to_entries("Mathematics")
test("Simple: 1 entry", len(result), 1)
if result:
    test("Simple: subject=Mathematics", result[0]["subject"], "Mathematics")

# -- Test 8: FC: prefix display stripping --
print("\n-- Test 8: FC: display stripping --")
test("FC:KVT -> KVT", display_faculty("FC:KVT"), "KVT")
test("Ms. Soni -> Ms. Soni", display_faculty("Ms. Soni"), "Ms. Soni")
test("None -> empty", display_faculty(None), "")

# -- Test 9: Subject code detection --
print("\n-- Test 9: Subject code detection --")
result = parse_cell_to_entries("HAPP-I (BP101T)")
if result:
    test("BP101T detected", result[0]["subject_code"], "BP101T")

# -- Test 10: Flexible time detection --
print("\n-- Test 10: Flexible time detection --")
test("9:30 -> period 0", find_period_info("9:30")["period"], 0)
test("09:30 -> period 0", find_period_info("09:30")["period"], 0)
test("9.30 -> period 0", find_period_info("9.30")["period"], 0)
test("10:30-11:30 -> period 1", find_period_info("10:30-11:30")["period"], 1)
test("01:30 -> period 3", find_period_info("01:30")["period"], 3)
test("1:30 -> period 3", find_period_info("1:30")["period"], 3)
test("02:30 -> period 4", find_period_info("02:30")["period"], 4)
test("None -> None", find_period_info(None), None)
test("Empty -> None", find_period_info(""), None)

# -- Test 11: All imports work --
print("\n-- Test 11: Import chain --")
from parsers.docx_parser import parse_docx
from parsers.pdf_parser import parse_pdf
test("docx_parser imports OK", True, True)
test("pdf_parser imports OK", True, True)

# -- Test 12: Parsing score calculation --
print("\n-- Test 12: Parsing score calculation --")
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
test("Minimal entry score = 50", calculate_parsing_score(minimal_entry), 50)

empty_entry = {}
test("Empty entry score = 0", calculate_parsing_score(empty_entry), 0)

scored_entries = [
    {**perfect_entry, "parsing_score": 100},
    {**minimal_entry, "parsing_score": 45},
]
test("Overall score = 72.5", calculate_overall_score(scored_entries), 72.5)


# ================================================================
# NEW TESTS — Verifying all bug fixes
# ================================================================

# -- BUG-1: 12:30 recess must return None --
print("\n-- BUG-1: Recess time guard --")
test("12:30 -> None (recess)", find_period_info("12:30"), None)
test("12:30-1:30 -> None (recess range)", find_period_info("12:30-1:30"), None)
test("13:00 -> None (recess)", find_period_info("13:00"), None)
test("13:29 -> None (recess edge)", find_period_info("13:29"), None)
test("13:30 -> period 3 (after recess)", find_period_info("13:30")["period"], 3)
test("RECESS text -> None", find_period_info("RECESS"), None)
test("11:30 -> period 2 (before recess)", find_period_info("11:30")["period"], 2)

# -- BUG-2: Multi-batch lab cells extract batch correctly --
print("\n-- BUG-2: Multi-batch lab parsing --")
result = parse_cell_to_entries("GP BATCH A\nJHB 311\nPCG BATCH B\nSMP 401 B")
test("Multi-batch: 2 entries", len(result), 2)
if len(result) >= 2:
    test("Multi-batch: entry 1 batch=A", result[0]["batch"], "A")
    test("Multi-batch: entry 2 batch=B", result[1]["batch"], "B")
    test("Multi-batch: entry 1 subject has no BATCH", "BATCH" not in result[0]["subject"].upper(), True)
    test("Multi-batch: entry 2 subject has no BATCH", "BATCH" not in result[1]["subject"].upper(), True)

# -- BUG-3: Subject code stripped from subject name --
print("\n-- BUG-3: Subject code stripping --")
result = parse_cell_to_entries("HAPP-I (BP101T)\nMs. Jahnavi Soni\nRoom 302")
if result:
    test("Subject has no (BP101T)", "(BP101T)" not in result[0]["subject"], True)
    test("Subject is clean HAPP-I", result[0]["subject"], "HAPP-I")
    test("Code still extracted", result[0]["subject_code"], "BP101T")

result2 = parse_cell_to_entries("HAPP-I (BP101T)\nJVS")
if result2:
    test("2-line: subject stripped", "(BP101T)" not in result2[0]["subject"], True)
    test("2-line: code extracted", result2[0]["subject_code"], "BP101T")

# -- BUG-9: Filler cells produce 0 entries --
print("\n-- BUG-9: Filler cell skipping --")
test("Assignment / Library -> 0", len(parse_cell_to_entries("Assignment / Library")), 0)
test("Weekly Test -> 0", len(parse_cell_to_entries("Weekly Test")), 0)
test("RECESS -> 0", len(parse_cell_to_entries("RECESS")), 0)
test("Remedial -> 0", len(parse_cell_to_entries("Remedial")), 0)
test("Sports -> 0", len(parse_cell_to_entries("Sports")), 0)
test("Free Period -> 0", len(parse_cell_to_entries("Free Period")), 0)
# But real subjects should still work:
test("PM KVT 309 -> 1 (real subject)", len(parse_cell_to_entries("PM KVT 309")), 1)
test("HAPP I still parses", len(parse_cell_to_entries("HAPP I\nJVS")), 1)

# -- Summary --
print("\n" + "=" * 60)
print(f"RESULTS: {passed} passed, {failed} failed, {passed + failed} total")
print("=" * 60)

if failed > 0:
    print("!! Some tests failed!")
    sys.exit(1)
else:
    print("All tests passed!")
