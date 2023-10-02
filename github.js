const core = require('@actions/core');
const { getOctokit } = require('@actions/github');

function isPREvent(event) {
  return event.issue && event.issue.pull_request;
}

function buildOctokit(opts = {}) {
  const token = core.getInput('github-token', { required: true });
  const debug = core.getBooleanInput('debug') || false;
  const octokit = getOctokit(token, {
    debug,
    ...opts,
  });

  return octokit;
}

async function getMatchingTeams(octokit, username, organization, inputTeams) {
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
    data = await octokit.graphql(query, {
      cursor: cursor,
      org: organization,
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

async function getPRInfo(octokit, repoOwner, repoName, prNumber) {
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

  const prResponse = await octokit.graphql(query, {
    owner: repoOwner,
    name: repoName,
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

async function updateComment(octokit, repoOwner, repoName, commentId, message) {
  await octokit.rest.issues.updateComment({
    owner: repoOwner,
    repo: repoName,
    comment_id: commentId,
    body: message,
  });
}

module.exports = {
  getMatchingTeams,
  getPRInfo,
  isPREvent,
  buildOctokit,
  updateComment,
};
