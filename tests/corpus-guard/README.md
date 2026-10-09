# Fixture suites for the corpus guard

These four files are deliberately misbehaving test suites. Three of them break the rule the
corpus guard enforces — *a test may create rows and must remove them, and may never modify
or delete a row it did not create* — and one obeys it.

They are named `*.fixture.js` rather than `*.test.js` so Jest's default `testMatch` does not
collect them: the normal suite must never run them. `tests/corpus-guard.test.js` runs them
itself, through `jest.fixture.config.js`, against **a scratch database it creates and drops**
— never the development corpus.

A guard nobody has watched fail is not a guard (#142, R6).
