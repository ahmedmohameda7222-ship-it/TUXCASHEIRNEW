from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
text = text.replace('Double Smashed Pattyed Patty', 'Double Smashed Patty')
text = text.replace('Triple Smashed Pattyed Patty', 'Triple Smashed Patty')
path.write_text(text)
