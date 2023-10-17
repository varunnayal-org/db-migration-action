const axios = require('axios');

class Client {
  constructor({
    repoOwner,
    repoName,
    apiToken,
    apiUser,
    jiraDomain,
    project,
    ticketLabel = 'db-migration',
    issueType = 'Story',
    // To find issue status ID, use
    // https://{jiraDomain}.atlassian.net/rest/api/2/issue/{issueOrKey}/transitions
    // and pick "id" value
    initialStatusID,
  }) {
    if (!repoOwner || !repoName || !apiToken || !apiUser || !jiraDomain || !project || !initialStatusID) {
      throw new Error('Missing required arguments');
    }

    this.repoName = repoName;
    this.repoOwner = repoOwner;

    // jira credentials
    this.apiToken = apiToken;
    this.apiUser = apiUser;

    this.project = project;
    this.ticketLabel = ticketLabel;
    this.issueType = issueType;
    this.initialStatusID = initialStatusID;

    this.baseURL = `https://${jiraDomain}.atlassian.net/rest/api/2`;

    this.client = axios.create({
      baseURL: `https://${jiraDomain}.atlassian.net/rest/api/2`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiUser}:${this.apiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    this.client.interceptors.request.use((req) => {
      // console.log(`Starting Request: ${JSON.stringify(req, null, 2)}`);
      return req;
    });
  }

  getSearchToken(prNumber) {
    return `${this.repoOwner}/${this.repoName}/PR#${prNumber}`;
  }

  async #makeAPICall(method, url, data) {
    try {
      return await this.client[method](url, data);
    } catch (ex) {
      if (ex.response) {
        const err = new Error(`${ex.code} ${ex.message} (path=${ex.request.path})`);
        err.data = ex.response && ex.response.data ? ex.response.data : {};
        err.statusCode = ex.response.status;

        throw err;
      }
      throw ex;
    }
  }

  async searchJiraTicket(prNumber) {
    const response = await this.#makeAPICall('/search', {
      params: {
        jql: `project=SCHEMA AND labels=${this.ticketLabel} AND summary~"${this.getSearchToken(prNumber)}"`,
      },
    });

    return response.data.issues[0];
  }

  async createJiraTicket(prNumber, description, assigneeName) {
    const createJiraTicketParams = {
      fields: {
        project: {
          key: this.project,
        },
        summary: this.getSearchToken(prNumber),
        issuetype: {
          name: this.issueType,
        },
        labels: [this.ticketLabel],
        description: description,
        assignee: {
          name: assigneeName,
        },
      },
    };
    const response = await this.#makeAPICall('post', '/issue', createJiraTicketParams);

    console.log('created...');

    this.#makeAPICall('post', `/issue/${response.data.id}/transitions`, {
      transition: {
        id: this.initialStatusID,
      },
    }).catch((ex) => console.error(`Unable to transition issue ${response.data.key} to ${this.initialStatusID}`, ex));

    /*
    {
      id: '196000',
      key: '{projectKey}-1',
      self: 'https://slicepay.atlassian.net/rest/api/2/issue/196000'
    }
    */
    return response.data;
  }
}

module.exports = Client;
