# Contributing to MARP

Thank you for your interest in improving MARP. This guide is written primarily for MARP developers, but it should also be useful to outside partners who want to understand how contributions are made and reviewed.

## Introduction

MARP welcomes contributions that improve:

- ecological data workflows
- API behavior
- data processing
- video and imagery workflows
- machine-learning integrations
- frontend applications
- reporting
- documentation
- testing
- maintainability

Contributions are encouraged but not required to use or deploy MARP. If you are running MARP for your own organization and never send a single pull request, that is a completely normal and supported way to use the project.

## Contribution license

By submitting a contribution to MARP, you agree that the contribution may be distributed under the Apache License, Version 2.0.


## Recommended development workflow

1. Create a focused branch from the appropriate development branch.
2. Keep the change limited to one feature, fix, or architectural concern.
3. Follow the existing controller, service, repository, model, and frontend boundaries.
4. Use relative `/api/...` paths in frontend code.
5. Do not introduce hard-coded hostnames, credentials, or machine-specific paths.
6. Update OpenAPI and JSDoc when endpoint behavior changes.
7. Use migrations for database schema changes.
8. Run relevant tests and documentation builds.
9. Open a pull request explaining:
   - what changed
   - why it changed
   - how it was verified
   - migration or deployment impact

## Commit sign-off

A Developer Certificate of Origin-style sign-off is preferred but not required.

```text
Signed-off-by: Contributor Name <contributor@example.org>
```

You can add this automatically with:

```bash
git commit -s
```

## Pull-request expectations

- Keep pull requests focused on a single concern.
- Write a clear description of the change.
- Include reproducible testing steps.
- Update documentation alongside behavior changes.
- Include migrations when database schema changes.
- Avoid including secrets or private ecological data.
- Expect review and feedback from project maintainers before merge.

## Coding expectations

- Maintain architectural separation between controllers, services, repositories, models, and frontend code.
- Favor readable and maintainable code over clever shortcuts.
- Document non-obvious behavior where the reasoning would not be clear from the code alone.
- Preserve API compatibility unless a breaking change is intentional and explained.
- Keep generated documentation consistent with actual behavior.
- Do not commit `.env` files, credentials, private database exports, restricted video, or partner-owned data.

## Related documents

- [README.md](README.md) — platform overview, architecture, and setup
- [LICENSE](LICENSE) — Apache License, Version 2.0
- [GOVERNANCE.md](GOVERNANCE.md) — project roles and technical decision-making
