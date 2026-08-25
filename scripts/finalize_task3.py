from pathlib import Path

for raw in [
    'scripts/apply_task3_fixture.py',
    'scripts/fix_task3_generated_names.py',
    'scripts/fix_task3_combo_navigation.py',
    'scripts/fix_task3_search_query.py',
    'scripts/fix_task3_category_editor.py',
    'scripts/fix_task3_remaining_expectations.py',
    'scripts/fix_task3_toolbar_height.py',
    'scripts/finalize_task3.py',
]:
    Path(raw).unlink(missing_ok=True)
