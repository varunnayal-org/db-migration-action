const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');

class Client {
  constructor(
    orgName,
    repoName,
    accessKeyId = 'dummy' || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey = 'dummy' || process.env.AWS_SECRET_ACCESS_KEY,
    region = process.env.AWS_REGION || 'ap-south-1'
  ) {
    console.log({
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_REGION: process.env.AWS_REGION,
      AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL,
      AWS_PROFILE: process.env.AWS_PROFILE,
    });
    let credentials;
    if (accessKeyId && secretAccessKey) {
      credentials = { accessKeyId, secretAccessKey };
    }
    const clientArgs = {
      credentials: credentials,
      endpoint: 'https://5fee-14-97-218-254.ngrok-free.app' || process.env.AWS_ENDPOINT_URL,
      region,
    };

    this.tableName = 'schema_migration_requests';
    this.orgName = orgName;
    this.repoName = repoName;
    this.secretManager = new SecretsManagerClient(clientArgs);
    this.dynamo = new DynamoDBClient(clientArgs);
  }

  validateDynamoResponse(responseMetadata, errMsg) {
    if (responseMetadata.httpStatusCode !== 200) {
      throw new Error(`${errMsg} (code=${responseMetadata.httpStatusCode})}, reqID=${responseMetadata.requestId})})`);
    }
  }

  getDynamoAPIParam() {
    return {
      TableName: this.tableName,
      Key: {
        orgName: { S: this.orgName },
        repoName: { S: this.repoName },
      },
    };
  }

  async updateItem(errMsg, updateItemParams) {
    const response = await this.dynamo.send(new UpdateItemCommand(updateItemParams));
    this.validateDynamoResponse(response.$metadata, errMsg);

    return unmarshall(response.Attributes);
  }

  /**
   * Set ticket ID from external system like JIRA
   *
   * @param {string} ticketID
   * @param {string} ticketURL
   * @returns
   */
  async setTicket(ticketID, ticketURL) {
    return this.updateItem('Failed to set ticket ID', {
      ...this.getDynamoAPIParam(),
      UpdateExpression: 'SET ticket.id = :ticketID, ticket.htmlUrl = :ticketURL',
      ExpressionAttributeValues: {
        ':ticketID': { S: ticketID.toString() },
        ':ticketURL': { S: ticketURL },
      },
      ReturnValues: 'ALL_NEW', // Return the updated item
    });
  }

  async createItem(prNumber, prHtmlUrl) {
    const putItemCmd = new PutItemCommand({
      ...this.getDynamoAPIParam(),
      Item: marshall({
        orgName: this.orgName,
        repoName: this.repoName,
        files: [],
        executions: [],
        execStatus: 'pending',
        github: {
          pr: prNumber,
          prHtmlUrl,
          approvedBy: [],
        },
        ticket: {
          id: '',
          htmlUrl: '',
          approvedBy: [],
        },
      }),
    });

    return this.dynamo.send(putItemCmd);
  }

  /**
   * Sets the user who approved the ticket in external system
   *
   * @param {string} approvedBy
   * @returns
   */
  async addTicketApprover(approvedBy) {
    return this.updateItem('Failed to set ticket approver', {
      ...this.getDynamoAPIParam(),
      UpdateExpression: 'SET ticket.approvedBy = list_append(ticket.approvedBy, :newApproval)',
      ExpressionAttributeValues: {
        ':newApproval': {
          L: [
            {
              M: {
                user: { S: approvedBy },
                time: { N: new Date().getTime() },
              },
            },
          ],
        },
      },
      ReturnValues: 'ALL_NEW', // Return the updated item
    });
  }

  /**
   * Sets the user who added approval comment in github PR
   *
   * @param {string} approvedBy
   * @param {string} teamName
   * @returns
   */
  async addGithubApprover(approvedBy, teamName) {
    return this.updateItem(`Failed to update Github approver (${approvedBy}, ${teamName})`, {
      ...this.getDynamoAPIParam(),
      UpdateExpression: 'SET github.approvedBy = list_append(github.approvedBy, :newApproval)',
      ExpressionAttributeValues: {
        ':newApproval': {
          L: [
            {
              M: {
                user: { S: approvedBy },
                team: { S: teamName },
                time: { N: new Date().getTime() },
              },
            },
          ],
        },
      },
      ReturnValues: 'ALL_NEW', // Return the updated item
    });
  }

  /**
   *
   * @param {string} status "success", "failed"
   * @param {string} executedBy
   * @param {string} source "ticket" or "github"
   * @param {string!} errMsg
   * @returns
   */
  async setExecutionStatus(status, executedBy, source, errMsg) {
    const executionItem = {
      executedBy,
      source,
      time: new Date().getTime(),
    };
    if (!errMsg) {
      executionItem.error = errMsg;
    }

    return this.updateItem(`Failed to set execution status (${status}, ${executedBy})`, {
      ...this.getDynamoAPIParam(),
      UpdateExpression: 'SET executions = list_append(executions, :executionItem), execStatus = :executionStatus',
      ExpressionAttributeValues: marshall({
        ':executionStatus': status,
        ':executionItem': [executionItem],
      }),
      ReturnValues: 'ALL_NEW', // Return the updated item
    });
  }

  async getItem() {
    const command = new GetItemCommand(this.getDynamoAPIParam());
    const response = await this.dynamo.send(command);

    if (response.$metadata.httpStatusCode !== 404) {
      this.validateDynamoResponse(response.$metadata, 'Failed to get item');
    }

    // console.log(JSON.stringify(response.Item.executions, null, 2));
    if (response.Item) {
      return unmarshall(response.Item);
    }
    throw new Error(
      `Item not found (code=${response.$metadata.httpStatusCode})}, reqID=${response.$metadata.requestId})})`
    );
  }

  /**
   *
   * @param {string} secretId
   * @param {string[]} keyNames
   * @returns
   */
  async getSecrets(secretId, keyNames) {
    const command = new GetSecretValueCommand({
      SecretId: secretId,
    });

    const getSecretResponse = await this.secretManager.send(command);
    const secretMap = JSON.parse(getSecretResponse.SecretString);

    if (!keyNames) {
      return secretMap;
    }
    return keyNames.reduce(
      (acc, key) => {
        acc[key] = secretMap[key];
        return acc;
      },
      {
        github_repo_token: secretMap[`github-${this.orgName}-token`],
      }
    );
  }
}

module.exports = Client;
