from pathlib import Path

path = Path('apps/operations/src/styles/premium.css')
text = path.read_text().rstrip()
marker = '/* Final correction exact geometry fixes. */'
if marker not in text:
    text += r'''

/* Final correction exact geometry fixes. */
.operations-header .tux-brand {
  display: block;
  box-sizing: border-box;
  width: auto;
  height: 44px;
  min-height: 44px;
  max-height: 44px;
  padding: 0;
  flex: 0 0 auto;
}

.line-actions {
  align-items: center;
}

.line-actions button {
  box-sizing: border-box;
  height: 44px;
  min-height: 44px;
  max-height: 44px;
  align-self: center;
}
'''
path.write_text(text + '\n')
