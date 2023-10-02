const core = require('@actions/core');
const fs = require('fs');
const { runMigrations, buildMigrationConfig } = require('./migration');
const { buildOctokit, isPREvent, getMatchingTeams, getPRInfo, updateComment } = require('./github');

function validatePR(prInfo, prBaseBranchName, commentOwner) {
  if (prInfo.baseBranch !== prBaseBranchName) {
    return `Base branch should be **${prBaseBranchName}**`;
  } else if (prInfo.author === commentOwner) {
    return `PR author @${prInfo.author} cannot approve their own PR`;
  } else if (!prInfo.isOpen) {
    return `PR is in **${prInfo.state}** state`;
  }
}

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const octokit = buildOctokit();
  const migrationURL = core.getInput('migration-db-url', { required: true });
  const approvalTeams = core.getInput('approval-teams', { required: true });
  const migrationDir = core.getInput('migration-dir', { required: true });
  const prBaseBranchName = core.getInput('pr-base-branch', { required: true });

  if (!isPREvent(event)) {
    console.debug('Not a pull request event');
    return;
  }

  const commentBody = event.comment.body.trim();
  if (commentBody != '/migrate approved') {
    console.debug('ignoring comment');
    return;
  }

  const organization = event.organization.login; // for orgs, this and repoOwner are same
  const repoOwner = event.repository.owner.login;
  const repoName = event.repository.name;
  const prNumber = event.issue.number;
  const commentOwner = event.comment.user.login;
  const commentID = event.comment.id;

  console.debug(`Fetching PR info for ${repoOwner}/${repoName}#${prNumber}`);
  const prInfo = await getPRInfo(octokit, repoOwner, repoName, prNumber);

  const errMsg = validatePR(prInfo, prBaseBranchName, commentOwner);
  if (errMsg) {
    console.error(errMsg);
    await updateComment(
      octokit,
      repoOwner,
      repoName,
      commentID,
      `${commentBody}\r\n\r\n**Migrations failed**: ${errMsg}`
    );
    return;
  }

  console.debug(`Fetching teams for user ${commentOwner}`);
  const matchingTeams = await getMatchingTeams(octokit, commentOwner, organization, approvalTeams);

  if (matchingTeams.length === 0) {
    console.error(`User ${commentOwner} is not a member of any of the required teams: ${approvalTeams}`);
    return;
  }

  const migrationConfig = buildMigrationConfig(migrationURL, migrationDir);
  await runMigrations(migrationConfig);

  await updateComment(
    octokit,
    repoOwner,
    repoName,
    commentID,
    `${commentBody}\r\n\r\nMigrations run successfully at ${new Date().toISOString()}`
  );
}

main();
