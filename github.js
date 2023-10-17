const { getOctokit } = require('@actions/github');
const { getEnv } = require('./util');

function buildOctokit(token, opts = {}) {
  let debug = process.env.DEBUG || 'false';
  debug = debug === 'true' || debug === '1';
  return getOctokit(token, {
    debug,
    ...opts,
  });
}

class Github {
  #organization;
  #repoOwner;
  #repoName;
  #client;

  constructor(organization, repoOwner, repoName, repoToken, opts = {}) {
    this.#organization = organization;
    this.#repoOwner = repoOwner;
    this.#repoName = repoName;
    this.#client = buildOctokit(repoToken, opts);
  }

  isPREvent(event) {
    return event.issue && event.issue.pull_request;
  }

  async getMatchingTeams(username, inputTeams) {
    const query = `query($cursor: String, $org: String!, $userLogins: [String!], $username: String!)  {
      user(login: $username) {
          id
      }
      organization(login: $org) {
        teams (first:20, userLogins: $userLogins, after: $cursor) {
          nodes {
            name
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
  }`;

    let data;
    let cursor = null;
    let teams = [];
    do {
      data = await this.#client.graphql(query, {
        cursor: cursor,
        org: this.#organization,
        userLogins: [username],
        username: username,
      });

      teams = teams.concat(
        data.organization.teams.nodes.map((val) => {
          return val.name;
        })
      );

      cursor = data.organization.teams.pageInfo.endCursor;
    } while (data.organization.teams.pageInfo.hasNextPage);

    const teamsFound = teams.filter((teamName) => inputTeams.includes(teamName.toLowerCase()));
    console.debug(`Teams found for user ${username}: ${teamsFound}`);
    return teamsFound;
  }

  async getPRInfo(prNumber) {
    const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          state
          isDraft
          labels(first: 100) {
            nodes {
              name
            }
          }
          author {
            login
          }
          baseRefName
        }
      }
    }
  `;

    const prResponse = await this.#client.graphql(query, {
      owner: this.#repoOwner,
      name: this.#repoName,
      number: prNumber,
    });

    const pr = prResponse.repository.pullRequest;

    return {
      author: pr.author.login,
      baseBranch: pr.baseRefName,
      isDraft: pr.isDraft,
      isOpen: pr.state === 'OPEN',
      labels: pr.labels.nodes.map((label) => label.name),
      state: pr.state,
    };
  }

  async updateComment(commentId, message) {
    return this.#client.rest.issues.updateComment({
      owner: this.#repoOwner,
      repo: this.#repoName,
      comment_id: commentId,
      body: message,
    });
  }

  async addComment(message, prNumber) {
    return this.#client.rest.issues.createComment({
      owner: this.#repoOwner,
      repo: this.#repoName,
      issue_number: prNumber,
      body: message,
    });
  }

  async addLabel(prNumber, label) {
    const existingLabels = JSON.parse(getEnv('PR_LABELS') || '[]').map((label) => label.name);
    if (existingLabels.includes(label)) {
      console.log(`PR already has label ${label}`);
      return;
    }

    // Add the label to the PR
    await this.#client.rest.issues.addLabels({
      owner: this.#repoOwner,
      repo: this.#repoName,
      issue_number: prNumber,
      labels: [label],
    });
  }
}

module.exports = Github;
