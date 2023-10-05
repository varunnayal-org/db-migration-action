# Migration GHA

## Features

- Use `/migrate approved` comment on PR to run migrations
  - Comment from PR owner will not work
  - Post execution, comment is updated with execution status
- Use `/migrate dry-run` to dry run the migrations.
- Successful execution(with or without dry run) will list the files being picked for migration.
- Label `db-migration` is added to the PR
- Will only work is PR is open. Draft PRs will be ignored

## Token Permission

Create a classic token (Fine-grained token has not been tested). Permission scopes required

- `repo:status`
- `public_repo`
- `read:org`

## TODO

- [ ] Partitioning handling
- [ ] Support for multiple environments based on regulations. Eg: PCI and non PCI environments
- [ ] AWS integrations
  - [ ] Secrets manager integration to read secrets
  - [ ] DynamoDB integration to store
    - [ ] who all approved the migrations(JIRA ticket, member of GitHub team)
- [ ] JIRA integration
  - [ ] Create a ticket in JIRA to get approval
  - [ ] Webhooks for JIRA whenever the ticket is approved
- [ ] Option to execute schema migrations only at a given window
- [ ] Option to [review SQL](https://www.bytebase.com/docs/tutorials/github-database-cicd-part-1-sql-review-github-actions/)

- [ ] Migration for multiple databases from same repository (users and transactions db)

Below configuration might work. This would mean we'd not required `migration-db-url`, `approval-teams` from [action.yml](./action.yml)

```js
module.exports = {
  "defaults": {
    "base_directory": "./migrations",
    "secret_provider": {
      "provider": "aws",
      "path": "enter path here or better read from GITHUB organization secrets",
    },
    "github_token_provider_path": "key to read from secret provider to get github token"
  },
  "databases": [
    {
      "directory": "users, so complete path is `{base_directory}/${users}",
      "url_path": "for aws, it'll be key in secret that holds db URL",
      "teams": ["db-champions: list of users who are allowed to review PR from SQL. These users will enter /migrate command in PR"]
    },
    {
      "directory": "transactions",
      "migration-db-url-env": "MIGRATION_DB_URL_TXNS",
      "teams": ["admin", "dba"]
    }
  ]
}
```

## Parameters

### repo-token

It can be picked directly from `${{ secrets.GITHUB_TOKEN }}`

### pr-base-branch

This Github Action runs when a comment is added in a PR.
This is to allow only custom branch.
For ex, if we want to allow this action to run on any PRs raised to `master` branch(i.e. `release-xyz` merging into `master`), then we'll set the value as `master`.

Defaults to `master`.

### migration-db-url

In format `postgres://user:password@host:port/db`

### migration-dir

Directory containing sql migration files. Defaults to `migrations`

### approval-teams

List of GitHub Teams that are authorized to run migrations.

### debug

Used to enable debug logs. Either `true` or `false`.
