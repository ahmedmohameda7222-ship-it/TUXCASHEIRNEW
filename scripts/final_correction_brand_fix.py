from pathlib import Path

path = Path('apps/operations/src/styles/brand.css')
text = path.read_text()
old = '''.operations-header .tux-brand {
  width: 3.1rem;
  height: 3.1rem;
  min-width: 3.1rem;
  min-height: 3.1rem;
  padding: 0;
}'''
new = '''.operations-header .tux-brand {
  width: auto;
  height: 44px;
  min-width: 0;
  min-height: 44px;
  max-height: 44px;
  padding: 0;
  object-fit: contain;
}'''
if old not in text:
    raise SystemExit('desktop header brand rule not found')
text = text.replace(old, new, 1)
# Keep the mobile rule from shrinking the canonical 44px visual target.
mobile = '''@media (max-width: 34rem) {
  .operations-header .tux-brand {
    width: 2.9rem;
    height: 2.9rem;
    min-width: 2.9rem;
    min-height: 2.9rem;
    padding: 0;
  }
}'''
mobile_new = '''@media (max-width: 34rem) {
  .operations-header .tux-brand {
    width: auto;
    height: 44px;
    min-width: 0;
    min-height: 44px;
    max-height: 44px;
    padding: 0;
  }
}'''
if mobile not in text:
    raise SystemExit('mobile header brand rule not found')
text = text.replace(mobile, mobile_new, 1)
path.write_text(text)
