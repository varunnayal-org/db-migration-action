# Migration GHA

## Links

- Env [GITHUB_API_URL](https://docs.github.com/en/actions/creating-actions/about-custom-actions#compatibility-with-github-enterprise-server)

## Parameters

### github-token

It can be picked directly from `${{ secrets.GITHUB_TOKEN }}`

### pr-base-branch

This Github Action runs when a comment is added in a PR.
This is to allow only custom branch.
For ex, if we want to allow this action to run on any PRs raised to `main` branch(i.e. `release-xyz` merging into `main`), then we'll set the value as `main`.

Defaults to `main`.

### migration-db-url

In format `postgres://user:password@host:port/db`

### migration-dir

Directory containing sql migration files. Defaults to `migrations`

### approval-teams

List of GitHub Teams that are authorized to run migrations.

### debug

Used to enable debug logs. Either `true` or `false`.

## TODO

- [ ] Migration for multiple databases from same repository (users and transactions db)

Below configuration might work. This would mean we'd not required `migration-db-url`, `approval-teams` from [action.yml](./action.yml)

```js
module.exports = [
  {
    "directory": "users",
    "migration-db-url-env": "MIGRATION_DB_URL_USERS",
    "teams": ["admin", "dba", "data"]
  },
  {
    "directory": "transactions",
    "migration-db-url-env": "MIGRATION_DB_URL_TXNS",
    "teams": ["admin", "dba"]
  }
]
```

- [ ] Migration for multiple entities from same repository(deploy in account1 and account2)
