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
    statusIDInitial,
    statusIDCompleted,

    // To find custom field ID, use
    // https://{jiraDomain}.atlassian.net/secure/admin/ViewCustomFields.jspa
    // select field and pick "id" in URL (id=12344)
    // So value should be "customfield_12345"
    customFieldPRLink,
  }) {
    if (
      !repoOwner ||
      !repoName ||
      !apiToken ||
      !apiUser ||
      !jiraDomain ||
      !project ||
      !statusIDInitial ||
      !statusIDCompleted ||
      !customFieldPRLink
    ) {
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
    this.statusIDInitial = statusIDInitial;
    this.statusIDCompleted = statusIDCompleted;
    this.customFieldPRLink = customFieldPRLink;

    this.baseURL = `https://${jiraDomain}.atlassian.net/rest/api/2`;

    this.client = axios.create({
      baseURL: `https://${jiraDomain}.atlassian.net/rest/api/2`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiUser}:${this.apiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    // this.client.interceptors.request.use((req) => {
    //   console.log(`Starting Request: ${JSON.stringify(req, null, 2)}`);
    //   return req;
    // });
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

  async #search(searchText) {
    const jql = `project=${this.project} AND labels=${this.ticketLabel} AND ${searchText}`;
    console.log(`Search Text: ${jql}`);
    const response = await this.#makeAPICall('get', '/search', {
      params: {
        jql,
      },
    });

    if (response.data.issues.length === 0) {
      return null;
    } else if (response.data.issues.length > 1) {
      throw new Error(`Found multiple tickets for ${searchText}`);
    }
    return response.data.issues[0];
  }

  async searchJiraTicket(prNumber) {
    return this.#search(`summary~"${this.getSearchToken(prNumber)}"`);
  }

  async ensureJiraTicket(prNumber, description, assigneeName, prLink) {
    // const issue = await this.#search(`${this.customFieldPRLink} = "${prLink}"`);
    const issue = await this.searchJiraTicket(prNumber);

    if (issue != null) {
      console.debug('Ticket already present', issue);
      return {
        alreadyExists: true,
        issue,
      };
    }

    console.debug('Creating new Ticket');
    return {
      alreadyExists: false,
      issue: await this.createJiraTicket(prNumber, description, assigneeName, prLink),
    };
  }

  async addComment(issueId, message) {
    const response = await this.#makeAPICall('post', `/issue/${issueId}/comment`, {
      body: message,
    });

    const comment = response.data;
    return {
      id: comment.id,
      self: comment.self,
      body: comment.body,
    };
  }

  async createJiraTicket(prNumber, description, assigneeName, prLink) {
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
        [this.customFieldPRLink]: prLink,
      },
    };
    if (assigneeName) {
      createJiraTicketParams.fields.assignee = {
        name: assigneeName,
      };
    }
    const response = await this.#makeAPICall('post', '/issue', createJiraTicketParams);

    console.debug('JIRA created');

    await this.transition(response.data.id, this.statusIDInitial);

    /*
    {
      id: '196000',
      key: '{projectKey}-1',
      self: 'https://slicepay.atlassian.net/rest/api/2/issue/196000'
    }
    */
    return response.data;
  }

  async transition(issueId, transitionID) {
    return this.#makeAPICall('post', `/issue/${issueId}/transitions`, {
      transition: {
        id: transitionID,
      },
    }).catch((ex) => console.error(`Unable to transition issue ${response.data.key} to ${this.statusIDInitial}`, ex));
  }
}

module.exports = Client;
