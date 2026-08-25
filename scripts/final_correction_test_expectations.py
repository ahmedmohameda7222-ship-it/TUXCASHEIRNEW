from pathlib import Path

path = Path('apps/operations-desktop/src/main/workerUiPreferencesIpc.test.ts')
text = path.read_text()

update_wrong = """    expect(await repository.get(shopId, workerB)).toMatchObject({
      workerId: workerB,
      categoryOrder: [categoryA, categoryB],
      categoryAlignment: 'left',
      syncState: 'DIRTY',
    });"""
update_right = """    expect(await repository.get(shopId, workerB)).toMatchObject({
      workerId: workerB,
      categoryOrder: [categoryA, categoryB],
      categoryAlignment: 'center',
      syncState: 'DIRTY',
    });"""
reset_wrong = """    expect(await repository.get(shopId, workerA)).toMatchObject({
      categoryOrder: [],
      categoryAlignment: 'center',
      syncState: 'DIRTY',
    });"""
reset_right = """    expect(await repository.get(shopId, workerA)).toMatchObject({
      categoryOrder: [],
      categoryAlignment: 'left',
      syncState: 'DIRTY',
    });"""

if update_wrong not in text:
    raise SystemExit('explicit update expectation was not transformed as expected')
if reset_wrong not in text:
    raise SystemExit('reset expectation not found')

text = text.replace(update_wrong, update_right, 1)
text = text.replace(reset_wrong, reset_right, 1)
path.write_text(text)
